# Blueline

*Local, rule-based data lineage — hand-drawn, or traced automatically — for SSAS modernization work.*

A blueprint doesn't just show a structure — it traces how every part
carries load back to the foundation. **Blueline** does the same for a
data model: paste in SQL, DAX, or Power Query (M) source and it traces
where every table, column, and measure actually comes from, draws the
result as a lineage diagram, and lets you export it, document it, and
build on it by hand.

Built for the unglamorous middle of a modernization project: the part
where nobody quite remembers which view three other reports secretly
depend on.

## What it does

- **Traces lineage from real source — no AI, no API key, nothing
  leaves the deployment.** Paste or upload SQL, DAX, or M queries;
  SQL is parsed with a real parser
  ([sqlglot](https://github.com/tobymao/sqlglot)) into an actual
  syntax tree — joins, aliases, aggregates, CTAS/INSERT/SELECT INTO
  targets are all resolved structurally, not guessed at. DAX and M
  have no comparable open-source parser available, so those are read
  with documented, targeted pattern-matching instead (see
  [How lineage is traced](#how-lineage-is-traced) for exactly what
  that does and doesn't catch).
- **Or draw it by hand.** Turn on "Edit diagram" to add nodes, drag a
  connector from one node to another to link them, or fill in a
  form-based "+ Edge." Double-click anything to edit or delete it.
  Build a diagram from a blank canvas, or touch up what got traced
  automatically — running extraction again always asks first before
  it would overwrite manual work.
- **Draws it like a blueprint.** High-confidence lineage (including
  anything entered by hand) traces as a solid line; anything less
  certain draws dashed — the same way an engineer pencils in a detail
  before it's checked. Click any node to see exactly what feeds it
  and what it feeds.
- **Answers questions about the graph — optionally.** The "Ask AI" tab
  is a genuinely separate, optional feature: if you configure an LLM
  provider (see [Optional: AI features](#optional-ai-features)), it
  answers questions grounded strictly in the lineage graph currently
  loaded. Without a provider configured, the tab just says so plainly
  — the rest of the app works exactly the same either way.
- **Writes the documentation for you — also optional.** Same deal:
  with a provider configured, one click generates a Markdown
  documentation report or an impact-analysis report (what breaks, and
  how much, if a given table or column changes).
- **Exports and imports everything.** Save the graph as JSON (to pick
  back up later, or hand to a teammate — this also preserves node
  positions, so a hand-arranged layout survives), export the edge
  list as CSV for a spreadsheet review, snapshot the diagram as PNG,
  or import a previously exported JSON graph to keep working on it.
- **See it in action first.** The empty state has a "Load demo" button
  that drops in a small pre-built lineage graph — mixing traced and
  hand-edited nodes, all four edge types, and all three confidence
  levels — so you can click around, try Inspect/Ask/Reports/Export,
  before pasting in anything real.
- **Dark or light, your call.** The default is a dark cyanotype-
  blueprint theme; the toggle in the header switches to a light
  drafting-paper palette and updates an already-drawn diagram
  immediately.

## How lineage is traced

**SQL** is parsed with sqlglot into a real syntax tree. Table-level
lineage comes from `FROM`/`JOIN` against a `CREATE VIEW`, `CREATE
TABLE AS`, `INSERT INTO ... SELECT`, or `SELECT ... INTO` target (a
bare `SELECT` with no such target uses the source's filename as an
implicit target, so ad hoc queries still produce useful output).
Column-level lineage comes from resolving each output expression's
column references against the query's table aliases. Aggregate
functions (`SUM`, `COUNT`, `AVG`, `MIN`, `MAX`) mark that edge as
"aggregated" rather than "direct." All of this is deterministic, so
it's marked **high confidence** — except one case: an unqualified
column with more than one table in scope (`SELECT Total FROM Orders o
JOIN Refunds r ...` — which table is `Total` from?) can't be resolved
without a real schema, so it's linked at the table level only, marked
**low confidence**, with a warning explaining why.

**DAX and Power Query (M)** have no comparable open-source parser to
build on, so both are read with targeted regex-based pattern matching
instead of a real parse: DAX measure definitions
(`MeasureName = expression`, one per unindented line — the format
Tabular Editor and DAX Studio export in), `Table[Column]` and
`[OtherMeasure]` references within them, and aggregation/`FILTER`
detection for edge typing. M is read similarly, matching Power Query's
usual one-step-per-line `let...in` format, chaining each step to
whichever prior step(s) it references by name. Because this is
pattern-matching rather than a real parse, every DAX/M-derived edge is
marked **medium confidence** even when the match is clean — and low
confidence specifically when a measure references a name that isn't
defined anywhere in the pasted file. Treat DAX/M output as a strong
starting draft, not a finished audit; the manual editor is there for
exactly this kind of touch-up.

## Optional: AI features

Lineage extraction never uses an LLM, full stop — the section above is
the whole story. **Ask AI** and **Reports** are a separate, optional
layer on top, switched on the moment you configure a provider.
Without one configured, those two tabs stay visibly disabled rather
than failing confusingly.

Configured with a single `LLM_PROVIDER` variable (see `.env.example`
for the full, commented list):

- **`openrouter`** — one API key, hundreds of models. Get a free key
  at [openrouter.ai/keys](https://openrouter.ai/keys) (no card
  required) and set `OPENROUTER_API_KEY`. The header's Free/Paid
  toggle and dropdown are populated by fetching OpenRouter's live
  model catalog (cached for 10 minutes) and filtering it — never a
  hardcoded list, since free-tier availability rotates often enough
  that a hardcoded snapshot goes stale within weeks. A client-supplied
  model choice is always re-validated against that live catalog
  server-side before it's ever sent upstream
  (`llmClient.sanitizeModelChoice`) — the picker can't be used to make
  Blueline call an arbitrary model. Set `ALLOW_PAID_MODELS=false` to
  remove paid models from the picker (and reject a paid selection
  server-side) if you're deploying somewhere public and want
  predictable costs.
- **`custom`** — a model running on your own machine (Ollama, LM
  Studio, vLLM) or your organization's own OpenAI-compatible gateway.
  Set `CUSTOM_LLM_BASE_URL`, `CUSTOM_LLM_MODEL`, and
  `CUSTOM_LLM_API_KEY` if it requires one. A single fixed model, so
  the picker hides itself.
- **`anthropic`** — calls the real Anthropic Messages API directly.
  Set `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL`. Also a
  single fixed model.

The footer shows which provider/model (if any) is currently active —
read-only, never a key (`api/model-info.js`).

## Built with

Plain HTML/CSS/JS on the frontend (cytoscape.js, plus the
cytoscape-edgehandles extension for drag-to-connect editing — no
framework, no build step). The backend is two small runtimes side by
side: a **Python** function for lineage extraction
(`api/infer-lineage.py`, `sqlglot`-based, no external calls at all),
and small **Node** functions for the optional AI features
(`api/ask.js`, `api/report.js`) plus a couple of read-only endpoints.
No database — a graph lives in the browser until you export it.

## Getting your own copy running

1. Push this repo to GitHub.
2. Import the repo into Vercel — framework preset **"Other."** Vercel
   auto-detects both runtimes: `api/infer-lineage.py` from
   `requirements.txt` at the project root, everything else from
   `package.json`. No provider key is required for this step —
   lineage extraction works with zero environment variables set.
3. *(Optional)* Want Ask AI / Reports too? Set up a provider — see
   [Optional: AI features](#optional-ai-features).
4. *(Optional)* `ALLOWED_ORIGIN`, `GLOBAL_RATE_LIMIT_PER_MINUTE` —
   tighten security and abuse protection for a public deployment.
5. Deploy. Whatever key you use (if any) stays inside Vercel's
   environment store — it never touches the repo, the browser, or
   view-source.

**Testing locally:**
```bash
npm install -g vercel
pip install -r requirements.txt   # only needed for local dev; Vercel installs it itself on deploy
cp .env.example .env              # optional — only if you want Ask AI / Reports locally too
vercel dev
```

> Vercel's default function-duration ceiling varies by plan. `report`
> is configured for up to 60s in `vercel.json` since writing a longer
> report takes a while; `infer-lineage` only needs 15s since it's a
> local computation with no upstream round-trip to wait on. Lower
> either if your plan rejects the value at deploy time.

## Security, in brief

Lineage extraction makes no network call of any kind — there's
nothing to leak and nothing to rate-limit against a paid budget, only
against plain compute abuse, so that endpoint's limits are
correspondingly looser. For the optional AI features, whichever
provider key you configure never reaches the browser — every model
call happens inside a Vercel function. All endpoints are rate-limited
per visitor, capped on body size, timed out, and (optionally)
restricted to your deployed origin. Security headers lock down
scripts, framing, and permissions site-wide. This is a real, layered
defense for a small app — not a claim that it's immune to a
determined attacker.

Free OpenRouter models are third-party-hosted and not guaranteed
available or private in the way a paid, contracted API is — avoid
using them (Ask AI / Reports only — lineage extraction is unaffected)
on genuinely sensitive production source.

## Credits

Created by **Bernadino T. Domongdong** —
[bernadinodomongdong.github.io/mysite](https://bernadinodomongdong.github.io/mysite/)

Licensed under MIT.
