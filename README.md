# Hetero ISP — Prof. Linda · Project Tracker

A live, interactive project-management dashboard that reads a Google Sheet
workbook in real time and renders an executive-grade tracking view. Built
the same way as the Zydus ERS Tracker (Flask + Google Sheets, deployed on
Render) — no service-account credentials needed because the sheet is shared
_"Anyone with the link → Viewer"_.

**Live data source:** `https://docs.google.com/spreadsheets/d/1Rzqvjm8rqbRsYB9LTu3P9FPWVTD1VZdAapKbXRdIYAI/`

---

## What it does

The workbook's columns are **auto-mapped** — reordering columns, renaming
them slightly, or adding new ones keeps working with no code change. Every
KPI, chart, health band, delay and risk is **derived** from status + dates +
owners, so the dashboard works even though this workbook has fewer columns
than a full PM template.

### Pages
1. **Executive** — KPI cards (total, completed, active, overdue, delayed, upcoming, avg progress) + status/health/monthly charts + priority list.
2. **Timeline** — interactive Gantt with Week / Month / Quarter zoom; overdue bars in red; today line.
3. **Deliverables** — grouped tree (Client › Phase) with owners, dates, progress and delay.
4. **Calendar** — month view of start dates, due dates, overdue items and meetings; prev/next/today.
5. **Pending Actions** — due-in-7-days, overdue, blocked, in-review, pending approval, unassigned.
6. **Team Workload** — tasks per owner, completed vs pending, average progress bars + charts.
7. **Project Health** — weighted health score gauge + band breakdown + attention list.
8. **Risks** — auto-detected: critical/missed deadlines, blocked, dependencies, missing owners, pending approvals, high workload.
9. **Charts** — status, health, by-owner (stacked), monthly trend (line), progress buckets.

### Everywhere
- Global **search**, filters (status / owner / health / month), **drill-down** modal on any row or bar.
- **Upload Excel** button — swap the data source at runtime (`.xlsx/.xls/.xlsm/.csv`), everything refreshes. Click the source badge to return to the live sheet.
- **Dark / light** toggle, sticky nav, responsive (desktop / tablet / mobile), auto-refresh every 90s.

---

## Run locally

```bash
cd ISP-Linda-Tracker
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
python app.py
```

Open http://localhost:5010

## Deploy to Render

Push this folder to a Git repo and create a **Web Service** (or use the
included `render.yaml` Blueprint). Key settings:

- Build: `pip install -r requirements.txt`
- Start: `gunicorn app:app --bind 0.0.0.0:$PORT --timeout 120 --workers 2`

### Environment variables
| Var | Purpose | Default |
|-----|---------|---------|
| `TRACKER_SHEET_ID` | Google Sheet ID | the ISP Linda sheet |
| `TRACKER_SHEET_TAB` | Tab name (blank = first tab) | _blank_ |
| `PROJECT_NAME` / `PROJECT_CLIENT` / `PROJECT_ASSOCIATION` | Header labels | Hetero ISP — Prof. Linda / Hetero / ESC |
| `SECRET_KEY` | Flask session key | auto-generated on Render |

## Project structure
```
app.py            Flask routes (/, /api/data, /api/upload, /api/use-live)
data.py           fetch → auto-map columns → normalise → derive metrics
config.py         sheet id, project labels, status vocabulary
templates/index.html   dashboard shell
static/css/styles.css  theme (light + dark)
static/js/app.js       all views, charts, filters, drill-down
```

## Notes
- The sheet must stay shared as **Anyone with the link → Viewer** for the
  live read to work. If it's ever made private, add a Google Apps Script /
  service-account fallback (as in the Zydus tracker).
- Uploaded workbooks are cached in `uploads/` until replaced or until you
  click the source badge to return to live.
