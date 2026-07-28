# Blueline

*AI-traced data lineage for SSAS modernization work.*

A blueprint doesn't just show a structure — it traces how every part
carries load back to the foundation. **Blueline** does the same for a
data model: paste in SQL, DAX, or Power Query (M) source, and it traces
where every table, column, and measure actually comes from, draws the
result as a lineage diagram, and lets you interrogate it — in plain
English — before you touch anything in production.

Built for the unglamorous middle of a modernization project: the part
where nobody quite remembers which view three other reports secretly
depend on.

## What it does

- **Traces lineage from real source, not guesswork.** Paste or upload
  SQL, DAX, or M queries; Claude reads them and extracts table- and
  column-level lineage as a structured graph — not a black box, every
  edge is grounded in something the source text actually says, and
  anything ambiguous is marked low/medium confidence rather than
  stated as fact.
- **Draws it like a blueprint.** Confirmed lineage traces as a solid
  line; AI-inferred, not-yet-verified lineage draws dashed — the same
  way an engineer pencils in a detail before it's checked. Click any
  node to see exactly what feeds it and what it feeds.
- **Answers questions about the graph.** The "Ask AI" tab is grounded
  strictly in the lineage graph currently loaded — it says so plainly
  when something isn't represented, instead of guessing.
- **Writes the documentation for you.** One click generates a
  Markdown documentation report or an impact-analysis report (what
  breaks, and how much, if a given table or column changes),
  downloadable straight away.
- **Exports and imports everything.** Save the graph as JSON (to pick
  back up later, or hand to a teammate), export the edge list as CSV
  for a spreadsheet review, snapshot the diagram as PNG, or import a
  previously exported JSON graph to keep working on it.

## Built with

Plain HTML/CSS/JS on the frontend (cytoscape.js for the graph, no
framework, no build step) and three small Vercel serverless functions
on the backend, each making one focused call to the real Anthropic
API. No database — a graph lives in the browser until you export it.

## Getting your own copy running

1. Push this repo to GitHub.
2. Get an Anthropic API key at
   [console.anthropic.com](https://console.anthropic.com/settings/keys).
3. Import the repo into Vercel — framework preset **"Other."**
4. In Vercel's Environment Variables, add:
   - `ANTHROPIC_API_KEY` — required.
   - `ANTHROPIC_MODEL` — optional, defaults to `claude-sonnet-5`.
   - `ALLOWED_ORIGIN`, `GLOBAL_RATE_LIMIT_PER_MINUTE` — optional,
     tighten security and abuse protection for production.
5. Deploy. Your key stays inside Vercel's environment store — it never
   touches the repo, the browser, or view-source.

**Testing locally:**
```bash
npm install -g vercel
cp .env.example .env   # paste your key in here
vercel dev
```

> Vercel's default function-duration ceiling varies by plan.
> `infer-lineage` and `report` are configured for up to 60s in
> `vercel.json` since large query sets take longer to reason about —
> lower that if your plan rejects it at deploy time.

## Security, in brief

`ANTHROPIC_API_KEY` never reaches the browser — every Claude call
happens inside a Vercel function. Requests are rate-limited per
visitor and across all visitors combined, capped on body size, timed
out if Claude hangs, and (optionally) restricted to your deployed
origin. Security headers lock down scripts, framing, and permissions
site-wide. This is a real, layered defense for a small app — not a
claim that it's immune to a determined attacker. As with any
AI-assisted tool: treat inferred lineage — anything marked
medium/low confidence — as a starting point for review, not a
finished audit.

## Credits

Created by **Bernadino T. Domongdong** —
[bernadinodomongdong.github.io/mysite](https://bernadinodomongdong.github.io/mysite/)

Licensed under MIT.
