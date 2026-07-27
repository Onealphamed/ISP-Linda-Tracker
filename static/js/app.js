/* ══════════════════════════════════════════════════════════════════
   Hetero ISP — Prof. Linda · Project Tracker — frontend controller
   Loads the analytics payload, filters reactively, and renders every
   view. All aggregation happens here so filters stay live.
   ══════════════════════════════════════════════════════════════════ */

const STATE = {
  payload: null,
  records: [],
  filtered: [],
  filters: { status: "", owner: "", health: "", month: "", search: "" },
  view: "executive",
  today: new Date(),
  calMonth: null, // {y, m}
  ganttZoom: "week",
  charts: {},
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const STATUS_LABELS = {
  done: "Completed", in_progress: "In Progress", review: "In Review",
  blocked: "Blocked", not_started: "Yet to Start",
};
const HEALTH_LABELS = { done: "Completed", green: "On Track", yellow: "Minor Delay", orange: "Medium Delay", red: "Critical" };
const HEALTH_COLORS = { done: "#12b76a", green: "#12b76a", yellow: "#eab308", orange: "#f04438", red: "#d92d20" };
const STATUS_COLORS = { done: "#12b76a", in_progress: "#f79009", review: "#eab308", blocked: "#d92d20", not_started: "#98a2b3" };
const AVATAR_COLORS = ["#4f46e5","#7c3aed","#2e90fa","#12b76a","#f79009","#d92d20","#0ea5e9","#db2777","#059669","#ca8a04"];

/* ─── Utilities ──────────────────────────────────────────────────── */
const esc = (s) => (s == null ? "" : String(s)).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseISO = (s) => (s ? new Date(s + "T00:00:00") : null);
const fmtDate = (s) => { const d = parseISO(s); return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"; };
const monthKey = (s) => { const d = parseISO(s); return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : null; };
const monthLabel = (k) => { const [y, m] = k.split("-"); return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" }); };
const avatarColor = (name) => { let h = 0; for (const c of (name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; };
const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const avatar = (name) => `<span class="av" style="background:${avatarColor(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;
const statusPill = (r) => `<span class="pill st-${r.status_class}">${esc(r.status || STATUS_LABELS[r.status_class])}</span>`;
const healthPill = (r) => `<span class="pill h-${r.health}">${HEALTH_LABELS[r.health] || r.health}</span>`;

function toast(msg, kind = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show " + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), 3200);
}
function loader(on, text) { const l = $("#loader"); if (text) $("#loaderText").textContent = text; l.classList.toggle("hidden", !on); }

/* ─── Data load ──────────────────────────────────────────────────── */
async function loadData(url = "/api/data", opts) {
  loader(true, "Loading data…");
  try {
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!data.ok && (!data.records || !data.records.length)) {
      loader(false);
      toast(data.error || "No data available from the source.", "err");
      if (!STATE.payload) renderEmptyAll();
      return;
    }
    applyPayload(data);
    toast(data.source === "upload" ? `Loaded ${data.source_name}` : "Live data refreshed", "ok");
  } catch (e) {
    toast("Failed to load data: " + e.message, "err");
  } finally {
    loader(false);
  }
}

function applyPayload(data) {
  STATE.payload = data;
  STATE.records = data.records || [];
  STATE.today = parseISO(data.today) || new Date();
  // default calendar month = earliest end date, else today
  if (!STATE.calMonth) {
    const ds = STATE.records.map((r) => parseISO(r.end)).filter(Boolean).sort((a, b) => a - b);
    const base = ds[0] || STATE.today;
    STATE.calMonth = { y: base.getFullYear(), m: base.getMonth() };
  }
  // header
  $("#projectTitle").textContent = data.project_name || "Project Tracker";
  $("#phaseChip").textContent = data.phase || "";
  $("#phaseChip").style.display = data.phase ? "" : "none";
  const badge = $("#sourceBadge");
  badge.textContent = data.source === "upload" ? `Uploaded: ${data.source_name} · click to go live` : "Live Google Sheet";
  badge.className = "src-badge" + (data.source === "upload" ? " upload" : "");
  $("#updatedAt").textContent = "Updated " + new Date(data.updated_at).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
  populateFilters();
  applyFilters();
}

/* ─── Filters ────────────────────────────────────────────────────── */
function populateFilters() {
  const owners = new Set(), months = new Set();
  STATE.records.forEach((r) => {
    (r.owners.length ? r.owners : ["Unassigned"]).forEach((o) => owners.add(o));
    const mk = monthKey(r.end); if (mk) months.add(mk);
  });
  const statusOpts = ["done", "in_progress", "review", "blocked", "not_started"].filter((s) => STATE.records.some((r) => r.status_class === s));
  fillSelect('[data-filter="status"]', statusOpts.map((s) => [s, STATUS_LABELS[s]]), "All Status");
  fillSelect('[data-filter="owner"]', [...owners].sort().map((o) => [o, o]), "All Owners");
  fillSelect('[data-filter="health"]', ["done", "green", "yellow", "orange", "red"].filter((h) => STATE.records.some((r) => r.health === h)).map((h) => [h, HEALTH_LABELS[h]]), "All Health");
  fillSelect('[data-filter="month"]', [...months].sort().map((m) => [m, monthLabel(m)]), "All Months");
}
function fillSelect(sel, opts, allLabel) {
  const el = $(sel); const cur = el.value;
  el.innerHTML = `<option value="">${allLabel}</option>` + opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  if ([...el.options].some((o) => o.value === cur)) el.value = cur;
}

function applyFilters() {
  const f = STATE.filters;
  STATE.filtered = STATE.records.filter((r) => {
    if (f.status && r.status_class !== f.status) return false;
    if (f.health && r.health !== f.health) return false;
    if (f.owner) { const os = r.owners.length ? r.owners : ["Unassigned"]; if (!os.includes(f.owner)) return false; }
    if (f.month && monthKey(r.end) !== f.month) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = [r.deliverable, r.status, r.comments, r.primary_owner, ...r.owners, r.priority, r.category, r.phase].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  renderView(STATE.view);
}

/* ─── View routing ───────────────────────────────────────────────── */
const RENDERERS = {
  executive: renderExecutive, timeline: renderTimeline, deliverables: renderDeliverables,
  calendar: renderCalendar, pending: renderPending, workload: renderWorkload,
  health: renderHealth, risks: renderRisks, charts: renderCharts,
};
function renderView(v) {
  STATE.view = v;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
  (RENDERERS[v] || (() => {}))();
}

function emptyBlock(msg) {
  return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h18M3 12h18M3 17h18"/></svg><p>${esc(msg)}</p></div>`;
}
function renderEmptyAll() { $("#view-executive").innerHTML = emptyBlock("No data available. Check the sheet is shared, or upload a workbook."); }

/* ─── Aggregation helpers ────────────────────────────────────────── */
function computeKPIs(recs) {
  const n = recs.length;
  const done = recs.filter((r) => r.status_class === "done").length;
  const active = recs.filter((r) => ["in_progress", "review"].includes(r.status_class)).length;
  const notStarted = recs.filter((r) => r.status_class === "not_started").length;
  const overdue = recs.filter((r) => r.overdue).length;
  const upcoming = recs.filter((r) => r.upcoming).length;
  const blocked = recs.filter((r) => r.status_class === "blocked").length;
  const pendingApproval = recs.filter((r) => r.approval && !/^(approved|done|yes)$/i.test(r.approval)).length;
  const avgProg = n ? Math.round(recs.reduce((s, r) => s + r.progress, 0) / n) : 0;
  const delayed = recs.filter((r) => r.delay > 0).length;
  return { n, done, active, notStarted, overdue, upcoming, blocked, pendingApproval, avgProg, delayed };
}

/* ─── 1. Executive ───────────────────────────────────────────────── */
function renderExecutive() {
  const recs = STATE.filtered;
  const k = computeKPIs(recs);
  const cards = [
    ["Total Deliverables", k.n, "#4f46e5", "var(--brand-soft)", "M4 6h16M4 12h16M4 18h10", `Phase: ${STATE.payload.phase || "—"}`],
    ["Completed", k.done, "#12b76a", "var(--green-bg)", "M20 6L9 17l-5-5", `${k.n ? Math.round(k.done / k.n * 100) : 0}% of scope`],
    ["Active / In Progress", k.active, "#f79009", "var(--amber-bg)", "M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z", "In progress + review"],
    ["Yet to Start", k.notStarted, "#98a2b3", "var(--grey-bg)", "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v8", "Not yet begun"],
    ["Overdue", k.overdue, "#d92d20", "var(--red-bg)", "M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.4 3.9a2 2 0 00-3.4 0z", "Past end date"],
    ["Delayed", k.delayed, "#f04438", "var(--orange-bg)", "M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z", "Behind schedule"],
    ["Upcoming (7d)", k.upcoming, "#2e90fa", "var(--blue-bg)", "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z", "Due this week"],
    ["Avg Progress", k.avgProg + "%", "#7c3aed", "var(--brand-soft)", "M3 12h4l3 8 4-16 3 8h4", "Across deliverables"],
  ];
  const kpiHtml = cards.map(([label, val, accent, bg, path, sub]) => `
    <div class="kpi" style="--accent:${accent};--accent-bg:${bg}">
      <div class="kpi-top">
        <div class="kpi-ic"><svg viewBox="0 0 24 24"><path d="${path}"/></svg></div>
      </div>
      <div class="kpi-val">${val}</div>
      <div class="kpi-label">${label}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`).join("");

  $("#view-executive").innerHTML = `
    <div class="kpi-grid">${kpiHtml}</div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Status Distribution</h3></div><div class="chart-box"><canvas id="exStatus"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Deliverables by Health</h3></div><div class="chart-box"><canvas id="exHealth"></canvas></div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Monthly Deadline Load</h3><small>deliverables due per month</small></div><div class="chart-box"><canvas id="exMonthly"></canvas></div></div>
    <div class="panel">
      <div class="panel-head"><h3>Priority Deliverables</h3><small>overdue &amp; due-soon, earliest first</small></div>
      ${renderMiniTable(recs.filter((r) => r.overdue || r.upcoming).sort(sortByEnd).slice(0, 8))}
    </div>`;

  drawStatusChart("exStatus", recs);
  drawHealthChart("exHealth", recs);
  drawMonthlyChart("exMonthly", recs);
}
function sortByEnd(a, b) { return (parseISO(a.end) || 1e15) - (parseISO(b.end) || 1e15); }

function renderMiniTable(recs) {
  if (!recs.length) return emptyBlock("Nothing overdue or due soon — all clear.");
  return `<div class="tbl-wrap"><table class="data"><thead><tr>
    <th>Deliverable</th><th>Owner</th><th>Status</th><th>Due</th><th>Progress</th><th>Health</th></tr></thead><tbody>
    ${recs.map((r) => rowHtml(r)).join("")}</tbody></table></div>`;
}
function rowHtml(r) {
  const pc = r.health === "red" || r.health === "orange" ? "r" : r.status_class === "done" ? "g" : "a";
  return `<tr data-id="${esc(r.id)}" onclick="openModal('${esc(r.id)}')">
    <td class="cell-name">${esc(r.deliverable)}${r.delay > 0 ? `<small>${r.delay}d delay</small>` : ""}</td>
    <td>${avatar(r.primary_owner)} <span style="margin-left:6px">${esc(r.primary_owner)}</span></td>
    <td>${statusPill(r)}</td>
    <td>${fmtDate(r.end)}${r.days_remaining != null && r.days_remaining >= 0 && r.days_remaining <= 7 ? `<small style="color:var(--blue)"> ${r.days_remaining}d</small>` : ""}</td>
    <td><div style="display:flex;align-items:center;gap:8px"><div class="pbar ${pc}"><i style="width:${r.progress}%"></i></div><span style="font-size:11px;color:var(--text-faint)">${r.progress}%</span></div></td>
    <td>${healthPill(r)}</td></tr>`;
}

/* ─── 2. Timeline / Gantt ────────────────────────────────────────── */
function renderTimeline() {
  const recs = STATE.filtered.filter((r) => r.start || r.end).sort((a, b) => (parseISO(a.start || a.end) || 1e15) - (parseISO(b.start || b.end) || 1e15));
  const host = $("#view-timeline");
  if (!recs.length) { host.innerHTML = `<div class="panel">${emptyBlock("No dated deliverables to plot.")}</div>`; return; }
  const zooms = ["week", "month", "quarter"];
  host.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Project Timeline</h3><small>overdue bars in red · click a bar for detail</small></div>
      <div class="gantt-toolbar">${zooms.map((z) => `<button class="zoombtn ${z === STATE.ganttZoom ? "active" : ""}" data-zoom="${z}">${z[0].toUpperCase() + z.slice(1)}</button>`).join("")}</div>
      <div class="gantt"><div class="gantt-inner" id="ganttInner"></div></div>
    </div>`;
  $$("#view-timeline .zoombtn").forEach((b) => b.onclick = () => { STATE.ganttZoom = b.dataset.zoom; renderTimeline(); });
  drawGantt(recs);
}
function drawGantt(recs) {
  const dates = recs.flatMap((r) => [parseISO(r.start), parseISO(r.end)].filter(Boolean));
  let min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates));
  min.setDate(min.getDate() - 2); max.setDate(max.getDate() + 2);
  const zoom = STATE.ganttZoom;
  const unitDays = zoom === "week" ? 7 : zoom === "month" ? 30 : 91;
  const pxPerDay = zoom === "week" ? 20 : zoom === "month" ? 6 : 2.4;
  const totalDays = Math.max(1, (max - min) / 864e5);
  const width = totalDays * pxPerDay;

  // ticks
  const ticks = [];
  let cur = new Date(min);
  while (cur <= max) {
    const label = zoom === "week"
      ? cur.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
      : zoom === "month"
      ? cur.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
      : "Q" + (Math.floor(cur.getMonth() / 3) + 1) + " " + cur.getFullYear();
    ticks.push({ left: (cur - min) / 864e5 * pxPerDay, label });
    cur = new Date(cur.getTime() + unitDays * 864e5);
  }
  const todayLeft = (STATE.today - min) / 864e5 * pxPerDay;
  const head = `<div class="gantt-row gantt-head"><div class="gantt-label">Deliverable</div>
    <div class="gantt-track" style="width:${width}px">${ticks.map((t) => `<div class="gantt-tick" style="position:absolute;left:${t.left}px;width:${unitDays * pxPerDay}px">${t.label}</div>`).join("")}
    <div style="position:absolute;left:${todayLeft}px;top:0;bottom:0;width:2px;background:var(--brand);opacity:.6"></div></div></div>`;

  const rows = recs.map((r) => {
    const s = parseISO(r.start) || parseISO(r.end);
    const e = parseISO(r.end) || parseISO(r.start);
    const left = (s - min) / 864e5 * pxPerDay;
    const w = Math.max(6, ((e - s) / 864e5 + 1) * pxPerDay);
    const cls = r.status_class === "done" ? "done" : r.overdue ? "overdue" : "";
    return `<div class="gantt-row">
      <div class="gantt-label" title="${esc(r.deliverable)}">${esc(r.deliverable)}</div>
      <div class="gantt-track" style="width:${width}px">
        <div class="gbar ${cls}" style="left:${left}px;width:${w}px" onclick="openModal('${esc(r.id)}')" title="${esc(r.deliverable)} · ${fmtDate(r.start)}→${fmtDate(r.end)}">
          <span class="gfill" style="width:${r.progress}%"></span><span style="position:relative">${w > 46 ? r.progress + "%" : ""}</span>
        </div></div></div>`;
  }).join("");
  $("#ganttInner").innerHTML = head + rows;
}

/* ─── 3. Deliverable tracker (grouped tree) ──────────────────────── */
function renderDeliverables() {
  const recs = STATE.filtered;
  const host = $("#view-deliverables");
  if (!recs.length) { host.innerHTML = `<div class="panel">${emptyBlock("No deliverables match the current filters.")}</div>`; return; }
  // group by client → owner-track view: here group by status for clarity, then list
  const groups = {};
  recs.forEach((r) => { const key = `${r.client} › ${r.phase}`; (groups[key] ||= []).push(r); });
  let html = `<div class="section-title">Deliverable Tracker <small>${recs.length} items · grouped by client › phase</small></div>`;
  for (const [key, items] of Object.entries(groups)) {
    const done = items.filter((r) => r.status_class === "done").length;
    html += `<div class="tree-group">
      <div class="tree-head" onclick="this.classList.toggle('collapsed');this.nextElementSibling.classList.toggle('hidden')">
        <svg class="ic caret" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
        <span>${esc(key)}</span>
        <span class="count">${done}/${items.length} completed</span>
      </div>
      <div class="tree-body"><div class="tbl-wrap"><table class="data"><thead><tr>
        <th>Deliverable</th><th>Owner (OAM)</th><th>Owner (Hetero)</th><th>Status</th><th>Start</th><th>Due</th><th>Progress</th><th>Delay</th></tr></thead><tbody>
        ${items.sort(sortByEnd).map((r) => `<tr onclick="openModal('${esc(r.id)}')">
          <td class="cell-name">${esc(r.deliverable)}${r.qty ? `<small>Qty: ${r.qty}</small>` : ""}</td>
          <td>${r.owner_oam ? esc(r.owner_oam) : "—"}</td>
          <td>${r.owner_hetero ? esc(r.owner_hetero) : "—"}</td>
          <td>${statusPill(r)}</td>
          <td>${fmtDate(r.start)}</td>
          <td>${fmtDate(r.end)}</td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="pbar ${r.status_class === "done" ? "g" : r.overdue ? "r" : "a"}"><i style="width:${r.progress}%"></i></div><span style="font-size:11px">${r.progress}%</span></div></td>
          <td>${r.delay > 0 ? `<span class="pill h-${r.health}">${r.delay}d</span>` : "—"}</td>
        </tr>`).join("")}
      </tbody></table></div></div></div>`;
  }
  host.innerHTML = html;
}

/* ─── 4. Calendar ────────────────────────────────────────────────── */
function renderCalendar() {
  const host = $("#view-calendar");
  const { y, m } = STATE.calMonth;
  const first = new Date(y, m, 1), startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const title = first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  // events keyed by ISO date
  const events = {};
  const add = (iso, type, r) => { if (!iso) return; (events[iso] ||= []).push({ type, r }); };
  STATE.filtered.forEach((r) => {
    add(r.start, "start", r);
    add(r.end, r.overdue ? "overdue" : "end", r);
    add(r.meeting, "meeting", r);
  });

  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let cells = "";
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell muted"></div>`;
  const todayISO = STATE.today.toISOString().slice(0, 10);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const evs = (events[iso] || []).slice(0, 4);
    const more = (events[iso] || []).length - evs.length;
    cells += `<div class="cal-cell ${iso === todayISO ? "today" : ""}">
      <div class="cal-date">${d}</div>
      ${evs.map((e) => `<div class="cal-ev ${e.type}" onclick="openModal('${esc(e.r.id)}')" title="${esc(e.r.deliverable)}">${e.type === "start" ? "▸ " : e.type === "meeting" ? "◆ " : "● "}${esc(e.r.deliverable)}</div>`).join("")}
      ${more > 0 ? `<div class="cal-ev" style="background:var(--surface-2);color:var(--text-faint)">+${more} more</div>` : ""}
    </div>`;
  }
  host.innerHTML = `
    <div class="panel">
      <div class="cal-toolbar">
        <button class="zoombtn" id="calPrev">‹ Prev</button>
        <h3>${title}</h3>
        <button class="zoombtn" id="calNext">Next ›</button>
        <button class="zoombtn" id="calToday">Today</button>
        <div style="margin-left:auto;display:flex;gap:12px;font-size:11.5px;color:var(--text-soft)">
          <span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--blue)"></i> Start</span>
          <span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--amber)"></i> Due</span>
          <span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--red)"></i> Overdue</span>
          <span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--brand)"></i> Meeting</span>
        </div>
      </div>
      <div class="cal-grid">${dow.map((d) => `<div class="cal-dow">${d}</div>`).join("")}${cells}</div>
    </div>`;
  $("#calPrev").onclick = () => { STATE.calMonth = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }; renderCalendar(); };
  $("#calNext").onclick = () => { STATE.calMonth = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }; renderCalendar(); };
  $("#calToday").onclick = () => { STATE.calMonth = { y: STATE.today.getFullYear(), m: STATE.today.getMonth() }; renderCalendar(); };
}

/* ─── 5. Pending Actions ─────────────────────────────────────────── */
function renderPending() {
  const recs = STATE.filtered;
  const groups = [
    ["Due in next 7 days", "#2e90fa", recs.filter((r) => r.upcoming)],
    ["Overdue tasks", "#d92d20", recs.filter((r) => r.overdue)],
    ["Blocked / on hold", "#f04438", recs.filter((r) => r.status_class === "blocked")],
    ["In review / QA", "#eab308", recs.filter((r) => r.status_class === "review")],
    ["Pending approval", "#7c3aed", recs.filter((r) => r.approval && !/^(approved|done|yes)$/i.test(r.approval))],
    ["Unassigned (missing owner)", "#98a2b3", recs.filter((r) => r.missing_owner)],
  ].filter(([, , items]) => items.length);

  const host = $("#view-pending");
  if (!groups.length) { host.innerHTML = `<div class="panel">${emptyBlock("No pending actions — everything is on track.")}</div>`; return; }
  host.innerHTML = `<div class="pending-cols">${groups.map(([title, color, items]) => `
    <div class="panel pending-col">
      <h4><span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block"></span>${esc(title)}<span class="badge">${items.length}</span></h4>
      <div class="action-list">${items.sort(sortByEnd).map((r) => `
        <div class="action-item" style="--accent:${color}" onclick="openModal('${esc(r.id)}')">
          <div class="ai-name">${esc(r.deliverable)}<div class="ai-meta">${esc(r.primary_owner)} · due ${fmtDate(r.end)}${r.delay > 0 ? ` · ${r.delay}d late` : ""}</div></div>
          ${statusPill(r)}
        </div>`).join("")}</div>
    </div>`).join("")}</div>`;
}

/* ─── 6. Team Workload ───────────────────────────────────────────── */
function renderWorkload() {
  const map = {};
  STATE.filtered.forEach((r) => {
    (r.owners.length ? r.owners : ["Unassigned"]).forEach((o) => {
      const w = (map[o] ||= { name: o, total: 0, done: 0, pending: 0, delayed: 0, prog: 0 });
      w.total++; w.prog += r.progress;
      if (r.status_class === "done") w.done++; else w.pending++;
      if (r.delay > 0) w.delayed++;
    });
  });
  const people = Object.values(map).sort((a, b) => b.total - a.total);
  const host = $("#view-workload");
  if (!people.length) { host.innerHTML = `<div class="panel">${emptyBlock("No owners found in the data.")}</div>`; return; }
  host.innerHTML = `
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Tasks per Owner</h3></div><div class="chart-box"><canvas id="wlBar"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Completed vs Pending</h3></div><div class="chart-box"><canvas id="wlStack"></canvas></div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Workload Detail</h3><small>${people.length} owners</small></div>
      ${people.map((w) => {
        const avg = Math.round(w.prog / w.total);
        return `<div class="wl-card">
          ${avatar(w.name)}
          <div class="wl-meta"><div class="wl-name">${esc(w.name)}</div>
            <div class="wl-stats"><span>Total <b>${w.total}</b></span><span>Done <b>${w.done}</b></span><span>Pending <b>${w.pending}</b></span><span>Delayed <b style="color:var(--red)">${w.delayed}</b></span></div>
          </div>
          <div class="wl-prog"><div style="font-size:11px;color:var(--text-faint);margin-bottom:4px">Avg progress ${avg}%</div><div class="pbar ${avg >= 66 ? "g" : avg >= 33 ? "a" : "r"}"><i style="width:${avg}%"></i></div></div>
        </div>`;
      }).join("")}
    </div>`;
  drawWorkloadCharts(people);
}

/* ─── 7. Project Health ──────────────────────────────────────────── */
function renderHealth() {
  const recs = STATE.filtered;
  const bands = { done: 0, green: 0, yellow: 0, orange: 0, red: 0 };
  recs.forEach((r) => bands[r.health]++);
  const n = recs.length || 1;
  // score: weighted — done/green full, yellow .7, orange .4, red 0
  const score = Math.round((bands.done + bands.green + bands.yellow * 0.7 + bands.orange * 0.4) / n * 100);
  const scoreColor = score >= 80 ? "#12b76a" : score >= 60 ? "#eab308" : score >= 40 ? "#f79009" : "#d92d20";
  const scoreLabel = score >= 80 ? "Healthy" : score >= 60 ? "Watch" : score >= 40 ? "At Risk" : "Critical";
  const circ = 2 * Math.PI * 85;

  const legend = [["done", "Completed"], ["green", "On Track"], ["yellow", "Minor Delay (<5d)"], ["orange", "Medium Delay (5–10d)"], ["red", "Critical (>10d)"]]
    .map(([k, label]) => `<div class="hl-row">
      <span class="pill h-${k}" style="min-width:96px;justify-content:center">${label}</span>
      <div class="hl-bar"><i style="width:${bands[k] / n * 100}%;background:${HEALTH_COLORS[k]}"></i></div>
      <span class="hl-count">${bands[k]}</span></div>`).join("");

  $("#view-health").innerHTML = `
    <div class="panel">
      <div class="health-hero">
        <div class="gauge">
          <svg viewBox="0 0 200 200" style="transform:rotate(-90deg)">
            <circle cx="100" cy="100" r="85" fill="none" stroke="var(--border)" stroke-width="16"/>
            <circle cx="100" cy="100" r="85" fill="none" stroke="${scoreColor}" stroke-width="16" stroke-linecap="round"
              stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - score / 100)}" style="transition:stroke-dashoffset .8s ease"/>
          </svg>
          <div class="score"><b style="color:${scoreColor}">${score}</b><span>Health Score<br>${scoreLabel}</span></div>
        </div>
        <div>
          <div class="section-title">Overall Project Health <small>derived from delay against end dates</small></div>
          <div class="health-legend">${legend}</div>
        </div>
      </div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Deliverables Needing Attention</h3><small>orange &amp; red health</small></div>
      ${renderMiniTable(recs.filter((r) => ["orange", "red"].includes(r.health)).sort((a, b) => b.delay - a.delay).slice(0, 12))}
    </div>`;
}

/* ─── 8. Risks ───────────────────────────────────────────────────── */
function renderRisks() {
  const recs = STATE.filtered;
  const risks = [];
  const push = (sev, tag, title, desc, r) => risks.push({ sev, tag, title, desc, r });
  recs.forEach((r) => {
    if (r.delay > 10) push("red", "Critical Delay", r.deliverable, `${r.delay} days past due (${fmtDate(r.end)}) · owner ${r.primary_owner}`, r);
    else if (r.overdue) push("orange", "Missed Deadline", r.deliverable, `${r.delay} days overdue · ${STATUS_LABELS[r.status_class]}`, r);
    if (r.status_class === "blocked") push("orange", "Blocked Task", r.deliverable, `Marked "${r.status}" · owner ${r.primary_owner}`, r);
    if (r.dependencies && !r.overdue) push("yellow", "Dependency", r.deliverable, `Depends on: ${r.dependencies}`, r);
    if (r.missing_owner) push("yellow", "Missing Owner", r.deliverable, `No owner assigned · due ${fmtDate(r.end)}`, r);
    if (r.approval && !/^(approved|done|yes)$/i.test(r.approval)) push("yellow", "Pending Approval", r.deliverable, `Approval: ${r.approval}`, r);
  });
  // high workload risk
  const load = {};
  recs.forEach((r) => (r.owners.length ? r.owners : ["Unassigned"]).forEach((o) => { if (r.status_class !== "done") load[o] = (load[o] || 0) + 1; }));
  Object.entries(load).filter(([o, c]) => c >= 15 && o !== "Unassigned").forEach(([o, c]) => risks.push({ sev: "yellow", tag: "High Workload", title: o, desc: `${c} open deliverables assigned`, r: null }));

  const sevOrder = { red: 0, orange: 1, yellow: 2 };
  risks.sort((a, b) => sevOrder[a.sev] - sevOrder[b.sev]);
  const host = $("#view-risks");
  const counts = { red: risks.filter((x) => x.sev === "red").length, orange: risks.filter((x) => x.sev === "orange").length, yellow: risks.filter((x) => x.sev === "yellow").length };
  host.innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);max-width:600px">
      <div class="kpi" style="--accent:#d92d20;--accent-bg:var(--red-bg)"><div class="kpi-val" style="color:#d92d20">${counts.red}</div><div class="kpi-label">Critical Risks</div></div>
      <div class="kpi" style="--accent:#f04438;--accent-bg:var(--orange-bg)"><div class="kpi-val" style="color:#f04438">${counts.orange}</div><div class="kpi-label">Medium Risks</div></div>
      <div class="kpi" style="--accent:#eab308;--accent-bg:var(--yellow-bg)"><div class="kpi-val" style="color:#a97a06">${counts.yellow}</div><div class="kpi-label">Low Risks</div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Identified Risks</h3><small>auto-detected · ${risks.length} total</small></div>
      ${risks.length ? risks.map((x) => `
        <div class="risk-item" ${x.r ? `onclick="openModal('${esc(x.r.id)}')" style="cursor:pointer"` : ""}>
          <div class="risk-sev" style="background:${HEALTH_COLORS[x.sev]}"></div>
          <div class="risk-body"><div class="risk-title">${esc(x.title)}<span class="risk-tag" style="background:${x.sev === "red" ? "var(--red-bg)" : x.sev === "orange" ? "var(--orange-bg)" : "var(--yellow-bg)"};color:${HEALTH_COLORS[x.sev]}">${esc(x.tag)}</span></div>
          <div class="risk-desc">${esc(x.desc)}</div></div>
        </div>`).join("") : emptyBlock("No active risks detected.")}
    </div>`;
}

/* ─── 9. Charts ──────────────────────────────────────────────────── */
function renderCharts() {
  $("#view-charts").innerHTML = `
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Status Distribution</h3></div><div class="chart-box"><canvas id="chStatus"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Health Distribution</h3></div><div class="chart-box"><canvas id="chHealth"></canvas></div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Deliverables by Owner</h3></div><div class="chart-box tall"><canvas id="chOwner"></canvas></div></div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Monthly Deadline Trend</h3></div><div class="chart-box"><canvas id="chTrend"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Progress Buckets</h3></div><div class="chart-box"><canvas id="chProg"></canvas></div></div>
    </div>`;
  const recs = STATE.filtered;
  drawStatusChart("chStatus", recs);
  drawHealthChart("chHealth", recs);
  drawOwnerChart("chOwner", recs);
  drawMonthlyChart("chTrend", recs, "line");
  drawProgressBuckets("chProg", recs);
}

/* ─── Chart builders ─────────────────────────────────────────────── */
function destroyChart(id) { if (STATE.charts[id]) { STATE.charts[id].destroy(); delete STATE.charts[id]; } }
function themeTicks() { return getComputedStyle(document.body).getPropertyValue("--text-soft") || "#5a6577"; }
function gridColor() { return getComputedStyle(document.body).getPropertyValue("--border") || "#e6e9f0"; }

function drawStatusChart(id, recs) {
  destroyChart(id);
  const counts = {}; recs.forEach((r) => counts[r.status_class] = (counts[r.status_class] || 0) + 1);
  const keys = Object.keys(counts);
  const el = $("#" + id); if (!el) return;
  STATE.charts[id] = new Chart(el, {
    type: "doughnut",
    data: { labels: keys.map((k) => STATUS_LABELS[k]), datasets: [{ data: keys.map((k) => counts[k]), backgroundColor: keys.map((k) => STATUS_COLORS[k]), borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue("--surface") }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "right", labels: { color: themeTicks(), padding: 14, usePointStyle: true, boxWidth: 8 } } } },
  });
}
function drawHealthChart(id, recs) {
  destroyChart(id);
  const order = ["done", "green", "yellow", "orange", "red"];
  const counts = {}; recs.forEach((r) => counts[r.health] = (counts[r.health] || 0) + 1);
  const keys = order.filter((k) => counts[k]);
  const el = $("#" + id); if (!el) return;
  STATE.charts[id] = new Chart(el, {
    type: "doughnut",
    data: { labels: keys.map((k) => HEALTH_LABELS[k]), datasets: [{ data: keys.map((k) => counts[k]), backgroundColor: keys.map((k) => HEALTH_COLORS[k]), borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue("--surface") }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "right", labels: { color: themeTicks(), padding: 14, usePointStyle: true, boxWidth: 8 } } } },
  });
}
function drawMonthlyChart(id, recs, type = "bar") {
  destroyChart(id);
  const due = {}, done = {};
  recs.forEach((r) => { const k = monthKey(r.end); if (!k) return; due[k] = (due[k] || 0) + 1; if (r.status_class === "done") done[k] = (done[k] || 0) + 1; });
  const keys = [...new Set([...Object.keys(due)])].sort();
  const el = $("#" + id); if (!el) return;
  STATE.charts[id] = new Chart(el, {
    type,
    data: { labels: keys.map(monthLabel), datasets: [
      { label: "Due", data: keys.map((k) => due[k] || 0), backgroundColor: "rgba(79,70,229,.75)", borderColor: "#4f46e5", borderWidth: 2, borderRadius: 6, tension: .35, fill: type === "line" ? false : true },
      { label: "Completed", data: keys.map((k) => done[k] || 0), backgroundColor: "rgba(18,183,106,.75)", borderColor: "#12b76a", borderWidth: 2, borderRadius: 6, tension: .35, fill: false },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: themeTicks(), usePointStyle: true, boxWidth: 8 } } }, scales: { x: { ticks: { color: themeTicks() }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: themeTicks(), precision: 0 }, grid: { color: gridColor() } } } },
  });
}
function drawOwnerChart(id, recs) {
  destroyChart(id);
  const done = {}, pending = {};
  recs.forEach((r) => (r.owners.length ? r.owners : ["Unassigned"]).forEach((o) => { if (r.status_class === "done") done[o] = (done[o] || 0) + 1; else pending[o] = (pending[o] || 0) + 1; }));
  const owners = [...new Set([...Object.keys(done), ...Object.keys(pending)])].sort((a, b) => ((done[b] || 0) + (pending[b] || 0)) - ((done[a] || 0) + (pending[a] || 0)));
  const el = $("#" + id); if (!el) return;
  STATE.charts[id] = new Chart(el, {
    type: "bar",
    data: { labels: owners, datasets: [
      { label: "Completed", data: owners.map((o) => done[o] || 0), backgroundColor: "#12b76a", borderRadius: 5, stack: "s" },
      { label: "Pending", data: owners.map((o) => pending[o] || 0), backgroundColor: "#f79009", borderRadius: 5, stack: "s" },
    ] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: themeTicks(), usePointStyle: true, boxWidth: 8 } } }, scales: { x: { stacked: true, beginAtZero: true, ticks: { color: themeTicks(), precision: 0 }, grid: { color: gridColor() } }, y: { stacked: true, ticks: { color: themeTicks() }, grid: { display: false } } } },
  });
}
function drawProgressBuckets(id, recs) {
  destroyChart(id);
  const buckets = { "0%": 0, "1–25%": 0, "26–50%": 0, "51–75%": 0, "76–99%": 0, "100%": 0 };
  recs.forEach((r) => { const p = r.progress; buckets[p === 0 ? "0%" : p === 100 ? "100%" : p <= 25 ? "1–25%" : p <= 50 ? "26–50%" : p <= 75 ? "51–75%" : "76–99%"]++; });
  const el = $("#" + id); if (!el) return;
  STATE.charts[id] = new Chart(el, {
    type: "bar",
    data: { labels: Object.keys(buckets), datasets: [{ label: "Deliverables", data: Object.values(buckets), backgroundColor: ["#98a2b3", "#f04438", "#f79009", "#eab308", "#2e90fa", "#12b76a"], borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: themeTicks() }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: themeTicks(), precision: 0 }, grid: { color: gridColor() } } } },
  });
}
function drawWorkloadCharts(people) {
  const top = people.slice(0, 12);
  destroyChart("wlBar");
  const el1 = $("#wlBar");
  if (el1) STATE.charts["wlBar"] = new Chart(el1, {
    type: "bar",
    data: { labels: top.map((p) => p.name), datasets: [{ label: "Tasks", data: top.map((p) => p.total), backgroundColor: top.map((p) => avatarColor(p.name)), borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: themeTicks() }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: themeTicks(), precision: 0 }, grid: { color: gridColor() } } } },
  });
  destroyChart("wlStack");
  const el2 = $("#wlStack");
  if (el2) STATE.charts["wlStack"] = new Chart(el2, {
    type: "bar",
    data: { labels: top.map((p) => p.name), datasets: [
      { label: "Done", data: top.map((p) => p.done), backgroundColor: "#12b76a", borderRadius: 5, stack: "s" },
      { label: "Pending", data: top.map((p) => p.pending), backgroundColor: "#f79009", borderRadius: 5, stack: "s" },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: themeTicks(), usePointStyle: true, boxWidth: 8 } } }, scales: { x: { stacked: true, ticks: { color: themeTicks() }, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { color: themeTicks(), precision: 0 }, grid: { color: gridColor() } } } },
  });
}

/* ─── Drill-down modal ───────────────────────────────────────────── */
window.openModal = function (id) {
  const r = STATE.records.find((x) => String(x.id) === String(id));
  if (!r) return;
  const kv = (label, val) => val ? `<div class="kv"><label>${label}</label><div>${esc(val)}</div></div>` : "";
  const dr = r.days_remaining;
  const drText = r.status_class === "done" ? "Completed" : dr == null ? "—" : dr < 0 ? `${-dr} days overdue` : `${dr} days left`;
  $("#modalBody").innerHTML = `
    <div class="modal-hero">
      <h2>${esc(r.deliverable)}</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${statusPill(r)}${healthPill(r)}${r.priority ? `<span class="chip chip-assoc">${esc(r.priority)}</span>` : ""}<span class="chip chip-phase">${esc(r.phase)}</span></div>
    </div>
    <div class="modal-body">
      <div class="modal-progress">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px"><span style="color:var(--text-soft)">Progress</span><b>${r.progress}%</b></div>
        <div class="pbar ${r.status_class === "done" ? "g" : r.overdue ? "r" : "a"}" style="height:10px"><i style="width:${r.progress}%"></i></div>
      </div>
      <div class="kv-grid">
        ${kv("Client", r.client)}
        ${kv("Association", r.association)}
        ${kv("Owner (OAM)", r.owner_oam)}
        ${kv("Owner (Hetero)", r.owner_hetero)}
        ${kv("Reviewer", r.reviewer)}
        ${kv("Quantity", r.qty)}
        ${kv("Start Date", fmtDate(r.start))}
        ${kv("End / Due Date", fmtDate(r.end))}
        ${kv("Actual Completion", r.actual ? fmtDate(r.actual) : "")}
        ${kv("TAT (days)", r.tat)}
        ${kv("Days Remaining", drText)}
        ${kv("Delay", r.delay > 0 ? r.delay + " days" : "On time")}
        ${kv("Dependencies", r.dependencies)}
        ${kv("Approval", r.approval)}
        ${kv("Category", r.category)}
        ${kv("Module", r.module)}
        ${kv("Version", r.version)}
        ${kv("Meeting Date", r.meeting ? fmtDate(r.meeting) : "")}
      </div>
      ${r.comments ? `<div class="modal-remarks"><label>Remarks / Comments</label><div style="margin-top:6px">${esc(r.comments)}</div></div>` : ""}
    </div>`;
  $("#modal").classList.add("open");
};
function closeModal() { $("#modal").classList.remove("open"); }

/* ─── Events / init ──────────────────────────────────────────────── */
function bindEvents() {
  $$(".tab").forEach((t) => t.onclick = () => renderView(t.dataset.view));
  $$(".fsel").forEach((s) => s.onchange = () => { STATE.filters[s.dataset.filter] = s.value; applyFilters(); });
  $("#clearFilters").onclick = () => {
    STATE.filters = { status: "", owner: "", health: "", month: "", search: "" };
    $$(".fsel").forEach((s) => (s.value = ""));
    $("#globalSearch").value = "";
    applyFilters();
  };
  let searchT;
  $("#globalSearch").oninput = (e) => { clearTimeout(searchT); searchT = setTimeout(() => { STATE.filters.search = e.target.value.trim(); applyFilters(); }, 220); };

  $("#refreshBtn").onclick = () => { const b = $("#refreshBtn"); b.classList.add("spinning"); loadData("/api/data?refresh=1").finally(() => b.classList.remove("spinning")); };
  $("#uploadInput").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    STATE.calMonth = null;
    await loadData("/api/upload", { method: "POST", body: fd });
    e.target.value = "";
  };
  $("#sourceBadge").onclick = () => { if (STATE.payload?.source === "upload") { STATE.calMonth = null; loadData("/api/use-live", { method: "POST" }); } };

  $("#themeBtn").onclick = () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("isp-theme", next); } catch {}
    document.body.setAttribute("data-theme", next);
    renderView(STATE.view); // redraw charts with new theme colors
  };

  $("#modalClose").onclick = closeModal;
  $("#modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // auto-refresh live data every 90s (skip when viewing an upload)
  setInterval(() => { if (STATE.payload?.source !== "upload" && document.visibilityState === "visible") loadData("/api/data"); }, 90000);
}

(function init() {
  try {
    const saved = localStorage.getItem("isp-theme");
    if (saved) { document.documentElement.setAttribute("data-theme", saved); document.body.setAttribute("data-theme", saved); }
  } catch {}
  bindEvents();
  loadData();
})();
