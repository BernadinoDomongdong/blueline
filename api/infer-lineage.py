"""
api/infer-lineage.py — Vercel Python serverless function.

The core "AI" for lineage extraction, replaced end to end: this parses
pasted SQL/DAX/M with a real SQL parser (sqlglot) plus documented
heuristics for DAX and M (see api/_lineage_engine.py) and returns a
lineage graph. No LLM call, no API key, nothing leaves this function.
/api/ask and /api/report are unrelated and still optionally use an LLM
(see lib/llmClient.js) — this endpoint never did and no longer can.
"""

import json
import os
import time
from http.server import BaseHTTPRequestHandler

from _lineage_engine import extract_lineage

MAX_SOURCES = 20
MAX_TOTAL_CONTENT_CHARS = 80_000
MAX_BODY_BYTES = 400 * 1024
ALLOWED_DIALECTS = {'sql', 'dax', 'm', 'other'}

# Local parsing has no per-request $ cost to protect (unlike the old
# LLM-backed version), so this is a much looser, DoS-hygiene-only
# limit rather than a budget guard — see lib/rateLimit.js for the
# fuller discussion of what an in-memory, single-instance limiter
# does and doesn't cover; the same caveats apply here.
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX = 30
_rate_buckets = {}  # {client_key: (window_start_epoch, count)}


def _client_key(headers):
    forwarded = headers.get('x-forwarded-for', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return 'unknown'


def _check_rate_limit(key):
    now = time.time()
    window_start, count = _rate_buckets.get(key, (now, 0))
    if now - window_start >= RATE_LIMIT_WINDOW_SECONDS:
        _rate_buckets[key] = (now, 1)
        return True
    if count >= RATE_LIMIT_MAX:
        return False
    _rate_buckets[key] = (window_start, count + 1)
    return True


def _origin_allowed(headers):
    allowed = os.environ.get('ALLOWED_ORIGIN')
    if not allowed:
        return True
    origin = headers.get('origin')
    if not origin:
        return True
    return origin == allowed


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not _origin_allowed(self.headers):
            self._send_json(403, {'error': 'Origin not allowed.'})
            return

        client_key = _client_key(self.headers)
        if not _check_rate_limit(client_key):
            self._send_json(429, {'error': 'Too many requests — please slow down and try again shortly.'})
            return

        try:
            declared_length = int(self.headers.get('content-length', 0))
        except ValueError:
            declared_length = 0
        if declared_length > MAX_BODY_BYTES:
            self._send_json(413, {'error': 'Request body is too large.'})
            return

        # Read at most MAX_BODY_BYTES + 1 regardless of the declared
        # header, so a missing or dishonest Content-Length can't be
        # used to stream an unbounded body past the check above.
        raw = self.rfile.read(min(declared_length, MAX_BODY_BYTES + 1) or MAX_BODY_BYTES + 1)
        if len(raw) > MAX_BODY_BYTES:
            self._send_json(413, {'error': 'Request body is too large.'})
            return

        try:
            payload = json.loads(raw.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {'error': 'Request body must be valid JSON.'})
            return

        sources = payload.get('sources') if isinstance(payload, dict) else None
        if not isinstance(sources, list) or len(sources) == 0:
            self._send_json(400, {'error': 'Provide at least one source (sources: [{ name, dialect, content }]).'})
            return
        if len(sources) > MAX_SOURCES:
            self._send_json(400, {'error': f'Too many sources — the limit is {MAX_SOURCES} per request.'})
            return

        clean_sources = []
        total_chars = 0
        for s in sources:
            if not isinstance(s, dict) or not isinstance(s.get('content'), str) or not s.get('content', '').strip():
                self._send_json(400, {'error': 'Each source needs non-empty "content".'})
                return
            content = s['content']
            total_chars += len(content)
            name = s.get('name')
            name = name.strip()[:200] if isinstance(name, str) and name.strip() else 'untitled'
            dialect = s.get('dialect') if s.get('dialect') in ALLOWED_DIALECTS else 'other'
            clean_sources.append({'name': name, 'dialect': dialect, 'content': content})

        if total_chars > MAX_TOTAL_CONTENT_CHARS:
            self._send_json(400, {'error': f'Combined source content is too large (limit {MAX_TOTAL_CONTENT_CHARS} characters).'})
            return

        try:
            graph, warnings = extract_lineage(clean_sources)
        except Exception as ex:  # a parsing bug should surface as a clean 500, not a raw traceback to the client
            self._send_json(500, {'error': f'Unexpected error while extracting lineage: {ex}'})
            return

        self._send_json(200, {'graph': graph, 'warnings': warnings})

    def do_GET(self):
        self._send_json(405, {'error': 'Method not allowed'})
