/* ══════════════════════════════════════════════════════════════════
   Data engine (client-side) — the browser port of the old data.py.
   Reads the live Google Sheet via the gviz JSONP endpoint (CORS-safe,
   no backend), auto-maps columns, and derives every metric. The same
   buildRecords() also powers Excel/CSV uploads parsed with SheetJS.
   ══════════════════════════════════════════════════════════════════ */

const PROJECT = {
  name: "ESC Dashboard",
  client: "Hetero",
  association: "ESC",
  sheetId: "1Rzqvjm8rqbRsYB9LTu3P9FPWVTD1VZdAapKbXRdIYAI",
  sheetTab: "", // blank = first tab
  // gviz's JSON headers don't include the merged banner text, so this is
  // the fallback phase label when the sheet has no explicit "Phase N" header.
  defaultPhase: "Phase 1: Submission to ESC",
};

/* ─── Status vocabulary ──────────────────────────────────────────── */
const STATUS_CLASSES = {
  done: ["completed", "complete", "done", "closed", "finished", "delivered", "approved", "signed off", "signed-off", "live", "published", "yes"],
  review: ["in review", "in-review", "review", "under review", "reviewing", "qa", "pending review", "for review"],
  in_progress: ["in progress", "in-progress", "ongoing", "wip", "started", "work in progress", "active", "doing"],
  blocked: ["blocked", "on hold", "on-hold", "stuck", "waiting", "pending client", "pending approval", "dependency", "held"],
  not_started: ["yet to start", "not started", "not-started", "todo", "to do", "pending", "backlog", "planned", "new", ""],
};
const STATUS_PROGRESS = { done: 100, review: 75, in_progress: 50, blocked: 25, not_started: 0 };
const STATUS_LABELS_D = { done: "Completed", review: "In Review", in_progress: "In Progress", blocked: "Blocked", not_started: "Yet to Start" };
const HEALTH_THRESHOLDS = [[10, "red"], [5, "orange"], [1, "yellow"]];

/* ─── Canonical roles + header keywords (order = priority) ───────── */
const COLUMN_SYNONYMS = [
  ["sr_no", ["sr no", "sr.", "s.no", "serial", "sno", "id", "sl no"]],
  ["actual", ["actual completion", "actual", "completed on", "done on"]],
  ["start", ["start date", "start", "begin", "kickoff", "from date"]],
  ["end", ["end date", "due date", "due", "target date", "end", "deadline", "finish", "to date"]],
  ["meeting", ["meeting date", "meeting", "review date", "call date"]],
  ["tat", ["tat", "days", "duration", "turnaround", "effort", "timeline"]],
  ["qty", ["qty", "quantity", "count", "number of", "nos"]],
  ["progress", ["progress", "% complete", "percent", "completion %", "% done", "complete %"]],
  ["priority", ["priority", "urgency", "criticality"]],
  ["status", ["status", "state", "stage", "phase status"]],
  ["owner_oam", ["owner (oam)", "owner oam", "oam owner", "alphamed", "oam", "onealphamed"]],
  ["owner_hetero", ["owner (hetero)", "owner hetero", "hetero owner", "client owner", "hetero"]],
  ["reviewer", ["reviewer", "reviewed by", "approver", "qa by"]],
  ["owner", ["owner", "assignee", "responsible", "assigned to", "lead"]],
  ["dependencies", ["dependency", "dependencies", "depends on", "blocked by"]],
  ["approval", ["approval status", "approval", "approved", "sign off", "sign-off"]],
  ["category", ["category", "type", "workstream", "track"]],
  ["module", ["module", "component", "section"]],
  ["client", ["client", "customer", "account"]],
  ["association", ["association", "partner", "society", "body"]],
  ["version", ["version", "ver", "rev"]],
  ["comments", ["comments", "remarks", "notes", "comment", "remark"]],
  ["deliverable", ["deliverable", "task", "activity", "description", "work item", "milestone", "title", "name"]],
];

const norm = (s) => (s == null ? "" : String(s)).replace(/\s+/g, " ").trim().toLowerCase();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ─── Live read via gviz JSONP (no CORS, no backend) ─────────────── */
function loadLiveData(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const cb = "__gviz_" + Math.random().toString(36).slice(2);
    let done = false;
    const cleanup = (s) => { try { delete window[cb]; } catch {} if (s && s.parentNode) s.parentNode.removeChild(s); };
    window[cb] = (resp) => {
      done = true;
      const script = document.getElementById(cb);
      cleanup(script);
      try {
        if (!resp || !resp.table) return reject(new Error("Empty response from sheet"));
        const rows = gvizToRows(resp.table);
        const payload = buildRecords(rows);
        payload.source = "google-sheet";
        payload.source_name = "Live Sheet";
        resolve(payload);
      } catch (e) { reject(e); }
    };
    const params = `tqx=responseHandler:${cb};out:json&headers=1` + (PROJECT.sheetTab ? `&sheet=${encodeURIComponent(PROJECT.sheetTab)}` : "");
    const s = document.createElement("script");
    s.id = cb;
    s.src = `https://docs.google.com/spreadsheets/d/${PROJECT.sheetId}/gviz/tq?${params}`;
    s.onerror = () => { if (!done) { cleanup(s); reject(new Error("Could not reach the Google Sheet. Check it's shared 'Anyone with the link'.")); } };
    document.head.appendChild(s);
    setTimeout(() => { if (!done) { cleanup(document.getElementById(cb)); reject(new Error("Timed out reading the sheet.")); } }, timeoutMs);
  });
}

/* Convert a gviz table into [headerRow, ...dataRows] of string cells. */
function gvizToRows(table) {
  const headers = table.cols.map((c) => (c.label || c.id || "").trim());
  const isDate = table.cols.map((c) => c.type === "date" || c.type === "datetime");
  const rows = [headers];
  for (const r of table.rows) {
    const cells = (r.c || []).map((cell, i) => {
      if (!cell || cell.v == null || cell.v === "") return "";
      if (isDate[i]) { const iso = gvizDateToISO(cell.v); if (iso) return iso; }
      return cell.f != null ? String(cell.f) : String(cell.v);
    });
    rows.push(cells);
  }
  return rows;
}
// gviz encodes dates as the string "Date(2026,6,24)" — month is 0-indexed.
function gvizDateToISO(v) {
  const m = String(v).match(/Date\((\d+),(\d+),(\d+)/);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2] + 1, +m[3]];
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/* ─── Upload: parse Excel / CSV into a 2-D array ─────────────────── */
async function parseWorkbookFile(file) {
  let rows;
  if (/\.csv$/i.test(file.name)) {
    // Parse CSV as text so our own day-first date logic applies (matches the
    // sheet's DD/MM/YYYY convention) instead of SheetJS's US M/D/Y guess.
    rows = parseCSV(await file.text());
  } else {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    // raw:true keeps real dates as JS Date objects (unambiguous — .xlsx stores
    // dates as serials), converted to ISO ourselves.
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    rows = raw.map((r) => r.map((c) => (c instanceof Date ? isoOf(c) : c == null ? "" : String(c).trim())));
  }
  const payload = buildRecords(rows);
  payload.source = "upload";
  payload.source_name = file.name;
  if (!payload.records.length) throw new Error("No rows found in the uploaded workbook.");
  return payload;
}

/* Minimal RFC-4180-ish CSV parser (handles quotes, escaped quotes, commas
   and newlines inside quoted fields). */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field.trim()); field = ""; }
    else if (c === "\n") { row.push(field.trim()); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

/* ─── Header detection + column mapping ──────────────────────────── */
function findHeaderRow(rows) {
  const allKw = COLUMN_SYNONYMS.flatMap(([, ks]) => ks);
  let best = 0, bestScore = -1;
  rows.slice(0, 8).forEach((row, i) => {
    let score = 0;
    row.forEach((cell) => { const c = norm(cell); if (c && allKw.some((kw) => c.includes(kw) || kw.includes(c))) score++; });
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

function mapColumns(headers) {
  const nh = headers.map(norm);
  const used = new Set();
  const mapping = {};
  for (const [role, keywords] of COLUMN_SYNONYMS) {
    let bestCol = -1, bestScore = 0;
    nh.forEach((h, idx) => {
      if (used.has(idx) || !h) return;
      let score = 0;
      for (const kw of keywords) {
        if (h === kw) score = Math.max(score, 100);
        else if (kw.length >= 3 && (h.startsWith(kw) || kw.startsWith(h))) score = Math.max(score, 60);
        else if (new RegExp("\\b" + escRe(kw) + "\\b").test(h)) score = Math.max(score, 40);
      }
      if (score > bestScore) { bestCol = idx; bestScore = score; }
    });
    if (bestCol >= 0) { mapping[role] = bestCol; used.add(bestCol); }
  }
  if (!("deliverable" in mapping)) {
    const idx = nh.findIndex((h, i) => !used.has(i) && h);
    mapping.deliverable = idx >= 0 ? idx : (headers.length > 1 ? 1 : 0);
  }
  return mapping;
}

function extractPhase(headers) {
  for (const h of headers) { const m = String(h || "").match(/phase\s*[\dIVX]+.*/i); if (m) return m[0].trim(); }
  return "";
}

/* ─── Value parsing ──────────────────────────────────────────────── */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
function parseDateISO(val) {
  const v = String(val || "").trim();
  if (!v || /^(tbd|tba|na|n\/a|-|nil)$/i.test(v)) return null;
  let m;
  if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);          // ISO
  if ((m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {                            // dd/mm/yyyy (dayfirst)
    let [_, d, mo, y] = m; y = +y < 100 ? 2000 + +y : +y; return iso(y, +mo, +d);
  }
  if ((m = v.match(/^(\d{1,2})[\-\/ ]([A-Za-z]{3,})[\-\/ ](\d{2,4})$/))) {                       // 14-Aug-26
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo == null) return null;
    let y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return iso(y, mo + 1, +m[1]);
  }
  const d = new Date(v); return isNaN(d) ? null : iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function toInt(val) { const m = String(val || "").replace(/,/g, "").match(/-?\d+/); return m ? parseInt(m[0], 10) : null; }

function statusClass(raw) {
  const v = norm(raw);
  for (const [cls, vals] of Object.entries(STATUS_CLASSES)) if (vals.includes(v)) return cls;
  for (const [cls, vals] of Object.entries(STATUS_CLASSES)) for (const t of vals) if (t && v.includes(t)) return cls;
  return "not_started";
}
function healthBand(delay) { for (const [t, band] of HEALTH_THRESHOLDS) if (delay > t) return band; return "green"; }
const daysBetween = (a, b) => Math.round((a - b) / 864e5);

/* ─── Build the analytics payload ────────────────────────────────── */
function buildRecords(rows) {
  const today = todayDate();
  const base = {
    ok: false, project_name: PROJECT.name, client: PROJECT.client, association: PROJECT.association,
    phase: "", columns_detected: {}, records: [], today: isoOf(today), updated_at: new Date().toISOString(),
  };
  if (!rows || !rows.length) return base;

  const hi = findHeaderRow(rows);
  const headers = rows[hi].map((h) => String(h).trim());
  const colmap = mapColumns(headers);
  const phase = extractPhase(headers) || PROJECT.defaultPhase || "Phase 1";
  const cell = (row, role) => { const i = colmap[role]; return i == null || i >= row.length ? "" : String(row[i] || "").trim(); };

  const records = [];
  rows.slice(hi + 1).forEach((row, ridx) => {
    const name = cell(row, "deliverable");
    if (!name) return;

    const startD = parseDateISO(cell(row, "start"));
    const endD = parseDateISO(cell(row, "end"));
    const actualD = parseDateISO(cell(row, "actual"));
    const meetingD = parseDateISO(cell(row, "meeting"));
    const rawStatus = cell(row, "status");
    const scls = statusClass(rawStatus);

    const progRaw = toInt(cell(row, "progress"));
    let progress = progRaw != null ? progRaw : STATUS_PROGRESS[scls];
    progress = Math.max(0, Math.min(100, progress));
    const isDone = scls === "done";
    if (isDone) progress = 100;

    const end = endD ? new Date(endD + "T00:00:00") : null;
    let delay = 0;
    if (end) {
      if (isDone && actualD) delay = Math.max(0, daysBetween(new Date(actualD + "T00:00:00"), end));
      else if (!isDone) delay = Math.max(0, daysBetween(today, end));
    }
    const overdue = !!(end && !isDone && today > end);
    const daysRemaining = end && !isDone ? daysBetween(end, today) : null;
    const upcoming = daysRemaining != null && daysRemaining >= 0 && daysRemaining <= 7;
    const health = isDone ? "done" : healthBand(delay);

    const owners = [];
    ["owner", "owner_oam", "owner_hetero", "reviewer"].forEach((r) => {
      const v = cell(row, r); if (v && !/^(na|n\/a|-)$/i.test(v)) owners.push(v);
    });

    records.push({
      id: cell(row, "sr_no") || String(ridx + 1), phase, deliverable: name, qty: toInt(cell(row, "qty")),
      start: startD, end: endD, actual: actualD, meeting: meetingD,
      tat: toInt(cell(row, "tat")), status: rawStatus || STATUS_LABELS_D[scls], status_class: scls, status_label: STATUS_LABELS_D[scls],
      priority: cell(row, "priority"), owner_oam: cell(row, "owner_oam"), owner_hetero: cell(row, "owner_hetero"),
      reviewer: cell(row, "reviewer"), owners, primary_owner: owners[0] || "Unassigned",
      dependencies: cell(row, "dependencies"), approval: cell(row, "approval"), category: cell(row, "category"),
      module: cell(row, "module"), client: cell(row, "client") || PROJECT.client, association: cell(row, "association") || PROJECT.association,
      version: cell(row, "version"), comments: cell(row, "comments"),
      progress, days_remaining: daysRemaining, delay, overdue, upcoming, health, missing_owner: owners.length === 0,
    });
  });

  const detected = {};
  for (const [k, v] of Object.entries(colmap)) if (v < headers.length) detected[k] = headers[v];
  return { ...base, ok: true, phase, columns_detected: detected, records, updated_at: new Date().toISOString() };
}

/* today (optionally pinned via ?today=YYYY-MM-DD for testing) */
function todayDate() {
  const q = new URLSearchParams(location.search).get("today");
  if (q) { const iso = parseDateISO(q); if (iso) return new Date(iso + "T00:00:00"); }
  const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
const isoOf = (d) => iso(d.getFullYear(), d.getMonth() + 1, d.getDate());

window.DataEngine = { PROJECT, loadLiveData, parseWorkbookFile, buildRecords };
