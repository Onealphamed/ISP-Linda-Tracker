"""Central configuration for the Hetero ISP (Prof. Linda) project tracker.

Every tunable — the source sheet, the project labels, and the status
vocabulary used to classify hand-typed cells — lives here so the rest of
the code has a single place to change.
"""
from __future__ import annotations

import os

# ── Data source ───────────────────────────────────────────────────────
# Public Google Sheet, read anonymously via the gviz CSV endpoint (works
# because the workbook is shared "Anyone with the link → Viewer"). No
# service-account credentials required.
SHEET_ID = os.environ.get(
    "TRACKER_SHEET_ID", "1Rzqvjm8rqbRsYB9LTu3P9FPWVTD1VZdAapKbXRdIYAI"
)
# Empty = the first/default tab, which is all this workbook has today.
SHEET_TAB = os.environ.get("TRACKER_SHEET_TAB", "")

# ── Project identity (shown in the header) ────────────────────────────
PROJECT_NAME = os.environ.get("PROJECT_NAME", "Hetero ISP — Prof. Linda")
PROJECT_CLIENT = os.environ.get("PROJECT_CLIENT", "Hetero")
PROJECT_ASSOCIATION = os.environ.get("PROJECT_ASSOCIATION", "ESC")

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me")

# Where uploaded workbooks are cached so a refresh keeps the last upload
# until the next one (or until the server restarts).
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "uploads"))
ALLOWED_UPLOAD_EXTS = {".xlsx", ".xlsm", ".xls", ".csv"}

# ── Status vocabulary ─────────────────────────────────────────────────
# Cells are hand-typed, so we accept synonyms and normalise to a small
# set of canonical classes that drive colour + progress everywhere.
STATUS_CLASSES = {
    "done": {
        "completed", "complete", "done", "closed", "finished", "delivered",
        "approved", "signed off", "signed-off", "live", "published", "yes",
    },
    "review": {
        "in review", "in-review", "review", "under review", "reviewing",
        "qa", "pending review", "for review",
    },
    "in_progress": {
        "in progress", "in-progress", "ongoing", "wip", "started",
        "work in progress", "active", "doing",
    },
    "blocked": {
        "blocked", "on hold", "on-hold", "stuck", "waiting", "pending client",
        "pending approval", "dependency", "held",
    },
    "not_started": {
        "yet to start", "not started", "not-started", "todo", "to do",
        "pending", "backlog", "planned", "new", "",
    },
}

# Progress % implied by a status class, used only when there is no explicit
# Progress/% column in the workbook.
STATUS_PROGRESS = {
    "done": 100,
    "review": 75,
    "in_progress": 50,
    "blocked": 25,
    "not_started": 0,
}

# Human labels for each class.
STATUS_LABELS = {
    "done": "Completed",
    "review": "In Review",
    "in_progress": "In Progress",
    "blocked": "Blocked",
    "not_started": "Yet to Start",
}

# Health thresholds (days of delay) → health band.
HEALTH_THRESHOLDS = [
    (10, "red"),      # > 10 days late  → critical
    (5, "orange"),    # 5–10 days late  → medium
    (1, "yellow"),    # 1–4 days late   → minor
]
