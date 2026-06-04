import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

// MemexDashboard renders one typed-note dashboard (Tasks / People / etc.)
// inside Quartz's normal page chrome (left sidebar, search, theme toggle,
// explorer; right sidebar; footer). The memexDashboards emitter plugin
// constructs the page data, attaches the dashboard payload to fileData, and
// invokes renderPage() with this component as pageBody.
//
// Data flow:
//   1. Emitter stashes `{config, rows, slugByBasename, root, today}` on
//      fileData.memexDashboard.
//   2. This component embeds that payload as a data-attribute on a hidden
//      div so SPA navigation can re-read it (preact-render-to-string would
//      stringify a window.X = ... script, but the bundled afterDOMLoaded
//      below only fires on the nav event — and SPA nav swaps DOM without
//      re-running raw <script> tags).
//   3. afterDOMLoaded re-runs on every nav event; if it finds the hidden
//      div, it parses the payload and initializes the table.

const MemexDashboard: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
  const dash = (fileData as any).memexDashboard
  if (!dash) return null
  const payload = JSON.stringify(dash)
  return (
    <article class="memex-dashboard">
      <div class="memex-dashboard-data" data-memex={payload} hidden></div>
      <header class="memex-dash-header">
        <h1>{dash.config.title}</h1>
        <div class="subtitle">{dash.config.subtitle}</div>
      </header>
      <div id="tabs" class="memex-tabs"></div>
      <div id="active-filters" class="memex-active-filters"></div>
      <div class="memex-controls">
        <div class="memex-search">
          <input
            id="q"
            type="search"
            placeholder="Filter rows live (matches any field)…"
            autocomplete="off"
          />
        </div>
        <div class="memex-meta">
          <span id="count"></span>
        </div>
      </div>
      <div class="memex-facets" id="facets"></div>
      <table class="memex-table">
        <thead>
          <tr id="thead-row"></tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <div class="memex-empty" id="empty" style={{ display: "none" }}>
        No rows match the current filters.
      </div>
      <footer class="memex-foot">
        <span>
          {dash.rows.length} rows · click value to open note · ⌕ filter · ↗ cross-nav · / search ·
          Esc clear
        </span>
      </footer>
    </article>
  )
}

MemexDashboard.css = `
.memex-dashboard {
  --row-alt: color-mix(in oklab, var(--light) 60%, var(--lightgray) 40%);
  --row-hover: color-mix(in oklab, var(--light) 30%, var(--lightgray) 70%);
  --overdue: #d05a3a;
  --review: #b07a1a;
  --done: var(--gray);
  --chip-bg: color-mix(in oklab, var(--light) 50%, var(--lightgray) 50%);
  --chip-on: var(--secondary);
  --chip-on-fg: var(--light);
}
.memex-dash-header { padding-bottom: 0.5rem; border-bottom: 1px solid var(--lightgray); margin-bottom: 1rem; }
.memex-dash-header h1 { font-size: 1.5rem; margin: 0 0 0.25rem 0; font-family: var(--titleFont); font-weight: 600; }
.memex-dash-header .subtitle { color: var(--gray); font-size: 0.88rem; }
.memex-tabs { display: flex; gap: 0.25rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
.memex-tabs .tab { padding: 0.35rem 0.85rem; font-size: 0.85rem; background: var(--chip-bg); border: 1px solid var(--lightgray); border-radius: 6px; cursor: pointer; user-select: none; font-family: inherit; color: var(--dark); }
.memex-tabs .tab:hover { border-color: var(--secondary); }
.memex-tabs .tab.active { background: var(--secondary); color: var(--light); border-color: var(--secondary); }
.memex-tabs .tab-count { opacity: 0.7; font-size: 0.75rem; margin-left: 0.3rem; }
.memex-controls { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; margin-bottom: 0.75rem; }
.memex-search { flex: 1; min-width: 240px; }
.memex-search input { width: 100%; padding: 0.5rem 0.7rem; border: 1px solid var(--lightgray); border-radius: 6px; font-size: 0.95rem; background: var(--light); color: var(--dark); font-family: inherit; }
.memex-search input:focus { outline: 2px solid var(--secondary); outline-offset: -1px; }
.memex-meta { color: var(--gray); font-size: 0.85rem; padding-top: 0.35rem; }
.memex-facets { display: flex; flex-wrap: wrap; gap: 0.6rem 1.25rem; margin-bottom: 1rem; padding: 0.6rem 0; border-top: 1px solid var(--lightgray); border-bottom: 1px solid var(--lightgray); }
.memex-facets .facet { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
.memex-facets .facet-label { color: var(--gray); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; margin-right: 0.25rem; }
.memex-facets .chip { display: inline-block; padding: 0.12rem 0.55rem; font-size: 0.8rem; border-radius: 999px; background: var(--chip-bg); cursor: pointer; user-select: none; border: 1px solid transparent; white-space: nowrap; }
.memex-facets .chip:hover { border-color: var(--secondary); }
.memex-facets .chip.on { background: var(--chip-on); color: var(--chip-on-fg); }
.memex-facets .chip .count { opacity: 0.6; font-size: 0.7rem; margin-left: 0.2rem; }
.memex-facets .clear { font-size: 0.78rem; color: var(--secondary); cursor: pointer; margin-left: 0.5rem; align-self: center; text-decoration: underline; }
.memex-table { width: 100%; border-collapse: collapse; font-size: 0.87rem; }
.memex-table th { text-align: left; padding: 0.5rem 0.55rem; border-bottom: 2px solid var(--lightgray); cursor: pointer; user-select: none; white-space: nowrap; }
.memex-table th:hover { color: var(--secondary); }
.memex-table th .sort-ind { color: var(--secondary); margin-left: 0.25rem; font-size: 0.7rem; }
.memex-table td { padding: 0.4rem 0.55rem; border-bottom: 1px solid var(--lightgray); vertical-align: top; }
.memex-table tbody tr:nth-child(even) td { background: var(--row-alt); }
.memex-table tbody tr:hover td { background: var(--row-hover); }
.memex-table tbody tr.overdue td:first-child { border-left: 3px solid var(--overdue); }
.memex-table tbody tr.review td:first-child { border-left: 3px solid var(--review); }
.memex-table tbody tr.closed td { color: var(--done); }
.memex-table .due-dot { display: inline-block; width: 0.62rem; height: 0.62rem; border-radius: 50%; margin-right: 0.5rem; vertical-align: -0.05em; flex-shrink: 0; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06) inset; }
.memex-table .due-dot.overdue { background: var(--overdue); }
.memex-table .due-dot.today { background: #e8a93b; }
.memex-table .due-dot.future { background: #6cb86c; }
.memex-table .value-link { color: var(--dark); text-decoration: none; border-bottom: 1px solid transparent; }
.memex-table .value-link:hover { color: var(--secondary); border-bottom-color: var(--secondary); }
.memex-table .title-link { color: var(--secondary); text-decoration: none; font-weight: 500; }
.memex-table .title-link:hover { text-decoration: underline; }
.memex-table .filter-icon { color: var(--gray); cursor: pointer; opacity: 0.4; margin-left: 0.2rem; font-size: 0.75rem; padding: 0 0.15rem; user-select: none; }
.memex-table .filter-icon:hover { opacity: 1; color: var(--secondary); }
.memex-table .xref { color: var(--secondary); text-decoration: none; opacity: 0.35; margin-left: 0.1rem; font-size: 0.75rem; padding: 0 0.15rem; }
.memex-table .xref:hover { opacity: 1; }
.memex-table .list-item + .list-item::before { content: ", "; color: var(--gray); opacity: 0.5; }
.memex-table .pill { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 999px; background: var(--chip-bg); font-size: 0.75rem; cursor: pointer; }
.memex-table .pill:hover { outline: 1px solid var(--secondary); }
.memex-table .pill.status-next, .memex-table .pill.status-in_progress, .memex-table .pill.status-active, .memex-table .pill.status-accepted, .memex-table .pill.status-processed, .memex-table .pill.status-acted_on { background: #d8e7d4; color: #214d18; }
.memex-table .pill.status-needs_review, .memex-table .pill.status-surfaced, .memex-table .pill.status-proposed { background: #f5e1b6; color: #6b4d0f; }
.memex-table .pill.status-waiting, .memex-table .pill.status-paused, .memex-table .pill.status-pending, .memex-table .pill.status-dormant, .memex-table .pill.status-shaping { background: #e7dcd0; color: #4a3a2a; }
.memex-table .pill.status-done, .memex-table .pill.status-archived, .memex-table .pill.status-canceled, .memex-table .pill.status-dismissed, .memex-table .pill.status-superseded, .memex-table .pill.status-rejected, .memex-table .pill.status-defunct { background: #dfdfdf; color: var(--gray); }
.memex-table .pill.status-broken { background: #f5c6c0; color: #6b1f0f; }
.memex-empty { padding: 2rem; text-align: center; color: var(--gray); }
.memex-foot { margin-top: 1rem; font-size: 0.8rem; color: var(--gray); }
.memex-active-filters { margin: 0 0 0.5rem 0; }
.memex-active-filters .active-pill { display: inline-block; background: var(--chip-on); color: var(--chip-on-fg); padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.8rem; margin-right: 0.4rem; }
.memex-active-filters .active-x { margin-left: 0.4rem; cursor: pointer; opacity: 0.7; }
.memex-active-filters .active-x:hover { opacity: 1; }
@media (max-width: 720px) {
  .memex-table { font-size: 0.8rem; }
  .memex-table th, .memex-table td { padding: 0.35rem 0.4rem; }
}
`

MemexDashboard.afterDOMLoaded = `
(function () {
  const TYPE_PREFIX_TO_DASHBOARD = {
    "Project - ": "projects",
    "Person - ": "people",
    "Organization - ": "organizations",
    "Area - ": "areas",
    "Topic - ": "topics",
    "Source - ": "sources",
    "Tracker - ": "trackers",
    "Decision - ": "decisions",
    "Implementation - ": "implementations",
    "Followup - ": "followups",
    "Task - ": "tasks",
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function init() {
    const node = document.querySelector(".memex-dashboard-data");
    if (!node) return;
    let payload;
    try { payload = JSON.parse(node.dataset.memex); } catch (e) { return; }
    if (!payload) return;
    const { config, rows: DATA, slugByBasename: SLUG_BY_BASENAME, root: ROOT, today: TODAY } = payload;
    const COLUMNS = config.columns;
    const FACETS = config.facets;
    const STATUS_GROUPS = config.statusGroups;
    const FACET_KEYS = new Set(FACETS.map(f => f.key));
    const CURRENT_DASH = (window.location.pathname.split("/").pop() || "").replace(".html", "").toLowerCase();

    function destForValue(v) {
      if (typeof v !== "string") return null;
      for (const p of Object.keys(TYPE_PREFIX_TO_DASHBOARD)) if (v.startsWith(p)) return TYPE_PREFIX_TO_DASHBOARD[p];
      return null;
    }
    function noteHrefFor(v) {
      const slug = SLUG_BY_BASENAME[v];
      if (!slug) return null;
      return ROOT + slug.split("/").map(encodeURIComponent).join("/");
    }
    function dashHrefFor(v) {
      const d = destForValue(v); if (!d) return null;
      if (d === CURRENT_DASH) return null;
      return ROOT + "dashboards/" + d + "#name=" + encodeURIComponent(v) + "&group=All";
    }

    const filterState = {};
    FACETS.forEach(f => filterState[f.key] = new Set());
    let searchText = "";
    let nameFilter = null;
    let activeGroup = STATUS_GROUPS.find(g => g.default)?.name || STATUS_GROUPS[0]?.name || null;
    let sortKey = (config.defaultSort && config.defaultSort.key) || COLUMNS[0]?.key || null;
    let sortDir = (config.defaultSort && config.defaultSort.dir) || 1;

    function applyHashFilters() {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) return;
      for (const part of hash.split("&")) {
        const [k, v] = part.split("=").map(decodeURIComponent);
        if (!k || v === undefined) continue;
        if (k === "group") { if (STATUS_GROUPS.some(g => g.name === v)) activeGroup = v; }
        else if (k === "q") { searchText = v; }
        else if (k === "name") { nameFilter = v; }
        else if (filterState[k]) { filterState[k].add(v); }
      }
    }

    function isOverdue(r) {
      const d = r.due || r.surface_on || r.next_check || r.revisit_on;
      if (!d || typeof d !== "string") return false;
      const closed = ["done","archived","canceled","dismissed","acted_on","superseded","rejected"];
      if (closed.includes(r.status)) return false;
      return d < TODAY;
    }
    function isClosed(r) {
      const closed = ["done","archived","canceled","dismissed","acted_on","superseded","rejected","defunct","estranged","deceased"];
      return closed.includes(r.status);
    }
    function rowClass(r) {
      if (isClosed(r)) return "closed";
      if (isOverdue(r)) return "overdue";
      if (r.status === "needs_review") return "review";
      return "";
    }

    // Colored dot prefixed to the title-link cell of a Task to give the eye
    // a quick due-date scan: red=overdue, amber=due today, green=future,
    // none=no due date (or task closed). Currently only Tasks carry a
    // due: field, so non-Task rows get an empty string.
    function dueDotClass(r) {
      if (!r || !r.due || typeof r.due !== "string") return null;
      if (isClosed(r)) return null;
      if (r.due < TODAY) return "overdue";
      if (r.due === TODAY) return "today";
      return "future";
    }
    function dueDotHtml(r) {
      const c = dueDotClass(r);
      return c ? '<span class="due-dot ' + c + '" title="due ' + esc(String(r.due)) + '"></span>' : "";
    }

    function renderOneValue(rawVal, colKey, opts) {
      const s = String(rawVal);
      const filterable = FACET_KEYS.has(colKey);
      const noteHref = noteHrefFor(s);
      const dashHref = dashHrefFor(s);
      const label = noteHref ? '<a class="value-link" href="' + noteHref + '">' + esc(s) + "</a>" : esc(s);
      const filterIcon = filterable ? '<span class="filter-icon" data-filter="' + colKey + '" data-val="' + esc(s) + '" title="Filter">⌕</span>' : "";
      const showXref = !(opts && opts.suppressXref);
      const xref = (showXref && dashHref) ? '<a class="xref" href="' + dashHref + '" title="Open in ' + destForValue(s) + ' dashboard">↗</a>' : "";
      return label + filterIcon + xref;
    }

    function renderCell(row, col) {
      const v = row[col.key];
      if (v === "" || v === null || v === undefined) return "";
      if (col.kind === "link") {
        const dotHtml = dueDotHtml(row);
        const href = noteHrefFor(String(v));
        if (href) return dotHtml + '<a class="title-link" href="' + href + '">' + esc(String(v)) + "</a>";
        return dotHtml + esc(String(v));
      }
      if (col.kind === "status") {
        const cls = "pill status-" + String(v).replace(/[^a-z_]/gi, "");
        return '<span class="' + cls + '" data-filter="' + col.key + '" data-val="' + esc(String(v)) + '">' + esc(String(v)) + "</span>";
      }
      if (col.kind === "date") {
        const overdueFlag = isOverdue(row) && ["due","surface_on","next_check","revisit_on"].includes(col.key);
        const style = overdueFlag ? ' style="color: var(--overdue); font-weight: 600;"' : "";
        return "<span" + style + ">" + esc(String(v)) + "</span>";
      }
      if (col.kind === "list" || Array.isArray(v)) {
        // Multi-value cells previously rendered one ↗ per item, which was
        // visually busy (a Person with 3 orgs got 3 ↗ icons inline). Now:
        // suppress per-item ↗ on the items themselves and, if all items
        // share a single destination dashboard, append a single trailing
        // ↗ that opens that dashboard scoped to the *current row's name*.
        // Per-item navigation still works via the value-link on each item.
        const arr = (Array.isArray(v) ? v : [v]).filter(x => x !== "" && x != null);
        const items = arr.map(x => '<span class="list-item">' + renderOneValue(x, col.key, { suppressXref: true }) + "</span>").join("");
        const dests = new Set(arr.map(x => destForValue(String(x))).filter(Boolean));
        if (dests.size === 1) {
          const dest = dests.values().next().value;
          if (dest !== CURRENT_DASH) {
            const rowName = row._basename;
            const href = ROOT + "dashboards/" + dest + "#name=" + encodeURIComponent(String(rowName)) + "&group=All";
            const tip = "Open " + dest + " dashboard filtered to " + rowName;
            return items + ' <a class="xref xref-row" href="' + href + '" title="' + esc(tip) + '">↗</a>';
          }
        }
        return items;
      }
      return renderOneValue(v, col.key);
    }

    function getFacetValues(row, key) {
      const v = row[key];
      if (Array.isArray(v)) return v.filter(x => x !== "" && x != null).map(String);
      if (v === "" || v == null) return [];
      return [String(v)];
    }
    function passesGroup(r) {
      if (!activeGroup) return true;
      const g = STATUS_GROUPS.find(x => x.name === activeGroup);
      if (!g || !g.include) return true;
      return g.include.includes(r.status);
    }
    function passesName(r) { return !nameFilter || r._basename === nameFilter; }
    function passesFacets(r) {
      for (const f of FACETS) {
        const sel = filterState[f.key];
        if (sel.size === 0) continue;
        const vals = getFacetValues(r, f.key);
        if (!vals.some(v => sel.has(v))) return false;
      }
      return true;
    }
    function passesSearch(r) {
      if (!searchText) return true;
      const q = searchText.toLowerCase();
      for (const k of Object.keys(r)) {
        if (k.startsWith("_") && k !== "_basename") continue;
        const v = r[k];
        if (v == null || v === "") continue;
        if (Array.isArray(v)) { if (v.some(x => String(x).toLowerCase().includes(q))) return true; }
        else if (typeof v === "object") {
          for (const nv of Object.values(v)) {
            if (Array.isArray(nv)) { if (nv.some(x => String(x).toLowerCase().includes(q))) return true; }
            else if (nv != null && String(nv).toLowerCase().includes(q)) return true;
          }
        } else if (String(v).toLowerCase().includes(q)) return true;
      }
      return false;
    }
    function sortRows(rs) {
      if (!sortKey) return rs;
      return [...rs].sort((a, b) => {
        let av = a[sortKey], bv = b[sortKey];
        if (av === "" || av == null) av = sortDir === 1 ? "\\uFFFF" : "";
        if (bv === "" || bv == null) bv = sortDir === 1 ? "\\uFFFF" : "";
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
        return String(av).localeCompare(String(bv)) * sortDir;
      });
    }

    function renderTabs() {
      const cont = document.getElementById("tabs");
      if (!cont) return;
      if (STATUS_GROUPS.length === 0) { cont.style.display = "none"; return; }
      const counts = {};
      STATUS_GROUPS.forEach(g => {
        counts[g.name] = DATA.filter(r => !g.include || g.include.includes(r.status)).length;
      });
      cont.innerHTML = STATUS_GROUPS.map(g => {
        const active = g.name === activeGroup ? " active" : "";
        return '<button class="tab' + active + '" data-group="' + g.name + '">' + esc(g.name) + '<span class="tab-count">' + counts[g.name] + '</span></button>';
      }).join("");
      cont.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => { activeGroup = t.dataset.group; render(); }));
    }

    function renderHead() {
      const tr = document.getElementById("thead-row");
      if (!tr) return;
      tr.innerHTML = COLUMNS.map(col => {
        const ind = sortKey === col.key ? (sortDir === 1 ? "▲" : "▼") : "";
        return '<th data-key="' + col.key + '">' + esc(col.label) + '<span class="sort-ind">' + ind + '</span></th>';
      }).join("");
      tr.querySelectorAll("th").forEach(th => th.addEventListener("click", () => {
        const k = th.dataset.key;
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
        render();
      }));
    }

    function renderFacets() {
      const cont = document.getElementById("facets");
      if (!cont) return;
      const visible = DATA.filter(passesGroup);
      const counts = {};
      FACETS.forEach(f => {
        counts[f.key] = {};
        visible.forEach(r => getFacetValues(r, f.key).forEach(v => counts[f.key][v] = (counts[f.key][v] || 0) + 1));
      });
      cont.innerHTML = FACETS.map(f => {
        const vals = Object.keys(counts[f.key]).sort((a, b) => counts[f.key][b] - counts[f.key][a]);
        if (vals.length === 0) return "";
        const chips = vals.map(v => {
          const on = filterState[f.key].has(v) ? " on" : "";
          return '<span class="chip' + on + '" data-facet="' + f.key + '" data-val="' + esc(v) + '">' + esc(v) + '<span class="count">' + counts[f.key][v] + '</span></span>';
        }).join("");
        const sc = filterState[f.key].size > 0 ? '<span class="clear" data-clear="' + f.key + '">clear</span>' : "";
        return '<div class="facet"><span class="facet-label">' + esc(f.label) + '</span>' + chips + sc + '</div>';
      }).join("");
      cont.querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => {
        const fk = c.dataset.facet, v = c.dataset.val;
        const set = filterState[fk];
        if (set.has(v)) set.delete(v); else set.add(v);
        render();
      }));
      cont.querySelectorAll(".clear").forEach(c => c.addEventListener("click", () => { filterState[c.dataset.clear].clear(); render(); }));
    }

    function renderActiveFilters() {
      const cont = document.getElementById("active-filters");
      if (!cont) return;
      const parts = [];
      if (nameFilter) parts.push('<span class="active-pill">name = ' + esc(nameFilter) + ' <span class="active-x" data-clear-name="1">×</span></span>');
      if (searchText) parts.push('<span class="active-pill">search = "' + esc(searchText) + '" <span class="active-x" data-clear-search="1">×</span></span>');
      for (const f of FACETS) {
        const sel = filterState[f.key];
        if (!sel || sel.size === 0) continue;
        for (const v of sel) {
          parts.push('<span class="active-pill">' + esc(f.label) + ' = ' + esc(v) + ' <span class="active-x" data-clear-facet="' + esc(f.key) + '" data-clear-val="' + esc(v) + '">×</span></span>');
        }
      }
      cont.innerHTML = parts.join(" ");
      cont.querySelectorAll("[data-clear-name]").forEach(el => el.addEventListener("click", () => { nameFilter = null; render(); }));
      cont.querySelectorAll("[data-clear-search]").forEach(el => el.addEventListener("click", () => {
        searchText = "";
        const q = document.getElementById("q"); if (q) q.value = "";
        render();
      }));
      cont.querySelectorAll("[data-clear-facet]").forEach(el => el.addEventListener("click", () => {
        const fk = el.dataset.clearFacet;
        const v = el.dataset.clearVal;
        if (fk && filterState[fk]) { filterState[fk].delete(v); render(); }
      }));
    }

    function renderBody(rs) {
      const tb = document.getElementById("tbody");
      if (!tb) return;
      tb.innerHTML = rs.map(r => {
        const cls = rowClass(r);
        const tds = COLUMNS.map(col => "<td>" + renderCell(r, col) + "</td>").join("");
        return '<tr class="' + cls + '">' + tds + "</tr>";
      }).join("");
      tb.querySelectorAll(".filter-icon, .pill").forEach(el => el.addEventListener("click", e => {
        e.preventDefault(); e.stopPropagation();
        const fk = el.dataset.filter, v = el.dataset.val;
        if (!fk || !filterState[fk]) return;
        filterState[fk].add(v); render();
      }));
    }

    function render() {
      const visible = sortRows(DATA.filter(r => passesGroup(r) && passesName(r) && passesFacets(r) && passesSearch(r)));
      renderTabs(); renderHead(); renderFacets(); renderActiveFilters(); renderBody(visible);
      const cnt = document.getElementById("count");
      if (cnt) cnt.textContent = visible.length + " of " + DATA.length + " shown";
      const empty = document.getElementById("empty");
      if (empty) empty.style.display = visible.length === 0 ? "block" : "none";
    }

    const qInput = document.getElementById("q");
    if (qInput) qInput.addEventListener("input", e => { searchText = e.target.value.trim(); render(); });

    function handleKey(e) {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        const q = document.getElementById("q"); if (q) q.focus();
      } else if (e.key === "Escape") {
        FACETS.forEach(f => filterState[f.key].clear());
        const q = document.getElementById("q"); if (q) q.value = "";
        searchText = ""; nameFilter = null; render();
      }
    }
    document.addEventListener("keydown", handleKey);
    window.__memexKeydown = handleKey;

    applyHashFilters();
    if (searchText) { const q = document.getElementById("q"); if (q) q.value = searchText; }
    render();
  }

  document.addEventListener("nav", () => {
    // Clean up prior keydown handler from a previous dashboard page if any
    if (window.__memexKeydown) {
      document.removeEventListener("keydown", window.__memexKeydown);
      window.__memexKeydown = null;
    }
    init();
  });
})();
`

export default (() => MemexDashboard) satisfies QuartzComponentConstructor
