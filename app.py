"""Hetero ISP (Prof. Linda) — live project tracking dashboard.

Flask app that reads a public Google Sheet live (gviz CSV) and renders an
interactive management dashboard. An Excel/CSV upload swaps the data source
at runtime with no code change: the last upload is cached and served until
replaced or until "Live Sheet" is selected again.

Render startCommand: gunicorn app:app
"""
from __future__ import annotations

import os
import time

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

from config import (
    ALLOWED_UPLOAD_EXTS,
    PROJECT_ASSOCIATION,
    PROJECT_CLIENT,
    PROJECT_NAME,
    SECRET_KEY,
    UPLOAD_DIR,
)
from data import build_records, fetch_sheet_rows, rows_from_excel

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB uploads

os.makedirs(UPLOAD_DIR, exist_ok=True)

# In-process cache. `_uploaded_path` overrides the live sheet until cleared.
_cache: dict = {"payload": None, "ts": 0.0}
_CACHE_TTL = 45  # seconds — keep the live view fresh without hammering gviz
_uploaded_path: dict = {"path": None, "name": None}


def _load_payload(force: bool = False) -> dict:
    """Return the analytics payload from the active source (upload > sheet),
    memoised briefly so rapid UI polls don't refetch every time."""
    if _uploaded_path["path"]:
        rows = rows_from_excel(_uploaded_path["path"])
        payload = build_records(rows)
        payload["source"] = "upload"
        payload["source_name"] = _uploaded_path["name"]
        return payload

    now = time.time()
    if not force and _cache["payload"] and (now - _cache["ts"] < _CACHE_TTL):
        return _cache["payload"]

    rows = fetch_sheet_rows()
    payload = build_records(rows)
    payload["source"] = "google-sheet"
    payload["source_name"] = "Live Google Sheet"
    _cache["payload"] = payload
    _cache["ts"] = now
    return payload


@app.route("/")
def index():
    return render_template(
        "index.html",
        project_name=PROJECT_NAME,
        client=PROJECT_CLIENT,
        association=PROJECT_ASSOCIATION,
    )


@app.route("/api/data")
def api_data():
    force = request.args.get("refresh") == "1"
    payload = _load_payload(force=force)
    return jsonify(payload)


@app.route("/api/upload", methods=["POST"])
def api_upload():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "No file provided."}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTS:
        return jsonify({
            "ok": False,
            "error": f"Unsupported file type '{ext}'. Use .xlsx, .xls, .xlsm or .csv.",
        }), 400
    safe = secure_filename(f.filename) or "upload" + ext
    path = os.path.join(UPLOAD_DIR, safe)
    f.save(path)
    try:
        rows = rows_from_excel(path)
        payload = build_records(rows)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Could not read workbook: {e}"}), 400
    if not payload.get("records"):
        return jsonify({"ok": False, "error": "No rows found in the uploaded workbook."}), 400
    _uploaded_path["path"] = path
    _uploaded_path["name"] = f.filename
    payload["source"] = "upload"
    payload["source_name"] = f.filename
    return jsonify(payload)


@app.route("/api/use-live", methods=["POST"])
def api_use_live():
    """Drop the uploaded workbook and go back to the live Google Sheet."""
    _uploaded_path["path"] = None
    _uploaded_path["name"] = None
    _cache["ts"] = 0.0
    payload = _load_payload(force=True)
    return jsonify(payload)


@app.route("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(
        os.path.join(app.root_path, "static"), "favicon.svg",
        mimetype="image/svg+xml",
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5010")), debug=True)
