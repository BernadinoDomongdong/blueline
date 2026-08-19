# Blueline

**Local, rule-based data lineage tracing for SSAS modernization work.**

Paste SQL, DAX, or Power Query (M) and Blueline traces table- and
column-level lineage with a real parser — no AI, no API key, nothing
leaves your deployment. Draw diagrams by hand instead, or touch up
what got traced automatically. Export it, document it, share it.

## Features

- **Automatic tracing** — SQL parsed with a real AST parser ([sqlglot](https://github.com/tobymao/sqlglot)); DAX/M read via targeted pattern matching
- **Manual editing** — full drag/click diagram editor: add, connect, edit, delete, undo
- **Incremental tracing** — drag one source onto the canvas to merge it in without replacing the diagram
- **Column drill-down** — click a table to expand its traced columns inline
- **Confidence-coded diagrams** — solid line = high confidence, dashed = lower confidence
- **Optional AI** — "Ask AI" / "Reports" tabs, bring your own key (Anthropic, OpenRouter, or any OpenAI-compatible endpoint) or set a deployment-wide default
- **Export / import** — JSON (round-trips node positions), CSV, PNG
- **Built-in demo & in-app guide** — try it before pasting anything real
- **Dark / light themes**, responsive down to mobile

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Plain HTML/CSS/JS — the lineage diagram is a self-built DOM+SVG canvas (`public/js/graph/`), no graph library, no framework, no build step |
| Lineage engine | Python (`api/infer-lineage.py`) — [sqlglot](https://github.com/tobymao/sqlglot), zero external calls |
| AI features (optional) | Node.js (`api/ask.js`, `api/report.js`) |
| Data store | None — a graph lives in the browser until you export it |
| Hosting | [Vercel](https://vercel.com) (Python and Node functions side by side) |

## How Lineage Tracing Works

| Source | Method | Confidence |
|---|---|---|
| SQL | Real AST parse — resolves joins, aliases, aggregates, and `CREATE VIEW` / `CTAS` / `INSERT...SELECT` / `SELECT...INTO` targets | High — drops to table-level **Low** only for an unqualified column with 2+ tables in scope |
| DAX | Pattern match on `Name = expr` measure definitions, `Table[Column]` and `[Measure]` references | Medium — **Low** if a referenced measure isn't defined in the file |
| Power Query (M) | Pattern match on `let...in` steps, chained by reference | Medium |

## Quick Start

**Prerequisites:** Node 24.x, Python 3.9+, a [Vercel](https://vercel.com) account.

1. Push this repo to GitHub.
2. Import it into [Vercel](https://vercel.com/new) — framework preset **Other**. Vercel auto-detects both the Python function (`requirements.txt`) and the Node functions (`package.json`). No environment variables required.
3. Deploy. Lineage tracing works immediately with zero config.

**Run locally:**

```bash
npm install -g vercel
pip install -r requirements.txt
cp .env.example .env   # optional — only needed for AI features locally
vercel dev
```

## Configuration (all optional)

Nothing below is required — lineage tracing needs zero environment
variables. Set these only if you want every visitor to get AI
features by default instead of bringing their own key (see
`.env.example` for the full, commented list).

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `anthropic`, `openrouter`, or `custom` — unset means visitors bring their own key |
| `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `CUSTOM_LLM_*` | Credentials for the chosen provider |
| `ALLOWED_ORIGIN` | Restrict `/api/*` to your deployed origin |
| `GLOBAL_RATE_LIMIT_PER_MINUTE` | Shared AI-endpoint request budget (default 60) |

A visitor's own bring-your-own-key credential lives in their
browser's `localStorage` only — never committed, never stored
server-side.

## Security

- Lineage extraction makes no network call — nothing to leak, nothing to rate-limit beyond plain compute abuse.
- A deployment-wide key (if set) never reaches the browser; a visitor's own BYOK key never reaches this app's server beyond a single forwarded request.
- Every `/api/*` endpoint is rate-limited, body-size-capped, timed out, and origin-checkable.
- Strict security headers (CSP, HSTS, X-Frame-Options, and more) are set site-wide.

This is a real, layered defense for a small app — not a claim that it's immune to a determined attacker.

## License

MIT — see [LICENSE](LICENSE).

Created by **Bernadino T. Domongdong** — [bernadinodomongdong.github.io/mysite](https://bernadinodomongdong.github.io/mysite/)
