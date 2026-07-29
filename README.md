# Blueline

*AI-traced — or hand-drawn — data lineage for SSAS modernization work.*

A blueprint doesn't just show a structure — it traces how every part
carries load back to the foundation. **Blueline** does the same for a
data model: paste in SQL, DAX, or Power Query (M) source and it traces
where every table, column, and measure actually comes from, draws the
result as a lineage diagram, and lets you interrogate it — in plain
English — before you touch anything in production. Prefer to draw it
yourself, or fix up what the AI got wrong? The diagram is fully
hand-editable too — add, connect, and delete nodes with or without any
AI involved.

Built for the unglamorous middle of a modernization project: the part
where nobody quite remembers which view three other reports secretly
depend on.

## What it does

- **Traces lineage from real source, not guesswork.** Paste or upload
  SQL, DAX, or M queries; the model reads them and extracts table- and
  column-level lineage as a structured graph — not a black box, every
  edge is grounded in something the source text actually says, and
  anything ambiguous is marked low/medium confidence rather than
  stated as fact.
- **Or draw it by hand — with or without AI.** Turn on "Edit diagram"
  to add nodes, drag a connector from one node to another to link
  them, or fill in a form-based "+ Edge." Double-click anything to
  edit or delete it. Build a diagram from a blank canvas, or touch up
  what the AI inferred — nothing here requires AI involvement, and
  running inference again always asks first before it would overwrite
  manual work.
- **Draws it like a blueprint.** Confirmed lineage (including anything
  entered by hand) traces as a solid line; AI-inferred, not-yet-
  verified lineage draws dashed — the same way an engineer pencils in
  a detail before it's checked. Click any node to see exactly what
  feeds it and what it feeds.
- **Answers questions about the graph.** The "Ask AI" tab is grounded
  strictly in the lineage graph currently loaded — it says so plainly
  when something isn't represented, instead of guessing.
- **Writes the documentation for you.** One click generates a
  Markdown documentation report or an impact-analysis report (what
  breaks, and how much, if a given table or column changes),
  downloadable straight away.
- **Exports and imports everything.** Save the graph as JSON (to pick
  back up later, or hand to a teammate — this also preserves node
  positions, so a hand-arranged layout survives), export the edge
  list as CSV for a spreadsheet review, snapshot the diagram as PNG,
  or import a previously exported JSON graph to keep working on it.
- **Bring your own model.** Runs on [OpenRouter](https://openrouter.ai)
  by default — one key, your choice of free or paid models, switchable
  by editing a single line in `.env`. Prefer a model running on your
  own machine (Ollama, LM Studio) or your org's own LLM gateway?
  Point `CUSTOM_LLM_BASE_URL` at it instead. Already have a direct
  Anthropic key and don't want a middleman? That works too. See
  [Choosing a model](#choosing-a-model) below.

## Built with

Plain HTML/CSS/JS on the frontend (cytoscape.js, plus the
cytoscape-edgehandles extension for drag-to-connect editing — no
framework, no build step) and three small Vercel serverless functions
on the backend, each making one focused call to whichever LLM provider
you've configured. No database — a graph lives in the browser until
you export it.

## Getting your own copy running

1. Push this repo to GitHub.
2. Import the repo into Vercel — framework preset **"Other."**
3. In Vercel's Environment Variables, set up a model provider (see
   [Choosing a model](#choosing-a-model) — OpenRouter is the fastest
   way to get a free key), plus optionally:
   - `ALLOWED_ORIGIN`, `GLOBAL_RATE_LIMIT_PER_MINUTE` — tighten
     security and abuse protection for production.
4. Deploy. Whatever key you use stays inside Vercel's environment
   store — it never touches the repo, the browser, or view-source.

**Testing locally:**
```bash
npm install -g vercel
cp .env.example .env   # paste your provider's key in here
vercel dev
```

> Vercel's default function-duration ceiling varies by plan.
> `infer-lineage` and `report` are configured for up to 60s in
> `vercel.json` since large query sets take longer to reason about —
> lower that if your plan rejects it at deploy time.

## Choosing a model

Blueline talks to an LLM through one small abstraction
(`lib/llmClient.js`), switched with a single `LLM_PROVIDER` variable —
see `.env.example` for the full, commented list of every variable
below.

- **`openrouter`** *(default)* — one API key, hundreds of models
  behind it. Get a free key at
  [openrouter.ai/keys](https://openrouter.ai/keys) (no card required),
  set `OPENROUTER_API_KEY`, and pick a model with `OPENROUTER_MODEL`:
  - **Free models** cost nothing but are rate-limited by OpenRouter
    (20 requests/minute; 50/day with no credits purchased, 1,000/day
    once you've bought $10 in credits). Good for trying Blueline out
    or light personal use.
  - **Paid models** are billed per-token by OpenRouter — no separate
    Anthropic/OpenAI/Google account needed — and are far more
    reliable at Blueline's structured-JSON extraction than the free
    tier.
  - `.env.example` ships a curated shortlist of both, picked for this
    app's actual workload (turning SQL/DAX/Power Query into
    strict-schema lineage JSON). Any other id from
    [openrouter.ai/models](https://openrouter.ai/models) works too —
    it's a starting shortlist, not an allowlist. OpenRouter's free
    roster in particular rotates as providers add and retire models;
    if a `:free` id ever stops working, that page's Price filter will
    show its current replacement.
- **`custom`** — a model running on your own machine (Ollama, LM
  Studio, vLLM — anything that speaks the OpenAI-compatible
  `/chat/completions` shape) or your organization's own internal LLM
  gateway. Set `CUSTOM_LLM_BASE_URL` (e.g. `http://localhost:11434/v1`
  for Ollama), `CUSTOM_LLM_MODEL`, and `CUSTOM_LLM_API_KEY` if your
  endpoint requires one.
- **`anthropic`** — calls the real Anthropic Messages API directly,
  no middleman, if you'd rather use a key you already have. Set
  `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL`.

The footer of the app shows which provider and model the current
deployment is configured to use, so you can confirm a change took
effect (this is read-only and never displays a key — see
`api/model-info.js`).

## Security, in brief

Whichever provider key you configure never reaches the browser — every
model call happens inside a Vercel function. Requests are rate-limited
per visitor and across all visitors combined, capped on body size,
timed out if the model hangs, and (optionally) restricted to your
deployed origin. Security headers lock down scripts, framing, and
permissions site-wide. This is a real, layered defense for a small
app — not a claim that it's immune to a determined attacker. As with
any AI-assisted tool: treat inferred lineage — anything marked
medium/low confidence — as a starting point for review, not a
finished audit. (Manually-entered nodes and edges default to "high"
confidence, since a person asserted them directly — but that's only
as trustworthy as whoever entered it.)

Free OpenRouter models in particular are third-party-hosted and not
guaranteed available or private in the way a paid, contracted API is
— avoid pasting genuinely sensitive production source into a
free-tier deployment.

## Credits

Created by **Bernadino T. Domongdong** —
[bernadinodomongdong.github.io/mysite](https://bernadinodomongdong.github.io/mysite/)

Licensed under MIT.
