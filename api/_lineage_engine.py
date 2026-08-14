"""
api/_lineage_engine.py — the local, rule-based lineage extraction
engine. No AI, no API key, no network call: SQL is parsed with a real
parser (sqlglot); DAX and Power Query (M) have no mature open-source
parser available, so they're read with targeted, documented heuristics
instead. Runs entirely inside the Vercel Python function.

Prefixed with "_" so Vercel's Python builder does not turn this file
into its own route — it's a plain importable module for
api/infer-lineage.py.

Output contract matches the schema the rest of the app already speaks
(see lib/validateGraph.js on the JS side, used by /api/ask and
/api/report):
    nodes: [{ id, label, type, description, confidence }]
    edges: [{ id, source, target, transformation, type, confidence }]
type in {table, view, column, measure} / {direct, derived, aggregated, filtered}
confidence in {high, medium, low}

Confidence is set by how the lineage was derived, not guessed at:
  - SQL, resolved via the real AST (qualified columns, single-table
    queries) -> high.
  - SQL, an unqualified column with more than one candidate table in
    scope -> low, linked at table level only, with a warning.
  - DAX / M, always heuristic (regex-based, no real parser) -> medium,
    even when the pattern match is clean, and low for something that
    could not be resolved at all (e.g. a measure reference to a name
    not defined anywhere in the pasted file).
"""

import re

try:
    import sqlglot
    from sqlglot import exp
    from sqlglot.errors import ParseError
except ImportError:  # pragma: no cover - guards a misconfigured deployment, not a code path exercised in tests
    sqlglot = None

MAX_NODES = 500
MAX_EDGES = 1500

ANSI_ESCAPE_RE = re.compile(r'\x1b\[[0-9;]*m')

# SSMS's "Script Table/View/Proc as ..." output separates each batch with
# a bare "GO" on its own line. That's a client-tool convention, not part
# of T-SQL grammar, and sqlglot's tsql dialect only tolerates it between
# exactly one pair of statements — a real script (USE ... / SET ... / SET
# ... / CREATE ...) has several GO-separated batches back to back, and
# sqlglot raises a ParseError on the second one. Splitting on GO lines
# ourselves and parsing each batch independently avoids that; see
# extract_sql_lineage below.
_GO_BATCH_RE = re.compile(r'(?im)^[ \t]*GO[ \t]*$')


# ── SQL (sqlglot) ────────────────────────────────────────────────────

AGG_TYPES = None
if sqlglot is not None:
    AGG_TYPES = (exp.Sum, exp.Count, exp.Avg, exp.Min, exp.Max, exp.ApproxDistinct)


def _qualify(db, name):
    return f'{db}.{name}' if db else name


def _sql_alias_map(select):
    """Maps FROM/JOIN alias -> fully-qualified table name, plus the tables in FROM/JOIN order."""
    alias_map = {}
    table_order = []
    for t in select.find_all(exp.Table):
        full = _qualify(t.db, t.name)
        alias = t.alias_or_name or t.name
        alias_map[alias] = full
        if full not in table_order:
            table_order.append(full)
    return alias_map, table_order


def _sql_target(stmt, select):
    """Returns (fully_qualified_name, node_type) for whatever this statement writes to, or (None, None)."""
    if isinstance(stmt, exp.Create):
        t = stmt.this
        table_node = t.this if isinstance(t, exp.Schema) else t
        kind = (stmt.args.get('kind') or '').upper()
        return _qualify(table_node.db, table_node.name), ('view' if kind == 'VIEW' else 'table')
    if isinstance(stmt, exp.Insert):
        t = stmt.this.this if isinstance(stmt.this, exp.Schema) else stmt.this
        return _qualify(t.db, t.name), 'table'
    into = select.args.get('into') if select is not None else None
    if into:
        t = into.this
        return _qualify(t.db, t.name), 'table'
    return None, None


def _sql_extract_statement(stmt, fallback_target, nodes, edges, warnings):
    select = stmt if isinstance(stmt, exp.Select) else stmt.find(exp.Select)
    if select is None:
        return

    target, node_type = _sql_target(stmt, select)
    if not target:
        target, node_type = fallback_target, 'view'

    nodes.setdefault(target, {'id': target, 'label': target, 'type': node_type, 'description': '', 'confidence': 'high'})

    alias_map, table_order = _sql_alias_map(select)
    for full in table_order:
        nodes.setdefault(full, {'id': full, 'label': full, 'type': 'table', 'description': '', 'confidence': 'high'})

    join_notes = []
    for j in select.find_all(exp.Join):
        try:
            join_notes.append(j.sql(dialect='tsql'))
        except Exception:
            pass
    join_note = '; '.join(join_notes)

    for full in table_order:
        edges.append({'source': full, 'target': target, 'transformation': join_note, 'type': 'direct', 'confidence': 'high'})

    for e in select.expressions:
        target_col_name = e.alias_or_name
        if not target_col_name:
            continue
        cols = list(e.find_all(exp.Column))
        if not cols:
            continue

        target_col_id = f'{target}.{target_col_name}'
        agg = e.find(AGG_TYPES) if AGG_TYPES else None
        is_bare_column = isinstance(e, exp.Column) or (isinstance(e, exp.Alias) and isinstance(e.this, exp.Column))
        edge_type = 'direct' if is_bare_column else ('aggregated' if agg else 'derived')

        nodes.setdefault(target_col_id, {'id': target_col_id, 'label': target_col_name, 'type': 'column', 'description': '', 'confidence': 'high'})

        for c in cols:
            qualifier = c.table
            col_name = c.name
            if qualifier and qualifier in alias_map:
                source_table = alias_map[qualifier]
            elif len(table_order) == 1:
                source_table = table_order[0]
            else:
                warnings.append(f'Column "{col_name}" is unqualified with more than one joined table in scope — linked at table level only.')
                for st in table_order:
                    edges.append({'source': st, 'target': target_col_id, 'transformation': f'ambiguous column "{col_name}"', 'type': edge_type, 'confidence': 'low'})
                continue
            source_col_id = f'{source_table}.{col_name}'
            nodes.setdefault(source_col_id, {'id': source_col_id, 'label': col_name, 'type': 'column', 'description': '', 'confidence': 'high'})
            edges.append({'source': source_col_id, 'target': target_col_id, 'transformation': '', 'type': edge_type, 'confidence': 'high'})


def extract_sql_lineage(name, content):
    nodes, edges, warnings = {}, [], []
    if sqlglot is None:
        warnings.append('SQL parsing is unavailable on this deployment (sqlglot did not load).')
        return nodes, edges, warnings

    batches = [b for b in _GO_BATCH_RE.split(content) if b.strip()] or [content]

    statements = []
    for batch in batches:
        try:
            statements.extend(sqlglot.parse(batch, read='tsql'))
        except ParseError as ex:
            warnings.append(f'Could not parse part of "{name}" as SQL: {ANSI_ESCAPE_RE.sub("", str(ex))}')
        except Exception as ex:
            warnings.append(f'Could not parse part of "{name}" as SQL: {ex}')

    for stmt in statements:
        if stmt is None:
            continue
        try:
            _sql_extract_statement(stmt, name, nodes, edges, warnings)
        except Exception as ex:
            warnings.append(f'Skipped a statement in "{name}": {ex}')
    return nodes, edges, warnings


# ── DAX (heuristic) ──────────────────────────────────────────────────

_DAX_MEASURE_START_RE = re.compile(r'(?m)^([A-Za-z_][A-Za-z0-9_ ]*?)\s*=\s*')
_DAX_TABLE_COLUMN_RE = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([A-Za-z_][A-Za-z0-9_ ]*?)\s*\]')
_DAX_BARE_BRACKET_RE = re.compile(r'(?<![A-Za-z0-9_])\[\s*([A-Za-z_][A-Za-z0-9_ ]*?)\s*\]')
_DAX_AGG_RE = re.compile(r'\b(SUM|SUMX|COUNT|COUNTROWS|COUNTA|COUNTX|AVERAGE|AVERAGEX|MIN|MINX|MAX|MAXX|DISTINCTCOUNT)\s*\(', re.IGNORECASE)
_DAX_FILTER_RE = re.compile(r'\bFILTER\s*\(', re.IGNORECASE)


def extract_dax_lineage(name, content):
    nodes, edges, warnings = {}, [], []
    matches = list(_DAX_MEASURE_START_RE.finditer(content))
    blocks = []
    for i, m in enumerate(matches):
        measure_name = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        expr = content[start:end].strip().rstrip(',').strip()
        blocks.append((measure_name, expr))

    if not blocks:
        warnings.append(f'No "MeasureName = expression" pattern found in "{name}" — DAX extraction is heuristic and expects one measure definition per line, unindented.')
        return nodes, edges, warnings

    measure_names = {n for n, _ in blocks}

    for measure_name, expr in blocks:
        target_id = f'Measures.{measure_name}'
        nodes.setdefault(target_id, {'id': target_id, 'label': measure_name, 'type': 'measure', 'description': '', 'confidence': 'high'})

        if _DAX_FILTER_RE.search(expr):
            edge_type = 'filtered'
        elif _DAX_AGG_RE.search(expr):
            edge_type = 'aggregated'
        else:
            edge_type = 'derived'

        seen = set()
        for tm in _DAX_TABLE_COLUMN_RE.finditer(expr):
            table, col = tm.group(1), tm.group(2).strip()
            source_id = f'{table}.{col}'
            if source_id in seen:
                continue
            seen.add(source_id)
            nodes.setdefault(source_id, {'id': source_id, 'label': col, 'type': 'column', 'description': '', 'confidence': 'medium'})
            edges.append({'source': source_id, 'target': target_id, 'transformation': expr[:200], 'type': edge_type, 'confidence': 'medium'})

        for bm in _DAX_BARE_BRACKET_RE.finditer(expr):
            ref_name = bm.group(1).strip()
            if ref_name == measure_name or ref_name in seen:
                continue
            source_id = f'Measures.{ref_name}'
            confidence = 'medium' if ref_name in measure_names else 'low'
            if ref_name not in measure_names:
                warnings.append(f'"{measure_name}" references [{ref_name}], which isn\'t defined in this file — linked at low confidence.')
            nodes.setdefault(source_id, {'id': source_id, 'label': ref_name, 'type': 'measure', 'description': '', 'confidence': confidence})
            edges.append({'source': source_id, 'target': target_id, 'transformation': expr[:200], 'type': edge_type, 'confidence': confidence})

    return nodes, edges, warnings


# ── Power Query / M (heuristic) ──────────────────────────────────────

_M_STEP_RE = re.compile(r'(?m)^\s*(#"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?),?\s*$')
_M_ITEM_RE = re.compile(r'Item\s*=\s*"([^"]+)"')
_M_SCHEMA_RE = re.compile(r'Schema\s*=\s*"([^"]+)"')
_M_AGG_RE = re.compile(r'\b(Table\.Group|List\.Sum|List\.Average|List\.Count|List\.Max|List\.Min)\b')
_M_FILTER_RE = re.compile(r'\b(Table\.SelectRows|Table\.RemoveRows)\b')


def _m_clean_step_name(raw):
    if raw.startswith('#"') and raw.endswith('"'):
        return raw[2:-1]
    return raw


def extract_m_lineage(name, content):
    nodes, edges, warnings = {}, [], []
    steps = [(_m_clean_step_name(m.group(1)), m.group(2).strip()) for m in _M_STEP_RE.finditer(content)]

    if not steps:
        warnings.append(f'No M step definitions ("Name = expression,") found in "{name}" — this extractor expects Power Query\'s usual one-step-per-line format.')
        return nodes, edges, warnings

    step_names = {clean for clean, _ in steps}
    final_step_name = steps[-1][0]
    node_id_for = {}

    for clean, expr in steps:
        item_match = _M_ITEM_RE.search(expr)
        schema_match = _M_SCHEMA_RE.search(expr)
        if item_match:
            node_id = f'{schema_match.group(1)}.{item_match.group(1)}' if schema_match else item_match.group(1)
            node_type, confidence = 'table', 'medium'
        elif clean == final_step_name:
            node_id, node_type, confidence = name, 'view', 'medium'
        else:
            node_id, node_type, confidence = f'{name}::{clean}', 'view', 'medium'
        node_id_for[clean] = node_id
        nodes.setdefault(node_id, {'id': node_id, 'label': clean if node_type != 'table' else node_id, 'type': node_type, 'description': '', 'confidence': confidence})

    for clean, expr in steps:
        target_id = node_id_for[clean]
        if _M_FILTER_RE.search(expr):
            edge_type = 'filtered'
        elif _M_AGG_RE.search(expr):
            edge_type = 'aggregated'
        else:
            edge_type = 'derived'

        for other in step_names:
            if other == clean:
                continue
            pattern = re.compile(r'(?<![A-Za-z0-9_])(#"' + re.escape(other) + r'"|' + re.escape(other) + r')(?![A-Za-z0-9_"])')
            if pattern.search(expr):
                edges.append({'source': node_id_for[other], 'target': target_id, 'transformation': expr[:200], 'type': edge_type, 'confidence': 'medium'})

    return nodes, edges, warnings


# ── Top-level merge ──────────────────────────────────────────────────

_EXTRACTORS = {'sql': extract_sql_lineage, 'dax': extract_dax_lineage, 'm': extract_m_lineage}


def extract_lineage(sources):
    """
    @param sources: list of {"name": str, "dialect": "sql"|"dax"|"m"|"other", "content": str}
    @returns (graph: {"nodes": [...], "edges": [...], "metadata": {...}}, warnings: [str])
    """
    all_nodes = {}
    all_edges = []
    warnings = []

    for source in sources:
        name = source.get('name') or 'untitled'
        dialect = source.get('dialect') or 'other'
        content = source.get('content') or ''
        extractor = _EXTRACTORS.get(dialect, extract_sql_lineage)  # "other" best-effort as SQL
        if dialect not in _EXTRACTORS:
            warnings.append(f'"{name}" has dialect "{dialect}" — attempting to parse it as SQL.')
        nodes, edges, source_warnings = extractor(name, content)
        for node_id, node in nodes.items():
            all_nodes.setdefault(node_id, node)
        all_edges.extend(edges)
        warnings.extend(source_warnings)

    if len(all_nodes) > MAX_NODES:
        warnings.append(f'This source set produced {len(all_nodes)} nodes; only the first {MAX_NODES} are included.')
    node_ids = list(all_nodes.keys())[:MAX_NODES]
    kept_node_ids = set(node_ids)
    final_nodes = [all_nodes[nid] for nid in node_ids]

    seen_edge_keys = set()
    final_edges = []
    for i, e in enumerate(all_edges):
        if e['source'] not in kept_node_ids or e['target'] not in kept_node_ids:
            continue
        key = (e['source'], e['target'])
        if key in seen_edge_keys:
            continue
        seen_edge_keys.add(key)
        final_edges.append({
            'id': f'e{i + 1}',
            'source': e['source'],
            'target': e['target'],
            'transformation': e.get('transformation', '') or '',
            'type': e.get('type', 'direct'),
            'confidence': e.get('confidence', 'high'),
        })
        if len(final_edges) >= MAX_EDGES:
            warnings.append(f'This source set produced more than {MAX_EDGES} edges; only the first {MAX_EDGES} are included.')
            break

    graph = {
        'nodes': final_nodes,
        'edges': final_edges,
        'metadata': {'sourceFiles': [s.get('name') or 'untitled' for s in sources]},
    }
    return graph, warnings
