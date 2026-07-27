# ESC Dashboard — Hetero ISP (Prof. Linda)

A live, interactive project-management dashboard ("**ESC Dashboard**") for
the **Hetero ISP (Prof. Linda) / ESC endorsement program**. It is a **pure static site** —
no backend. The browser reads the Google Sheet workbook live via Google's
**gviz JSONP** endpoint (CORS-safe) and parses Excel/CSV uploads in-browser
with **SheetJS**. Deployed as a Render **Static Site** (free, never sleeps).

**Live data source:** `https://docs.google.com/spreadsheets/d/1Rzqvjm8rqbRsYB9LTu3P9FPWVTD1VZdAapKbXRdIYAI/`

---

## What it does

Workbook columns are **auto-mapped** — reordering, renaming, or adding
columns keeps working with no code change. Every KPI, chart, health band,
delay and risk is **derived** from status + dates + owners.

### Pages
1. **Executive** — KPI cards + status/health/monthly charts + priority list.
2. **Timeline** — Gantt with Week / Month / Quarter zoom; overdue in red; today line.
3. **Deliverables** — grouped tree (Client › Phase) with owners, dates, progress, delay.
4. **Calendar** — start dates, due dates, overdue items, meetings; prev/next/today.
5. **Pending Actions** — due-in-7-days, overdue, blocked, in-review, pending approval, unassigned.
6. **Team Workload** — tasks per owner, completed vs pending, average progress.
7. **Project Health** — weighted health-score gauge + band breakdown.
8. **Risks** — auto-detected: missed deadlines, blocked, dependencies, missing owners, high workload.
9. **Charts** — status, health, by-owner (stacked), monthly trend, progress buckets.

### Everywhere
- Global **search**, filters (status / owner / health / month), **drill-down** modal.
- **Upload Excel/CSV** — parsed entirely in the browser; click the source badge to return to the live sheet.
- **Dark / light** toggle, sticky nav, responsive, auto-refresh every 90s.

---

## Run locally

No build step. Serve the `public/` folder with any static server:

```bash
cd ISP-Linda-Tracker/public
python -m http.server 5010
```

Open http://localhost:5010 (serving over http/https is required — the gviz
script tag won't load from a `file://` page).

## Deploy to Render (Static Site)

Push to GitHub, then **New → Static Site** (or import the `render.yaml`
Blueprint) pointing at this repo:

- Publish directory: `public`
- Build command: _(none)_
- SPA rewrite `/* → /index.html` (already in `render.yaml`)

Auto-deploys on every push to `main`. Because the sheet is read live in the
browser, data changes never need a redeploy.

## Structure
```
public/
  index.html        app shell (loads Chart.js + SheetJS from CDN)
  css/styles.css    theme (light + dark)
  js/data.js        gviz JSONP read, column auto-map, metric derivation, upload parsing
  js/app.js         all 9 views, charts, filters, drill-down
render.yaml         Render Static Site blueprint
```

## Notes
- The sheet must stay shared **Anyone with the link → Viewer** for the live
  read to work.
- To point at a different workbook, edit `PROJECT.sheetId` (and optionally
  `sheetTab`) at the top of `public/js/data.js`.
