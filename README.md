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
- **Or draw it by hand.** Turn on **✎ Edit diagram** to reveal the
  editing tools: a component palette (drag a Table/View/Column/Measure
  chip onto the canvas, or click one to add it at the current view's
  center), **⇄ Connect** to drag a link directly from one node to
  another, and **+ Node**/**+ Edge** forms if you'd rather type it in.
  Double-click anything to edit its details; select it and press
  Delete to remove it — every delete offers a one-tap Undo, including
  correctly restoring a deleted node's connected edges. Build a
  diagram from a blank canvas, or touch up what got traced
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
- **A real in-app guide, not just this README.** Click **?** in the
  header for a walkthrough of every feature above, without leaving
  the app.
- **Usable on a phone or tablet, not just a wide desktop monitor.**
  The three-column layout collapses to a single scrolling column
  below 860px, and the canvas toolbar, palette, and legend all reflow
  instead of overflowing on narrow screens.

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
layer on top, and they work two ways:

**Bring your own key (the normal path).** Click **AI: Off** in the
header and paste in an API key for Anthropic, OpenRouter, or your own
custom OpenAI-compatible endpoint (a local model via Ollama/LM Studio,
or your org's own gateway). That credential is stored in your
browser's `localStorage` only — never on any server, never in this
repo — and sent to `/api/ask` / `/api/report` only as part of your own
requests, which forward it straight to the provider you picked and
discard it once that single call finishes (see
`lib/llmClient.js:resolveClientCredential`). There's no account
system and no database here for it to live in even if that were the
intent. Each person using a deployment brings their own account, so
there's no shared usage or shared cost for whoever runs the
deployment to worry about.

**A deployment-wide default (optional, for the person who runs the
deployment).** If you'd rather every visitor get AI features without
each needing their own key, set `LLM_PROVIDER` plus that provider's
variables in Vercel's environment variables (see `.env.example` for
the full list) — this becomes the fallback whenever a visitor hasn't
set their own credential. The footer shows whether a deployment
default is active (`api/model-info.js` — read-only, never a key).

A couple of things worth knowing regardless of which path you use:
- Claude is available through both `anthropic` (direct) and
  `openrouter`, but it's never free either way — a new Anthropic
  account gets a one-time trial credit (a few dollars), then it's
  pay-per-token; on OpenRouter, Claude is always listed as paid, never
  in the free tier there.
- OpenRouter itself is free to get a key for at
  [openrouter.ai/keys](https://openrouter.ai/keys) (no card required)
  — free-tier *models* (Llama, DeepSeek, and similar) exist there too,
  billed at $0, separate from whether Claude specifically is free.

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
3. *(Optional)* Want Ask AI / Reports too? Usually nothing to do here
   — visitors bring their own key from inside the app. Only set up a
   deployment-wide default provider if you want AI features to work
   for every visitor without them supplying anything — see
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
correspondingly looser. For the optional AI features, two different
things are true depending on which path is active: a deployment-wide
key (set via Vercel environment variables) never reaches the browser,
same as always — every call happens inside a Vercel function. A
visitor's own bring-your-own-key credential, by contrast, *does* live
in their browser (`localStorage`) by design — that's the entire point
of BYOK, and it's their own key for their own account, not a shared
secret this app is responsible for protecting. It's sent to this
app's own `/api/ask` / `/api/report` per request and forwarded
straight to the provider, never logged or persisted server-side. All
endpoints are rate-limited per visitor, capped on body size, timed
out, and (optionally) restricted to your deployed origin. Security
headers lock down scripts, framing, and permissions site-wide. This
is a real, layered defense for a small app — not a claim that it's
immune to a determined attacker.

Free OpenRouter models are third-party-hosted and not guaranteed
available or private in the way a paid, contracted API is — avoid
using them (Ask AI / Reports only — lineage extraction is unaffected)
on genuinely sensitive production source.

## Credits

Created by **Bernadino T. Domongdong** —
[bernadinodomongdong.github.io/mysite](https://bernadinodomongdong.github.io/mysite/)

Licensed under MIT.
