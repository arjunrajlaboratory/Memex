/* Briefing review client: one implementation for every surface (page, server,
   widget, artifact). Inlined by briefing_review.py after window.__REVIEW__.
   Vanilla JS, no dependencies, no build step. Keep this file ASCII and free of
   multi-line string literals (the widget build strips indentation and comments). */
(function () {
  "use strict";

  var R = window.__REVIEW__;
  var root = findRoot();
  if (!R || !root || root.getAttribute("data-ready")) return;
  root.setAttribute("data-ready", "1");

  // ---------------------------------------------------------------- constants

  const DASH = "\u2014", ARROW = "\u2192", SECT = "\u00a7", ELL = "\u2026", FLAG = "\u2691", HOOK = "\u21b3";
  const CHECK = "\u2713", DOT = "\u00b7";
  const SURFACE = R.surface || "page";
  const DATE = R.date;
  const ITEMS = R.items || [];
  const ACTIONS = R.actions || {};
  const BY_ID = {};
  ITEMS.forEach(function (it) { BY_ID[it.id] = it; });
  const PAGED = (R.pages || 1) > 1;
  const STORE_KEY = "memex-briefing-review:" + DATE + (PAGED ? ":p" + R.page : "");
  const IS_MAC = /Mac|iPhone|iPad/.test((navigator.platform || "") + " " + (navigator.userAgent || ""));
  const SUBMIT_LABEL = { page: "Copy for Claude", server: "Submit", widget: "Send to Claude", artifact: "Submit" }[SURFACE] || "Submit";
  const DONE_LABEL = { page: "Copied", server: "Submitted", widget: "Sent", artifact: "Submitted" }[SURFACE] || "Done";

  function findRoot() {
    var s = document.currentScript, el = s && s.previousElementSibling;
    while (el && el.id !== "review-root") el = el.previousElementSibling;
    return el || document.getElementById("review-root");
  }

  // ---------------------------------------------------------------- tiny DOM helper

  function h(tag, props) {
    const el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        const v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }

  // ---------------------------------------------------------------- storage (silent on failure)

  function lsGet(key) {
    try { const v = window.localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }

  // ---------------------------------------------------------------- dates (mirror resolve_date in Python)

  const WEEKDAYS = { mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, wednesday: 2, thu: 3, thur: 3,
    thurs: 3, thursday: 3, fri: 4, friday: 4, sat: 5, saturday: 5, sun: 6, sunday: 6 };
  const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december"];
  const MONTHS = { sept: 9 };
  MONTH_NAMES.forEach(function (m, i) { MONTHS[m] = i + 1; MONTHS[m.slice(0, 3)] = i + 1; });
  const WD_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function mkDate(y, m, d) {
    const x = new Date(Date.UTC(y, m - 1, d));
    return (x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d) ? x : null;
  }
  function isoToDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? mkDate(+m[1], +m[2], +m[3]) : null;
  }
  function dateToIso(d) { return d.toISOString().slice(0, 10); }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
  function weekday(d) { return (d.getUTCDay() + 6) % 7; }
  function mod7(n) { return ((n % 7) + 7) % 7; }
  function monthDay(base, month, day, year) {
    if (year !== null && year < 100) year += 2000;
    let out = mkDate(year === null ? base.getUTCFullYear() : year, month, day);
    if (out && year === null && out < base) out = mkDate(base.getUTCFullYear() + 1, month, day);
    return out;
  }

  function resolveDate(value, baseIso) {
    const base = isoToDate(baseIso);
    if (!base || typeof value !== "string") return null;
    const v = value.trim().toLowerCase().replace(/\.+$/, "").replace(/\s+/g, " ");
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const d = isoToDate(v); return d ? dateToIso(d) : null; }
    let out = null, m;
    if (v === "today" || v === "tod") out = base;
    else if (["tom", "tomorrow", "tmr", "tmrw"].indexOf(v) >= 0) out = addDays(base, 1);
    else if (Object.prototype.hasOwnProperty.call(WEEKDAYS, v)) out = addDays(base, mod7(WEEKDAYS[v] - weekday(base)) || 7);
    else if (v === "nw" || v === "next week") out = addDays(base, mod7(0 - weekday(base)) || 7);
    else if (v === "eow") out = addDays(base, mod7(4 - weekday(base)));
    else if (v === "eom") out = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
    else if ((m = /^\+?(\d{1,3}) ?([dw])$/.exec(v) || /^\+(\d{1,3})()$/.exec(v))) out = addDays(base, m[2] === "w" ? +m[1] * 7 : +m[1]);
    else if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(v))) out = monthDay(base, +m[1], +m[2], m[3] ? +m[3] : null);
    else if ((m = /^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/.exec(v)) && MONTHS[m[1]]) out = monthDay(base, MONTHS[m[1]], +m[2], m[3] ? +m[3] : null);
    else if ((m = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(v)) && MONTHS[m[2]]) out = monthDay(base, MONTHS[m[2]], +m[1], m[3] ? +m[3] : null);
    return out ? dateToIso(out) : null;
  }

  function fmtDay(iso, withYear) {
    const d = isoToDate(iso);
    if (!d) return iso || "";
    return WD_SHORT[weekday(d)] + " " + d.getUTCDate() + " " + MON_SHORT[d.getUTCMonth()] + (withYear ? " " + d.getUTCFullYear() : "");
  }
  // "Mon" when within a week of the review date, else "20 Nov".
  function fmtNear(iso) {
    const d = isoToDate(iso), base = isoToDate(DATE);
    if (!d || !base) return iso || "";
    const diff = (d - base) / 86400000;
    return diff > 0 && diff < 7 ? WD_SHORT[weekday(d)] : d.getUTCDate() + " " + MON_SHORT[d.getUTCMonth()];
  }
  function nowIso() {
    const d = new Date(), off = -d.getTimezoneOffset();
    const p = function (n) { return String(Math.floor(Math.abs(n))).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" +
      p(d.getMinutes()) + ":" + p(d.getSeconds()) + (off >= 0 ? "+" : "-") + p(off / 60) + ":" + p(off % 60);
  }
  function clock(ms) {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  // ---------------------------------------------------------------- markdown subset (DOM only, never innerHTML)

  const MD_RE = /(`[^`]+`)|(\[\[[^\[\]]+?\]\])|(\*\*[^*]+?\*\*)|((?<![*\w])\*(?=\S)[^*]+?\*(?![*\w]))|((?<!\[)\[([^\[\]]+)\]\((https?:\/\/[^)\s]+)\))/g;

  function renderMd(text, el) {
    const re = new RegExp(MD_RE.source, "g");
    let last = 0, m;
    text = text || "";
    while ((m = re.exec(text))) {
      if (m.index > last) append(el, text.slice(last, m.index));
      if (m[1]) append(el, h("code", { text: m[1].slice(1, -1) }));
      else if (m[2]) append(el, wikiLink(m[2].slice(2, -2)));
      else if (m[3]) { const b = h("strong"); renderMd(m[3].slice(2, -2), b); append(el, b); }
      else if (m[4]) append(el, h("em", { text: m[4].slice(1, -1) }));
      else if (m[5]) append(el, h("a", { href: m[7], target: "_blank", rel: "noopener noreferrer", tabindex: "-1", text: m[6] }));
      last = re.lastIndex;
    }
    if (last < text.length) append(el, text.slice(last));
    return el;
  }

  function wikiParts(inner) {
    const bar = inner.indexOf("|");
    const target = (bar >= 0 ? inner.slice(0, bar) : inner).split("#")[0].trim();
    const alias = bar >= 0 ? inner.slice(bar + 1).trim() : "";
    return { target: target, shown: alias || target.split("/").pop() || inner };
  }

  function wikiLink(inner) {
    const w = wikiParts(inner);
    if (!R.site || !w.target) return h("span", { class: "rv-wl", text: w.shown });
    const path = (R.links && R.links[w.target]) || w.target;
    const slug = path.replace(/ - /g, "---").replace(/ /g, "-");
    const href = R.site + "/" + slug.split("/").map(encodeURIComponent).join("/");
    return h("a", { class: "rv-wl", href: href, target: "_blank", rel: "noopener noreferrer", tabindex: "-1", text: w.shown });
  }

  // Mirrors plain_text() in Python: formatting stripped, [[wikilinks]] kept.
  function plainText(md) {
    return (md || "").replace(/`([^`]*)`/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/(?<![*\w])\*(?=\S)(.+?)(?<=\S)\*(?![*\w])/g, "$1")
      .replace(/(?<!\[)\[([^\[\]]+)\]\(([^)\s]+)\)/g, "$1")
      .replace(/\s+/g, " ").trim();
  }

  function truncateExport(text, limit) {
    limit = limit || 140;
    if (text.length <= limit) return text;
    let keep = 0;
    if (text.slice(0, 2) === "[[") { const end = text.indexOf("]]"); if (end >= 0) keep = end + 2; }
    if (keep >= limit) return text.slice(0, keep) + ELL;
    let cut = text.slice(0, limit);
    const sp = cut.lastIndexOf(" ");
    if (sp > Math.max(keep, Math.floor(limit / 2))) cut = cut.slice(0, sp);
    return cut.replace(/[ ,;:\u2014-]+$/, "") + ELL;
  }

  function defaultTitle(item) {
    const m = /^\s*(?:\*\*)?\[\[([^\[\]]+?)\]\]/.exec(item.text || "");
    if (m) return wikiParts(m[1]).shown;
    const plain = plainText(item.text).replace(/\[\[([^\[\]]+?)\]\]/g, function (_, inner) { return wikiParts(inner).shown; });
    const first = plain.split(" " + DASH + " ")[0];
    const words = first.split(" ").slice(0, 10).join(" ");
    return words.length > 80 ? words.slice(0, 80) : words;
  }

  // ---------------------------------------------------------------- state

  // state: {[id]: {action, params, note, raw}}; raw = what was typed in the param box.
  let state = {};
  let meta = { savedAt: 0, submittedAt: null, dirty: false, lastSubmitted: null };

  function answered(e) { return !!(e && (e.action || (e.note && e.note.trim()))); }
  function paramOf(action) { return action && ACTIONS[action] ? ACTIONS[action].param : null; }
  function groupOf(action) { return action && ACTIONS[action] ? ACTIONS[action].group : "note"; }

  function cleanParams(e) {
    const p = paramOf(e.action), params = e.params || {};
    if (p === "date") {
      if (params.date) return { date: params.date };
      const raw = (params.date_raw || e.raw || "").trim();
      if (!raw) return {};
      const iso = resolveDate(raw, DATE);
      return iso ? { date: iso } : { date_raw: raw };
    }
    if (p === "who" || p === "title") {
      const v = (params[p] || "").trim();
      const out = {};
      if (v) out[p] = v;
      return out;
    }
    return {};
  }

  function stateFromAnswers(list) {
    const out = {};
    (list || []).forEach(function (a) {
      if (!a || !BY_ID[a.id]) return;
      const params = a.params || {};
      out[a.id] = { action: a.action || null, params: params, note: a.note || "",
        raw: params.date || params.date_raw || params.who || params.title || "" };
    });
    return out;
  }
  function stateFromMap(map) {
    const out = {};
    Object.keys(map || {}).forEach(function (id) {
      const e = map[id];
      if (!BY_ID[id] || !e) return;
      const params = e.params || {};
      out[id] = { action: e.action || null, params: params, note: e.note || "",
        raw: e.raw || params.date || params.date_raw || params.who || params.title || "" };
    });
    return out;
  }

  function answersObject(submitted) {
    const answers = [], unanswered = [];
    ITEMS.forEach(function (item) {
      const e = state[item.id];
      if (!answered(e)) { unanswered.push(item.id); return; }
      answers.push({ id: item.id, n: item.n, action: e.action || null, params: cleanParams(e),
        note: (e.note || "").trim(), kind: item.kind, target: item.target || "", text: plainText(item.text) });
    });
    return { schema: "memex.briefing-review/v1", date: DATE, surface: SURFACE, submitted: !!submitted,
      submitted_at: submitted ? nowIso() : (meta.submittedAt || null), answers: answers, unanswered: unanswered };
  }

  function sectionHeading(item) {
    if (item.section === "asks") return (FLAG + " " + (item.section_title || "Asks")).trim();
    return (SECT + item.section + " " + (item.section_title || "")).trim();
  }

  // Mirrors format_export() in Python; see the contract's "Text export" grammar.
  function exportText() {
    const lines = ["Briefing review " + DASH + " " + DATE + " (apply with the apply-review skill)"];
    if (PAGED && ITEMS.length) {
      lines.push("Part " + R.page + " of " + R.pages + " " + DASH + " rows " + ITEMS[0].n + "-" + ITEMS[ITEMS.length - 1].n + ".");
    }
    lines.push("");
    let current = null, unanswered = 0;
    ITEMS.forEach(function (item) {
      const e = state[item.id];
      if (!answered(e)) { unanswered++; return; }
      const heading = sectionHeading(item);
      if (heading !== current) { if (current !== null) lines.push(""); lines.push(heading); current = heading; }
      const params = cleanParams(e);
      const shown = params.date || params.date_raw || params.who || params.title || "";
      const action = e.action ? e.action.toUpperCase() : "NOTE";
      lines.push("- [" + item.n + "]" + (item.label ? " " + item.label : "") + " " + action + (shown ? "(" + shown + ")" : "") +
        " " + DASH + " " + truncateExport(plainText(item.text)));
      const note = (e.note || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean).join(" / ");
      if (note) lines.push("    " + ARROW + " " + note);
    });
    if (current !== null) lines.push("");
    lines.push(unanswered ? "(" + unanswered + (unanswered === 1 ? " row" : " rows") + " left unanswered " + DASH + " leave as is.)" : "(All rows answered.)");
    return lines.join("\n") + "\n";
  }

  function countAnswered() {
    let n = 0;
    ITEMS.forEach(function (it) { if (answered(state[it.id])) n++; });
    return n;
  }

  function saveLocal() {
    lsSet(STORE_KEY, { v: 1, state: state, savedAt: meta.savedAt, submittedAt: meta.submittedAt,
      dirty: meta.dirty, lastSubmitted: meta.lastSubmitted });
  }

  function loadInitial() {
    const local = lsGet(STORE_KEY);
    if (local && local.state) {
      state = stateFromMap(local.state);
      meta.savedAt = local.savedAt || 0;
      meta.submittedAt = local.submittedAt || null;
      meta.dirty = !!local.dirty;
      meta.lastSubmitted = local.lastSubmitted || null;
      return;
    }
    if (R.previous && R.previous.state) {
      state = stateFromMap(R.previous.state);
      meta.savedAt = Date.parse(R.previous.saved_at || "") || 0;
      meta.submittedAt = R.previous.submitted ? (R.previous.saved_at || "earlier") : null;
    }
  }

  // ---------------------------------------------------------------- rendering

  const refs = {};       // id -> {row, pills, param, input, resolved, note}
  let currentId = null;
  const ui = {};

  function sectionKindMode(list) {
    const counts = {};
    list.forEach(function (it) { counts[it.kind] = (counts[it.kind] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
  }

  function keyLabel(k) { return h("kbd", { text: k }); }

  function renderHeader() {
    const alt = IS_MAC ? "\u2325" : "Alt", mod = IS_MAC ? "\u2318" : "Ctrl";
    ui.counter = h("b", { text: "0" });
    ui.bar = h("span");
    ui.status = h("span", { class: "rv-status", "aria-live": "polite" });
    ui.submit = h("button", { type: "button", class: "rv-btn rv-btn-primary", onclick: submit, text: SUBMIT_LABEL });
    ui.reset = h("button", { type: "button", class: "rv-btn rv-btn-quiet", onclick: onReset, text: "Reset" });
    const copy = SURFACE === "page" ? null :
      h("button", { type: "button", class: "rv-btn", onclick: onCopy, text: "Copy" });
    const sub = fmtDay(DATE, true) + (PAGED ? " " + DOT + " part " + R.page + " of " + R.pages : "");
    return h("header", { class: "rv-head" },
      h("div", { class: "rv-head-row" },
        h("h1", { class: "rv-title" }, "Briefing review", h("span", { class: "rv-sub", text: sub })),
        h("div", { class: "rv-progress" }, h("span", { class: "rv-bar" }, ui.bar),
          h("span", null, ui.counter, " / " + ITEMS.length + " answered")),
        h("div", { class: "rv-spacer" }),
        ui.status,
        h("div", { class: "rv-buttons" }, ui.reset, copy, ui.submit)),
      h("div", { class: "rv-hints" },
        h("span", null, keyLabel("Tab"), " next note"),
        h("span", null, keyLabel(alt), "+", keyLabel("1"), DASH, keyLabel("9"), " pick"),
        h("span", null, keyLabel(alt), "+", keyLabel("0"), " clear"),
        h("span", null, keyLabel(alt), "+", keyLabel("R"), " reuse yesterday"),
        h("span", null, keyLabel(mod), "+", keyLabel("Enter"), " " + SUBMIT_LABEL.toLowerCase())));
  }

  function renderRow(item, kindMode) {
    const r = { pills: {} };
    const pills = h("div", { class: "rv-pills", role: "group", "aria-label": "Actions for row " + item.n });
    (item.actions || []).forEach(function (a, i) {
      const def = ACTIONS[a] || { label: a, group: "neutral" };
      const btn = h("button", { type: "button", tabindex: "-1", class: "rv-pill rv-g-" + def.group,
        "aria-pressed": "false", "data-action": a, title: i < 9 ? def.label + " (" + (IS_MAC ? "\u2325" : "Alt") + "+" + (i + 1) + ")" : def.label },
        i < 9 ? h("kbd", { class: "rv-key", text: String(i + 1) }) : null, def.label);
      btn.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
      btn.addEventListener("click", function () { onPill(item.id, a); });
      r.pills[a] = btn;
      pills.appendChild(btn);
    });
    r.input = h("input", { type: "text", tabindex: "-1", class: "rv-param-input", autocomplete: "off", spellcheck: "false" });
    r.resolved = h("span", { class: "rv-resolved" });
    r.param = h("div", { class: "rv-param", hidden: true }, r.input, r.resolved);
    pills.appendChild(r.param);
    r.input.addEventListener("input", function () { onParamInput(item.id); });
    r.input.addEventListener("blur", function () { onParamInput(item.id); });
    r.input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === "Tab" || ev.key === "Escape") {
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) return;
        ev.preventDefault();
        onParamInput(item.id);
        r.note.focus();
      }
    });

    const text = renderMd(item.text, h("span", { class: "rv-text" }));
    const tags = [];
    if (item.also_in && item.also_in.length) {
      tags.push(h("span", { class: "rv-tag", text: "also in " + item.also_in.map(function (s) { return s === "asks" ? FLAG : SECT + s; }).join(", ") }));
    }
    if (item.kind !== kindMode && item.kind !== "item") tags.push(h("span", { class: "rv-kind", text: item.kind }));
    if (item.private) tags.push(h("span", { class: "rv-kind", text: "private" }));
    const body = h("div", { class: "rv-body" },
      h("p", { class: "rv-line" }, h("span", { class: "rv-n", text: String(item.n) }),
        item.label ? h("span", { class: "rv-label", text: item.label }) : null, text, tags));
    (item.detail || []).forEach(function (d) {
      body.appendChild(renderMd(d, h("div", { class: "rv-detail" }, HOOK + " ")));
    });
    const metaBits = [];
    if (item.carried_from) metaBits.push(h("span", { class: "rv-carried", text: "carried from " + fmtDay(item.carried_from) }));
    if (item.previous && item.previous.action && ACTIONS[item.previous.action]) {
      metaBits.push(h("button", { type: "button", tabindex: "-1", class: "rv-chip", title: "Reuse (" + (IS_MAC ? "\u2325" : "Alt") + "+R)",
        onclick: function () { reusePrevious(item.id); }, text: previousLabel(item.previous) }));
    }
    if (metaBits.length) body.appendChild(h("div", { class: "rv-meta" }, metaBits));

    r.note = h("textarea", { class: "rv-note", rows: "1", placeholder: "Note" + ELL, "aria-label": "Note for row " + item.n });
    r.note.addEventListener("input", function () { onNote(item.id); });
    r.row = h("div", { class: "rv-row", "data-id": item.id, "data-n": item.n }, pills, body,
      h("div", { class: "rv-notewrap" }, r.note));
    r.row.addEventListener("click", function (ev) {
      if (ev.target.closest("a, button, input, textarea")) return;
      if (window.getSelection && String(window.getSelection())) return;
      r.note.focus();
    });
    refs[item.id] = r;
    return r.row;
  }

  function previousLabel(prev) {
    const base = isoToDate(DATE), d = isoToDate(prev.date);
    const when = base && d && (base - d) === 86400000 ? "yesterday" : (prev.date ? fmtDay(prev.date) : "earlier");
    const p = prev.params || {};
    const shown = p.date ? fmtNear(p.date) : (p.date_raw || p.who || p.title || "");
    return when + ": " + prev.action.toUpperCase() + (shown ? " " + ARROW + " " + shown : "");
  }

  function renderBody() {
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < ITEMS.length) {
      const head = ITEMS[i], key = sectionHeading(head);
      const block = [];
      while (i < ITEMS.length && sectionHeading(ITEMS[i]) === key) block.push(ITEMS[i++]);
      const kindMode = sectionKindMode(block);
      const title = head.section === "asks" ? (head.section_title || "Asks") : (head.section_title || "Section " + head.section);
      const sec = h("section", { class: "rv-section" },
        h("h2", { class: "rv-h2" }, h("span", { class: "rv-sec", text: head.section === "asks" ? FLAG : SECT + head.section }),
          h("span", { text: title }), h("span", { class: "rv-count", text: String(block.length) })));
      let list = null, group = null;
      block.forEach(function (item) {
        if (!list || (item.group || "") !== group) {
          group = item.group || "";
          if (group) sec.appendChild(h("div", { class: "rv-group", text: group }));
          list = h("div", { class: "rv-list" });
          sec.appendChild(list);
        }
        list.appendChild(renderRow(item, kindMode));
      });
      frag.appendChild(sec);
    }
    return frag;
  }

  function render() {
    root.textContent = "";
    root.appendChild(renderHeader());
    ui.banner = h("div", { class: "rv-banner", hidden: true, role: "status" });
    ui.exportBox = h("textarea", { readonly: true, "aria-label": "Export text", spellcheck: "false" });
    ui.exportWrap = h("div", { class: "rv-export", hidden: true }, ui.exportBox);
    ui.notice = h("div", { class: "rv-banner", hidden: true });
    root.appendChild(ui.notice);
    root.appendChild(ui.banner);
    root.appendChild(ui.exportWrap);
    if (R.withheld) {
      root.appendChild(h("p", { class: "rv-withheld", text: R.withheld + (R.withheld === 1 ? " sensitive item is" : " sensitive items are") +
        " withheld from this page (local-only). Review " + (R.withheld === 1 ? "it" : "them") + " in your vault." }));
    }
    if (!ITEMS.length) root.appendChild(h("p", { class: "rv-empty", text: "No reviewable items in this briefing." }));
    root.appendChild(renderBody());
    root.appendChild(h("div", { class: "rv-foot", text: ITEMS.length + " rows " + DOT + " unanswered rows are left as is" }));
    ITEMS.forEach(function (it) { syncRow(it.id); });
    updateCounter();
    refreshSubmit();
  }

  function autogrow(ta) {
    ta.style.height = "auto";
    ta.style.height = (ta.scrollHeight + 2) + "px";
  }

  function syncRow(id) {
    const r = refs[id], e = state[id] || {};
    if (!r) return;
    Object.keys(r.pills).forEach(function (a) { r.pills[a].setAttribute("aria-pressed", e.action === a ? "true" : "false"); });
    const isAnswered = answered(e);
    r.row.className = "rv-row" + (isAnswered ? " rv-answered rv-g-" + groupOf(e.action) : "") + (currentId === id ? " rv-focus" : "");
    if (r.note.value !== (e.note || "")) r.note.value = e.note || "";
    autogrow(r.note);
    const p = paramOf(e.action);
    r.param.hidden = !p;
    if (p) {
      r.param.className = "rv-param rv-g-" + groupOf(e.action);
      r.input.placeholder = p === "date" ? "date: mon, +3d, 11/20" + ELL : p === "who" ? "waiting on whom?" : "task title";
      const val = p === "date" ? (e.raw || (e.params && (e.params.date || e.params.date_raw)) || "") : ((e.params && e.params[p]) || "");
      if (document.activeElement !== r.input && r.input.value !== val) r.input.value = val;
      showResolved(r, e, p);
    }
  }

  function showResolved(r, e, p) {
    r.resolved.textContent = "";
    r.resolved.removeAttribute("data-bad");
    if (p !== "date") return;
    const raw = (r.input.value || "").trim();
    if (!raw) return;
    const iso = resolveDate(raw, DATE);
    if (!iso) { r.resolved.textContent = "? kept as typed"; r.resolved.setAttribute("data-bad", "1"); return; }
    r.resolved.textContent = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? fmtDay(iso) : ARROW + " " + iso + " " + DOT + " " + fmtDay(iso);
  }

  function updateCounter() {
    const n = countAnswered();
    ui.counter.textContent = String(n);
    ui.bar.style.width = ITEMS.length ? Math.round(100 * n / ITEMS.length) + "%" : "0";
  }

  function refreshSubmit() {
    const done = !!meta.submittedAt && !meta.dirty;
    ui.submit.textContent = done ? CHECK + " " + DONE_LABEL : (meta.submittedAt ? SUBMIT_LABEL + " again" : SUBMIT_LABEL);
    if (done) ui.submit.setAttribute("data-state", "done"); else ui.submit.removeAttribute("data-state");
  }

  let statusTimer = null;
  // Errors stay put; plain notes fade after a few seconds so they never go stale.
  function setStatus(text, kind) {
    clearTimeout(statusTimer);
    if (text && kind !== "error") statusTimer = setTimeout(function () { ui.status.textContent = ""; }, 5000);
    ui.status.textContent = text || "";
    if (kind) ui.status.setAttribute("data-kind", kind); else ui.status.removeAttribute("data-kind");
  }

  function showBanner(el, kind, parts) {
    el.textContent = "";
    append(el, parts);
    el.setAttribute("data-kind", kind);
    el.hidden = false;
  }

  // ---------------------------------------------------------------- interaction

  function setCurrent(id) {
    if (currentId === id) return;
    const prev = currentId;
    currentId = id;
    if (prev) syncRow(prev);
    if (id) syncRow(id);
  }

  function entry(id) {
    if (!state[id]) state[id] = { action: null, params: {}, note: "", raw: "" };
    return state[id];
  }

  function changed(id) {
    meta.savedAt = Date.now();
    if (meta.submittedAt) {
      meta.dirty = true;
      if (!ui.banner.hidden && ui.banner.getAttribute("data-kind") === "ok") {
        showBanner(ui.banner, "info", "Edited since you submitted " + DASH + " " + SUBMIT_LABEL.toLowerCase() + " again to send the changes.");
      }
    }
    if (id) syncRow(id);
    updateCounter();
    refreshSubmit();
    saveLocal();
    remote.schedule();
  }

  function setAction(id, action, focusParam) {
    const e = entry(id), item = BY_ID[id], r = refs[id];
    if (e.action !== action) { e.params = {}; e.raw = ""; }
    e.action = action;
    const p = paramOf(action);
    if (p === "title" && !e.params.title) { e.params.title = defaultTitle(item); e.raw = e.params.title; }
    r.input.value = p === "title" ? (e.params.title || "") : (p ? e.raw : "");
    changed(id);
    if (p && focusParam) { r.input.focus(); r.input.select(); }
  }

  function clearAction(id) {
    const e = entry(id), r = refs[id];
    const hadFocus = document.activeElement === r.input;
    e.action = null; e.params = {}; e.raw = "";
    changed(id);
    if (hadFocus) r.note.focus();
  }

  function onPill(id, action) {
    setCurrent(id);
    const e = state[id];
    if (e && e.action === action) { clearAction(id); refs[id].note.focus(); return; }
    setAction(id, action, true);
    if (!paramOf(action)) refs[id].note.focus();
  }

  function onParamInput(id) {
    const e = entry(id), r = refs[id], p = paramOf(e.action);
    if (!p) return;
    const raw = r.input.value;
    if (p === "date") {
      e.raw = raw;
      const iso = resolveDate(raw, DATE);
      e.params = raw.trim() ? (iso ? { date: iso } : { date_raw: raw.trim() }) : {};
      showResolved(r, e, p);
    } else {
      e.raw = raw;
      e.params = {};
      if (raw.trim()) e.params[p] = raw.trim();
    }
    changed(null);
  }

  function onNote(id) {
    const e = entry(id), r = refs[id];
    const was = answered(e);
    e.note = r.note.value;
    autogrow(r.note);
    if (was !== answered(e)) syncRow(id);
    changed(null);
  }

  function reusePrevious(id) {
    const item = BY_ID[id], prev = item && item.previous;
    if (!prev || !prev.action || (item.actions || []).indexOf(prev.action) < 0) return;
    setCurrent(id);
    const e = entry(id);
    e.action = prev.action;
    e.params = Object.assign({}, prev.params || {});
    e.raw = e.params.date || e.params.date_raw || e.params.who || e.params.title || "";
    refs[id].input.value = e.raw;
    changed(id);
    refs[id].note.focus();
  }

  function rowOf(el) {
    const row = el && el.closest ? el.closest(".rv-row") : null;
    return row && root.contains(row) ? row.getAttribute("data-id") : null;
  }

  function onKeyDown(ev) {
    const inRoot = root.contains(ev.target) || (SURFACE !== "widget" && (ev.target === document.body || ev.target === document.documentElement));
    if (!inRoot) return;
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submit(); return; }
    if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const id = rowOf(document.activeElement) || currentId;
    if (!id || !refs[id]) return;
    const digit = /^Digit([0-9])$/.exec(ev.code || "") || /^Numpad([0-9])$/.exec(ev.code || "");
    if (digit) {
      ev.preventDefault();
      const n = +digit[1];
      setCurrent(id);
      if (n === 0) { clearAction(id); return; }
      const action = (BY_ID[id].actions || [])[n - 1];
      if (action) setAction(id, action, true);
      return;
    }
    if (ev.code === "KeyR") { ev.preventDefault(); reusePrevious(id); }
  }

  function onFocusIn(ev) {
    const id = rowOf(ev.target);
    if (id) setCurrent(id);
  }

  let resetTimer = null;
  function onReset() {
    if (ui.reset.getAttribute("data-armed") !== "1") {
      ui.reset.setAttribute("data-armed", "1");
      ui.reset.textContent = "Clear all answers?";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(disarmReset, 3500);
      return;
    }
    disarmReset();
    state = {};
    meta.submittedAt = null; meta.dirty = false; meta.lastSubmitted = null;
    ui.banner.hidden = true;
    ui.exportWrap.hidden = true;
    ITEMS.forEach(function (it) { refs[it.id].input.value = ""; syncRow(it.id); });
    changed(null);
    setStatus("Cleared");
  }
  function disarmReset() {
    clearTimeout(resetTimer);
    ui.reset.removeAttribute("data-armed");
    ui.reset.textContent = "Reset";
  }

  // ---------------------------------------------------------------- clipboard

  function copyText(text) {
    function fallback() {
      try {
        const ta = h("textarea", { readonly: true, style: "position:fixed;top:0;left:0;opacity:0;pointer-events:none" });
        ta.value = text;
        root.appendChild(ta);
        ta.select();
        const ok = document.execCommand && document.execCommand("copy");
        root.removeChild(ta);
        return !!ok;
      } catch (e) { return false; }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve(fallback());
  }

  function showExport(text) {
    ui.exportBox.value = text;
    ui.exportWrap.hidden = false;
    const rows = text.split("\n").length;
    ui.exportBox.style.height = Math.min(Math.max(rows, 6), 22) * 18 + 20 + "px";
  }

  function onCopy() {
    const text = exportText();
    copyText(text).then(function (ok) {
      if (ok) setStatus("Copied " + countAnswered() + " answers");
      else { showExport(text); setStatus("Select the text below and copy it"); }
    });
  }

  // ---------------------------------------------------------------- submit

  function markSubmitted(obj) {
    meta.submittedAt = obj.submitted_at;
    meta.lastSubmitted = obj;
    meta.dirty = false;
    saveLocal();
    refreshSubmit();
  }

  function submit() {
    const n = countAnswered();
    if (SURFACE === "server") return submitServer(n);
    if (SURFACE === "artifact" && remote.connected()) return submitArtifact(n);
    if (SURFACE === "widget") return submitWidget(n);
    return submitClipboard(n);
  }

  function submitClipboard(n) {
    const text = exportText(), obj = answersObject(true);
    showExport(text);
    copyText(text).then(function (ok) {
      markSubmitted(obj);
      showBanner(ui.banner, "ok", ok
        ? [h("b", { text: CHECK + " Copied " + n + (n === 1 ? " answer" : " answers") }), " " + DASH + " paste into Claude to apply them."]
        : [h("b", { text: "Copy the text below" }), " and paste it into Claude to apply your answers."]);
      if (!ok) { ui.exportBox.focus(); ui.exportBox.select(); }
      ui.banner.scrollIntoView({ block: "nearest" });
    });
  }

  function submitWidget(n) {
    const text = exportText(), obj = answersObject(true);
    let how = null;
    try {
      if (typeof window.sendPrompt === "function") { window.sendPrompt(text); how = "Sent to Claude"; }
      else if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "memex:sendPrompt", text: text }, "*");
        how = "Sent to Claude";
      }
    } catch (e) { how = null; }
    if (!how) return submitClipboard(n);
    markSubmitted(obj);
    showBanner(ui.banner, "ok", [h("b", { text: CHECK + " " + how }), " " + DASH + " " + n + (n === 1 ? " answer" : " answers") +
      (PAGED ? " from part " + R.page + " of " + R.pages + "." : ".")]);
  }

  function submitServer(n) {
    ui.submit.disabled = true;
    setStatus("Submitting" + ELL);
    const obj = answersObject(true);
    remote.post(obj, false).then(function () {
      markSubmitted(obj);
      setStatus("");
      showBanner(ui.banner, "ok", [h("b", { text: CHECK + " Submitted " + n + (n === 1 ? " answer" : " answers") }),
        " at " + clock(Date.now()) + " " + DASH + " saved to ", h("code", { text: "Inbox/reviews/" + DATE + ".json" }),
        ". Ask Claude to apply your review."]);
    }, function (err) {
      setStatus("");
      showBanner(ui.banner, "error", [h("b", { text: "Not submitted: " }), String(err && err.message || err),
        " " + DASH + " your answers are still in this browser; use Copy as a fallback."]);
    }).then(function () { ui.submit.disabled = false; });
  }

  function submitArtifact(n) {
    const obj = answersObject(true);
    markSubmitted(obj);
    setStatus("Submitting" + ELL);
    remote.flush().then(function (ok) {
      setStatus("");
      if (ok) {
        showBanner(ui.banner, "ok", [h("b", { text: CHECK + " Submitted " + n + (n === 1 ? " answer" : " answers") }),
          " " + DASH + " ask Claude to apply your briefing review."]);
      } else {
        meta.dirty = true;
        refreshSubmit();
        showBanner(ui.banner, "error", [h("b", { text: "Not submitted: " }), remote.lastError() || "save failed",
          " " + DASH + " try again, or use Copy."]);
      }
    });
  }

  // ---------------------------------------------------------------- remote adapters

  // A serial, coalescing write queue: one write in flight; later calls ride on
  // the queued write, which reads the newest state when it starts.
  function writeQueue(write) {
    let chain = Promise.resolve(true), queued = null, timer = null;
    function flush() {
      clearTimeout(timer);
      if (queued) return queued;
      queued = chain.then(function () { queued = null; return write(); });
      chain = queued;
      return queued;
    }
    return { schedule: function () { clearTimeout(timer); timer = setTimeout(flush, 800); }, flush: flush };
  }

  const noRemote = { schedule: function () {}, flush: function () { return Promise.resolve(false); },
    connected: function () { return false; }, lastError: function () { return ""; }, post: null };

  function serverRemote() {
    const api = "/api/review/" + encodeURIComponent(DATE);
    function post(obj, draft) {
      return fetch(api + (draft ? "?draft=1" : ""), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(obj), cache: "no-store" }).then(function (res) {
        return res.json().catch(function () { return { ok: false, error: "HTTP " + res.status }; }).then(function (body) {
          if (!res.ok || !body.ok) throw new Error(body.error || ("HTTP " + res.status));
          return body;
        });
      });
    }
    const q = writeQueue(function () {
      if (meta.submittedAt && meta.dirty) { setStatus("Edited since submit " + DASH + " not yet sent"); return Promise.resolve(true); }
      return post(answersObject(false), true).then(function () {
        setStatus("Draft saved " + clock(Date.now()));
        return true;
      }, function (err) {
        setStatus("Draft not saved: " + (err && err.message || err), "error");
        return false;
      });
    });
    function init() {
      if (location.protocol === "file:") { setStatus("Offline copy " + DASH + " answers stay in this browser"); return; }
      fetch(api, { cache: "no-store" }).then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then(function (doc) {
        if (!doc || !Array.isArray(doc.answers)) return;
        const serverAt = Date.parse(doc.saved_at || doc.submitted_at || "") || 0;
        if (meta.savedAt && meta.savedAt > serverAt + 1000) return; // newer local edits win
        state = stateFromAnswers(doc.answers);
        meta.savedAt = serverAt;
        meta.submittedAt = doc.submitted ? (doc.submitted_at || "earlier") : null;
        meta.dirty = false;
        saveLocal();
        ITEMS.forEach(function (it) { if (refs[it.id]) refs[it.id].input.value = ""; syncRow(it.id); });
        updateCounter();
        refreshSubmit();
        if (doc.submitted) {
          showBanner(ui.banner, "ok", [h("b", { text: CHECK + " Submitted" }), " " + DASH + " these answers are on file. Edit and submit again to change them."]);
        } else setStatus("Draft restored");
      }).catch(function (err) {
        setStatus("Server not reachable (" + (err && err.message || err) + ") " + DASH + " answers stay in this browser", "error");
      });
    }
    return { init: init, schedule: q.schedule, flush: q.flush, post: post, connected: function () { return true; },
      lastError: function () { return ""; } };
  }

  function artifactRemote() {
    let ref = null, lastErr = "";
    function docToStore() {
      const base = meta.lastSubmitted && meta.submittedAt ? Object.assign({}, meta.lastSubmitted, { edited_since_submit: !!meta.dirty })
        : answersObject(false);
      const stored = {};
      Object.keys(state).forEach(function (id) {
        const e = state[id];
        if (answered(e)) stored[id] = { action: e.action || null, params: cleanParams(e), note: e.note || "", raw: e.raw || "" };
      });
      return Object.assign(base, { surface: "artifact", saved_at: nowIso(), state: stored });
    }
    const q = writeQueue(function () {
      if (!ref) return Promise.resolve(false);
      let p;
      try { p = Promise.resolve(ref.set(docToStore())); } catch (e) { p = Promise.reject(e); }
      return p.then(function () {
        lastErr = "";
        setStatus("Saved " + clock(Date.now()));
        return true;
      }, function (err) {
        lastErr = String(err && err.message || err || "write failed");
        setStatus("Not saved: " + lastErr, "error");
        showBanner(ui.notice, "error", [h("b", { text: "Couldn't save to this artifact: " }), lastErr,
          " " + DASH + " your answers are kept in this browser and will retry on the next change."]);
        return false;
      });
    });
    function adopt(data) {
      if (!data || !data.state) return;
      const remoteAt = Date.parse(data.saved_at || data.submitted_at || "") || 0;
      if (meta.savedAt && meta.savedAt > remoteAt + 1000) { q.schedule(); return; }
      state = stateFromMap(data.state);
      meta.savedAt = remoteAt;
      meta.submittedAt = data.submitted ? (data.submitted_at || "earlier") : null;
      meta.lastSubmitted = data.submitted ? data : null;
      meta.dirty = !!data.edited_since_submit;
      saveLocal();
      ITEMS.forEach(function (it) { if (refs[it.id]) refs[it.id].input.value = ""; syncRow(it.id); });
      updateCounter();
      refreshSubmit();
    }
    function init() {
      setStatus("Connecting" + ELL);
      let use;
      try { use = (window.claude && window.claude.use) ? Promise.resolve(window.claude.use("db")) : Promise.resolve(null); }
      catch (e) { use = Promise.resolve(null); }
      use.catch(function () { return null; }).then(function (db) {
        if (!db) {
          setStatus("");
          showBanner(ui.notice, "info", "Not connected " + DASH + " answers stay in this browser. Submit copies them for Claude.");
          return null;
        }
        ref = db.doc("reviews/" + DATE);
        return Promise.resolve(ref.get()).then(function (snap) {
          if (snap && snap.exists) adopt(snap.data());
          setStatus("Connected");
        });
      }).catch(function (err) {
        lastErr = String(err && err.message || err);
        setStatus("Not connected: " + lastErr, "error");
      });
    }
    return { init: init, schedule: function () { if (ref) q.schedule(); }, flush: q.flush, post: null,
      connected: function () { return !!ref; }, lastError: function () { return lastErr; } };
  }

  // ---------------------------------------------------------------- boot

  loadInitial();
  const remote = SURFACE === "server" ? serverRemote() : SURFACE === "artifact" ? artifactRemote() : noRemote;
  render();
  if (meta.submittedAt && !meta.dirty) {
    showBanner(ui.banner, "ok", [h("b", { text: CHECK + " " + DONE_LABEL }), " earlier " + DASH + " edit and " + SUBMIT_LABEL.toLowerCase() + " again to change your answers."]);
  }
  root.addEventListener("focusin", onFocusIn);
  document.addEventListener("keydown", onKeyDown);
  if (remote.init) remote.init();
  // A small hook for tests and host bridges.
  root.reviewApp = { exportText: exportText, answers: answersObject, resolveDate: resolveDate };
})();
