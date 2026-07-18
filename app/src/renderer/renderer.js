'use strict';
const M = window.memex;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  vault: null,
  tab: 'dashboard',
  activeAssistant: null,   // { bubble, streamed:bool }
  toolCards: new Map(),    // id -> el
  busy: false,
  hasArtifact: false,
  history: [],
  histPos: -1,
  customTabs: [],
  customChips: [],
};

// ============================================================ ONBOARDING
async function initOnboarding() {
  const { recent, last } = await M.recentVaults();
  const list = $('recentList');
  list.innerHTML = '';
  if (!recent.length) list.appendChild(el('div', 'ocard-sub', 'No recent vaults yet.'));
  for (const p of recent) {
    const r = el('div', 'recent');
    const name = p.split('/').pop();
    r.appendChild(el('div', 'file-ic', '◈'));
    const main = el('div', 'r-main');
    main.appendChild(el('div', 'rn', esc(name)));
    main.appendChild(el('div', 'rp', esc(p)));
    r.appendChild(main);
    r.onclick = () => openVault(p);
    list.appendChild(r);
  }
  if (last) { /* could auto-open; keep manual for clarity */ }
}

$('browseVault').onclick = async () => {
  const p = await M.pickDirectory();
  if (!p) return;
  const det = await M.detectVault(p);
  if (det.isVault) openVault(p);
  else { $('f_path').value = p; flash('That folder isn\'t a vault yet — create one here, or pick a vault folder.'); }
};

$('pickPath').onclick = async () => { const p = await M.pickDirectory(); if (p) $('f_path').value = p; };

$('setupForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('f_name').value.trim();
  const email = $('f_email').value.trim();
  const tz = $('f_tz').value.trim() || 'America/New_York';
  const target = $('f_path').value.trim();   // ~ is expanded in the main process
  const packs = document.querySelector('input[name=pack]:checked').value;
  if (!name || !email || !target) return;
  const btn = $('createBtn'); btn.disabled = true; btn.textContent = 'Creating…';
  const log = $('setupLog'); log.style.display = 'block'; log.textContent = '';
  const answers = {
    OWNER_NAME: name, OWNER_PRIMARY_EMAIL: email, OWNER_FORWARDING_EMAIL: '',
    OWNER_SENDING_ACCOUNTS: '', TIMEZONE: tz, GIT_MODE: 'local', STREAMS: 'email',
  };
  const res = await M.createVault({ target, answers, packs });
  if (res.ok) { btn.textContent = 'Opening…'; openVault(target); }
  else { btn.disabled = false; btn.textContent = 'Create vault'; flash('Setup failed — see the log.'); }
};

M.onSetupProgress(({ line }) => { const log = $('setupLog'); log.textContent += line; log.scrollTop = log.scrollHeight; });

// ============================================================ OPEN VAULT
async function openVault(p) {
  const res = await M.openVault(p);
  if (!res.ok) { flash(res.error || 'Could not open vault'); return; }
  state.vault = res.summary;
  $('onboard').style.display = 'none';
  $('workspace').style.display = 'grid';
  $('vaultName').textContent = res.summary.name;
  $('connDot').classList.add('live');
  applySummary(res.summary);
  await loadAppConfig();
  state.history = []; state.histPos = -1;
  switchTab('dashboard');
}

async function loadAppConfig() {
  const cfg = (await M.appConfig()) || { tabs: [], chips: [] };
  state.customTabs = cfg.tabs || [];
  state.customChips = cfg.chips || [];
  // rebuild custom tab buttons
  document.querySelectorAll('.tab[data-custom="1"]').forEach((b) => b.remove());
  const artifactTab = $('artifactTab');
  for (const def of state.customTabs) {
    const b = el('button', 'tab tab-custom');
    b.textContent = def.label;
    b.dataset.tab = def.id;
    b.dataset.custom = '1';
    $('tabs').insertBefore(b, artifactTab);
  }
  // rebuild custom chips (after the built-ins)
  document.querySelectorAll('.chip[data-custom="1"]').forEach((b) => b.remove());
  for (const c of state.customChips) {
    const b = el('button', 'chip chip-custom');
    b.textContent = c.label;
    b.dataset.prompt = c.prompt;
    b.dataset.custom = '1';
    $('chips').appendChild(b);
  }
}

$('vaultSwitch').onclick = () => { $('onboard').classList.toggle('dismissible', !!state.vault); $('onboard').style.display = 'grid'; initOnboarding(); };
// The switcher overlays a working vault — always let the user back out without re-opening.
function closeOnboard() { if (state.vault) $('onboard').style.display = 'none'; }
$('onboardClose').onclick = closeOnboard;
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOnboard(); });

function applySummary(s) {
  const c = s.counts;
  $('cntTasks').textContent = c.openTasks || '';
  $('cntProjects').textContent = c.projects || '';
  $('cntIdeas').textContent = c.ideas || '';
  $('cntPeople').textContent = c.people || '';
  $('cntInbox').textContent = c.inbox || '';
  $('cntOutputs').textContent = c.outputs || '';
}

async function refreshSummary() {
  const s = await M.data('summary');
  if (s) { state.vault = s; applySummary(s); }
}

// ============================================================ CHAT
const chatScroll = $('chatScroll');
const composer = $('composerInput');

function scrollChat() { chatScroll.scrollTop = chatScroll.scrollHeight; }

function addUserMsg(text) {
  $('chatEmpty')?.remove();
  const m = el('div', 'msg user');
  m.appendChild(el('div', 'msg-role', 'You'));
  const b = el('div', 'bubble'); b.textContent = text;
  m.appendChild(b);
  chatScroll.appendChild(m);
  scrollChat();
}

function ensureAssistantBubble() {
  if (state.activeAssistant) return state.activeAssistant;
  const m = el('div', 'msg assistant');
  m.appendChild(el('div', 'msg-role', 'Memex'));
  const b = el('div', 'bubble');
  m.appendChild(b);
  chatScroll.appendChild(m);
  state.activeAssistant = { bubble: b, streamed: false, raw: '' };
  scrollChat();
  return state.activeAssistant;
}

function closeAssistantBubble() {
  if (state.activeAssistant) {
    const cur = state.activeAssistant.bubble.querySelector('.cursor');
    if (cur) cur.remove();
  }
  state.activeAssistant = null;
}

function onAssistantDelta(text) {
  const a = ensureAssistantBubble();
  a.streamed = true; a.raw += text;
  let live = a.bubble.querySelector('.live-text');
  if (!live) { live = el('span', 'live-text'); a.bubble.appendChild(live); a.bubble.appendChild(el('span', 'cursor')); }
  live.textContent = a.raw;
  scrollChat();
}

function onAssistantText(text, html) {
  const a = ensureAssistantBubble();
  a.bubble.innerHTML = html;          // authoritative, rendered markdown
  a.streamed = true;
  closeAssistantBubble();             // this text block is complete
  scrollChat();
}

const TOOL_LABELS = {
  Read: 'Reading', Write: 'Writing', Edit: 'Editing', Bash: 'Running',
  Glob: 'Finding files', Grep: 'Searching', WebFetch: 'Fetching', WebSearch: 'Searching web',
  TodoWrite: 'Planning', Task: 'Delegating', NotebookEdit: 'Editing notebook',
};
function toolLabel(name) {
  if (name.startsWith('mcp__ui__show_artifact')) return 'Showing artifact';
  if (name.startsWith('mcp__')) return name.replace('mcp__', '').replace(/__/g, ' · ');
  return TOOL_LABELS[name] || name;
}
function toolDetail(name, input) {
  if (!input) return '';
  if (input.file_path) return input.file_path.split('/').slice(-2).join('/');
  if (input.path) return input.path;
  if (input.command) return input.command;
  if (input.pattern) return input.pattern;
  if (input.query) return input.query;
  if (input.description) return input.description;
  if (input.title) return input.title;
  if (input.prompt) return String(input.prompt).slice(0, 80);
  return '';
}

function addToolCard(id, name, input) {
  closeAssistantBubble();
  const card = el('div', 'tool');
  card.innerHTML = `
    <div class="tool-head">
      <span class="tool-ic">⚙</span>
      <span class="tool-name">${esc(toolLabel(name))}</span>
      <span class="tool-desc">${esc(toolDetail(name, input))}</span>
      <span class="tool-spin"></span>
      <span class="tool-check">✓</span>
    </div>
    <div class="tool-body"><pre></pre></div>`;
  card.querySelector('.tool-head').onclick = () => card.classList.toggle('open');
  chatScroll.appendChild(card);
  if (id) state.toolCards.set(id, card);
  scrollChat();
  return card;
}

function completeToolCard(id, text, isError) {
  const card = id && state.toolCards.get(id);
  if (!card) return;
  card.classList.add('done');
  if (isError) card.classList.add('err');
  const pre = card.querySelector('.tool-body pre');
  if (pre && text) pre.textContent = text.slice(0, 4000);
  else card.querySelector('.tool-body').style.display = 'none';
}

function setBusy(b) {
  state.busy = b;
  $('sendBtn').style.display = b ? 'none' : 'grid';
  $('stopBtn').style.display = b ? 'grid' : 'none';
  $('connDot').classList.toggle('busy', b);
  $('connDot').classList.toggle('live', !b && !!state.vault);
  $('statusLine').textContent = b ? 'Thinking…' : 'Ready';
}

// agent events
M.onAgentEvent((evt) => {
  switch (evt.kind) {
    case 'session': $('modelTag').textContent = evt.model ? evt.model.replace('claude-', '') : ''; break;
    case 'turn_start': setBusy(true); break;
    case 'assistant_delta': onAssistantDelta(evt.text); break;
    case 'assistant_text': onAssistantText(evt.text, evt.html); break;
    case 'tool_use': addToolCard(evt.id, evt.name, evt.input); break;
    case 'tool_result': completeToolCard(evt.id, evt.text, evt.isError); break;
    case 'artifact': showArtifact(evt.artifact); break;
    case 'result':
      setBusy(false); closeAssistantBubble();
      if (evt.subtype && evt.subtype !== 'success') $('statusLine').textContent = `Ended: ${evt.subtype}`;
      else if (evt.usage) {
        const u = evt.usage; const tok = (u.output_tokens || 0) + (u.input_tokens || 0);
        $('statusLine').textContent = `Done · ${tok.toLocaleString()} tok${evt.costUsd ? ' · $' + evt.costUsd.toFixed(3) : ''}`;
      }
      break;
    case 'error': setBusy(false); flashChat('⚠ ' + evt.message); break;
  }
});

function flashChat(text) {
  $('chatEmpty')?.remove();
  const m = el('div', 'msg assistant');
  m.appendChild(el('div', 'msg-role', 'System'));
  const b = el('div', 'bubble'); b.style.color = 'var(--rose)'; b.textContent = text;
  m.appendChild(b); chatScroll.appendChild(m); scrollChat();
}

async function sendMessage(text) {
  text = (text || composer.value).trim();
  if (!text || !state.vault) return;
  addUserMsg(text);
  composer.value = ''; autosize();
  const r = await M.sendMessage(text);
  if (!r.ok) flashChat('⚠ ' + (r.error || 'Could not send'));
}

$('sendBtn').onclick = () => sendMessage();
$('stopBtn').onclick = () => M.interrupt();
composer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
function autosize() { composer.style.height = 'auto'; composer.style.height = Math.min(composer.scrollHeight, 180) + 'px'; }
composer.addEventListener('input', autosize);

$('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  sendMessage(chip.dataset.prompt);
});

// ============================================================ TABS + DATA + HISTORY
$('tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) switchTab(t.dataset.tab); });
$('navBack').onclick = goBack;
$('navFwd').onclick = goForward;

function setActiveTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
}

// The right panel keeps a back/forward history over what it has shown:
// data tabs, opened notes, and agent-pushed artifacts.
function navigate(entry) {
  const cur = state.history[state.histPos];
  const dup = cur && cur.k === entry.k &&
    ((entry.k === 'tab' && cur.tab === entry.tab) || (entry.k === 'note' && cur.rel === entry.rel));
  if (!dup) {
    if (state.histPos < state.history.length - 1) state.history = state.history.slice(0, state.histPos + 1);
    state.history.push(entry);
    state.histPos = state.history.length - 1;
  }
  renderEntry(entry);
  updateNav();
}
function renderEntry(entry) {
  if (entry.k === 'tab') { setActiveTab(entry.tab); renderTab(entry.tab); }
  else { displayArtifact(entry.art); }
}
function goBack() { if (state.histPos > 0) { state.histPos--; renderEntry(state.history[state.histPos]); updateNav(); } }
function goForward() { if (state.histPos < state.history.length - 1) { state.histPos++; renderEntry(state.history[state.histPos]); updateNav(); } }
function updateNav() {
  $('navBack').disabled = state.histPos <= 0;
  $('navFwd').disabled = state.histPos >= state.history.length - 1;
}

function switchTab(tab) { navigate({ k: 'tab', tab }); }

async function renderTab(tab) {
  const body = $('panelBody');
  if (tab === 'artifact') { renderArtifact(); return; }
  body.style.position = ''; body.innerHTML = '<div style="display:grid;place-items:center;padding:60px"><div class="spinner-lg"></div></div>';
  if (tab === 'dashboard') return renderDashboard(body);
  if (tab === 'inbox') return renderInbox(body);
  if (tab === 'outbox') return renderOutbox(body);
  const cdef = state.customTabs.find((t) => t.id === tab);
  if (cdef) {
    if (cdef.kind === 'query') return renderQueryTab(body, cdef);
    if (cdef.kind === 'web') return renderWebTab(body, cdef);
    return renderCustomTab(body, cdef);
  }
  if (['tasks', 'projects', 'ideas', 'people'].includes(tab)) {
    const data = await M.data(tab);
    if (tab === 'tasks') return renderTasks(body, data);
    if (tab === 'projects') return renderProjects(body, data);
    if (tab === 'ideas') return renderIdeas(body, data);
    if (tab === 'people') return renderPeople(body, data);
  }
  // Unrecognized id (e.g. a custom tab removed from config but still in history).
  body.innerHTML = '<div class="empty-note"><span class="big">This view is no longer available</span>It may have been a custom tab that was removed. Pick another tab above.</div>';
}

const STATUS_COLORS = {
  in_progress: 'var(--accent)', next: 'var(--accent-2)', waiting: 'var(--rose)',
  needs_review: 'var(--rose)', backlog: 'var(--ink-faint)', scheduled: 'var(--ink-dim)',
  done: 'var(--ink-faint)', canceled: 'var(--ink-faint)', inbox: 'var(--ink-faint)',
};

async function renderDashboard(body) {
  const [s, tasks, brief, outputs] = await Promise.all([
    M.data('summary'), M.data('tasks'), M.data('briefing'), M.data('outputs'),
  ]);
  state.vault = s; applySummary(s);
  body.innerHTML = '';
  const c = s.counts;
  const grid = el('div', 'dash-grid');
  const stats = [
    ['openTasks', c.openTasks, 'Open tasks', 'tasks', true],
    ['projects', c.projects, 'Active projects', 'projects', false],
    ['ideas', c.ideas, 'Ideas', 'ideas', false],
    ['inbox', c.inbox, 'In inbox', 'inbox', c.inbox > 0],
    ['outputs', c.outputs, 'Outputs', 'outbox', false],
    ['people', c.people, 'People', 'people', false],
  ];
  for (const [, n, lbl, goTab, accent] of stats) {
    const st = el('div', 'stat');
    st.innerHTML = `<div class="num${accent ? ' accent' : ''}">${n || 0}</div><div class="lbl">${lbl}</div>`;
    st.onclick = () => switchTab(goTab);
    grid.appendChild(st);
  }
  body.appendChild(grid);

  // status breakdown
  const bs = s.tasksByStatus || {};
  const order = ['in_progress', 'next', 'waiting', 'needs_review', 'backlog', 'scheduled', 'done'];
  const bar = el('div', 'statusbar');
  for (const st of order) {
    if (!bs[st]) continue;
    const seg = el('div', 'seg');
    seg.innerHTML = `<span class="sw" style="background:${STATUS_COLORS[st] || 'var(--ink-faint)'}"></span>${st.replace('_', ' ')} <b>${bs[st]}</b>`;
    bar.appendChild(seg);
  }
  if (bar.children.length) { body.appendChild(el('div', 'section-title', 'Tasks at a glance')); body.appendChild(bar); }

  // latest briefing
  if (brief) {
    body.appendChild(el('div', 'section-title', 'Latest briefing'));
    const card = el('div', 'brief-card');
    const note = await M.readNote(brief.rel);
    card.innerHTML = `<div class="bubble">${note ? note.html : esc(brief.body)}</div>`;
    body.appendChild(card);
  } else {
    body.appendChild(el('div', 'section-title', 'Briefing'));
    const card = el('div', 'brief-card');
    card.innerHTML = `<p style="color:var(--ink-faint);font-size:13px;margin:10px 0">No briefing yet.</p>`;
    const b = el('button', 'btn mini', 'Generate today\'s briefing');
    b.onclick = () => sendMessage("Give me today's briefing.");
    card.appendChild(b); body.appendChild(card);
  }

  // recent outputs
  if (outputs && outputs.length) {
    body.appendChild(el('div', 'section-title', 'Recent outputs'));
    const rows = el('div', 'rows');
    outputs.slice(0, 4).forEach((o) => rows.appendChild(outputRow(o)));
    body.appendChild(rows);
  }
}

function metaRow(children) { const s = el('div', 'r-sub'); children.filter(Boolean).forEach((c) => s.appendChild(c)); return s; }
function span(cls, txt) { return el('span', cls, esc(txt)); }

function renderList(body, items, emptyMsg, rowFn) {
  body.innerHTML = '';
  if (!items || !items.length) { body.innerHTML = `<div class="empty-note"><span class="big">Nothing here yet</span>${emptyMsg}</div>`; return; }
  const rows = el('div', 'rows');
  items.forEach((it) => rows.appendChild(rowFn(it)));
  body.appendChild(rows);
}

function taskRow(t) {
  const r = el('div', 'row');
  r.appendChild(el('span', `prio ${t.priority}`, t.priority));
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(t.title)));
  main.appendChild(metaRow([
    t.project && span('', '◆ ' + t.project),
    t.due && span('mono', 'due ' + t.due),
    t.effort && span('mono', t.effort),
  ]));
  r.appendChild(main);
  r.appendChild(el('span', `pill s-${t.status}`, t.status.replace('_', ' ')));
  r.onclick = () => openNote(t.rel, t.title);
  return r;
}

function projectRow(p) {
  const r = el('div', 'row');
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(p.title)));
  main.appendChild(metaRow([
    p.area && span('', '▲ ' + p.area),
    p.phase && span('mono', p.phase),
    p.target_date && span('mono', '→ ' + p.target_date),
  ]));
  r.appendChild(main);
  r.appendChild(el('span', `pill s-${p.status}`, p.status));
  r.onclick = () => openNote(p.rel, p.title);
  return r;
}

function ideaRow(i) {
  const r = el('div', 'row');
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(i.title)));
  main.appendChild(metaRow([
    (i.tags && i.tags.length) && span('', i.tags.map((t) => '#' + t).join(' ')),
    i.effort && span('mono', i.effort + ' effort'),
  ]));
  r.appendChild(main);
  r.appendChild(el('span', `pill s-${i.status}`, i.status));
  r.onclick = () => openNote(i.rel, i.title);
  return r;
}

function peopleRow(p) {
  const r = el('div', 'row');
  const av = el('div', 'file-ic'); av.textContent = (p.title || '?').slice(0, 1); av.style.textTransform = 'none';
  r.appendChild(av);
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(p.title)));
  main.appendChild(metaRow([p.role && span('', p.role), p.org && span('', p.org)]));
  r.appendChild(main);
  if (p.strength) r.appendChild(el('span', 'prio', p.strength));
  r.onclick = () => openNote(p.rel, p.title);
  return r;
}

function sourceRow(s) {
  const r = el('div', 'row');
  r.appendChild(el('div', 'file-ic', (s.kind || 'src').slice(0, 3)));
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(s.title)));
  main.appendChild(metaRow([s.author && span('', s.author), s.status && span('mono', s.status)]));
  r.appendChild(main);
  r.onclick = () => openNote(s.rel, s.title);
  return r;
}

const ROW_FNS = { tasks: taskRow, projects: projectRow, ideas: ideaRow, people: peopleRow, sources: sourceRow };

function renderTasks(body, tasks) { renderList(body, tasks, 'Ask the agent to create a task.', taskRow); }
function renderProjects(body, items) { renderList(body, items, 'Ask the agent to set up a project.', projectRow); }
function renderIdeas(body, items) { renderList(body, items, 'Brain-dump an idea into the inbox or chat.', ideaRow); }
function renderPeople(body, items) { renderList(body, items, 'People show up as you capture work.', peopleRow); }

// ============================================================ INBOX
async function renderInbox(body) {
  const items = await M.data('inbox');
  body.innerHTML = '';
  const dz = el('div', 'dropzone');
  dz.innerHTML = `<div class="dz-title">Drop files to capture</div>
    <div>PDFs, screenshots, notes — anything. They land in your inbox for triage.</div>
    <div class="dz-actions"></div>`;
  const addNote = el('button', 'btn mini', '✎ Quick note');
  const triage = el('button', 'btn primary mini', '⇉ Triage inbox');
  addNote.onclick = quickNote;
  triage.onclick = () => sendMessage('Triage the inbox.');
  dz.querySelector('.dz-actions').append(addNote, triage);
  dz.onclick = (e) => { if (e.target === addNote || e.target === triage) return; pickFilesToInbox(); };
  wireDrop(dz);
  body.appendChild(dz);

  if (!items || !items.length) {
    body.appendChild(el('div', 'empty-note', 'Inbox is clear. Everything has been filed.'));
    return;
  }
  body.appendChild(el('div', 'section-title', `In the inbox (${items.length})`));
  const rows = el('div', 'rows');
  items.forEach((it) => {
    const r = el('div', 'row');
    r.appendChild(el('div', 'file-ic', it.isDir ? '⁄' : (it.ext || 'txt')));
    const main = el('div', 'r-main');
    main.appendChild(el('div', 'r-title', esc(it.name)));
    main.appendChild(metaRow([span('mono', fmtSize(it.size)), span('mono', fmtTime(it.mtime))]));
    r.appendChild(main);
    if (!it.isDir && /^(md|markdown|txt|html?)$/.test(it.ext || '')) r.onclick = () => openNote(it.rel, it.name);
    rows.appendChild(r);
  });
  body.appendChild(rows);
}

async function quickNote() {
  const text = prompt('Quick note to drop in the inbox:');
  if (text && text.trim()) { await M.addInboxNote(text.trim()); if (state.tab === 'inbox') renderTab('inbox'); refreshSummary(); }
}

async function pickFilesToInbox() {
  const paths = await M.pickFiles();
  if (!paths || !paths.length) return;
  const res = await M.dropIntoInbox(paths);
  if (res && res.ok) {
    $('statusLine').textContent = `Added ${res.copied.length} to inbox`;
    refreshSummary();
    if (state.tab === 'inbox') renderTab('inbox');
  }
}

// ============================================================ OUTBOX
function outputRow(o) {
  const r = el('div', 'row');
  r.appendChild(el('div', 'file-ic', o.ext || 'txt'));
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(o.name)));
  main.appendChild(metaRow([span('mono', o.rel.replace(/^outputs\//, '')), span('mono', fmtSize(o.size)), span('mono', fmtTime(o.mtime))]));
  r.appendChild(main);
  const acts = el('div', 'r-actions');
  if (/^(md|markdown|html?|txt|png|jpe?g|gif|svg|webp)$/.test(o.ext || '')) {
    const view = el('button', 'btn mini', 'View'); view.onclick = (e) => { e.stopPropagation(); openNote(o.rel, o.name); }; acts.appendChild(view);
  }
  const open = el('button', 'btn mini', 'Open'); open.onclick = (e) => { e.stopPropagation(); M.openExternal(o.rel); }; acts.appendChild(open);
  r.appendChild(acts);
  r.onclick = () => openNote(o.rel, o.name);
  return r;
}

async function renderOutbox(body) {
  const items = await M.data('outputs');
  body.innerHTML = '';
  body.appendChild(el('div', 'section-title', 'Outbox — generated artifacts'));
  if (!items || !items.length) { body.appendChild(el('div', 'empty-note', 'No generated outputs yet. Ask for a report or a dashboard.')); return; }
  const rows = el('div', 'rows');
  items.forEach((o) => rows.appendChild(outputRow(o)));
  body.appendChild(rows);
}

// ============================================================ CUSTOM TABS
async function renderQueryTab(body, def) {
  const res = await M.tabQuery(def);
  body.style.position = '';
  body.innerHTML = '';
  const rowFn = ROW_FNS[res.source] || taskRow;
  const head = el('div', 'section-title');
  head.appendChild(document.createTextNode(def.label));
  const count = el('span', 'tab-count'); count.textContent = res.rows.length; head.appendChild(count);
  body.appendChild(head);
  if (!res.rows.length) { body.appendChild(el('div', 'empty-note', esc(def.empty || 'Nothing matches this query right now.'))); return; }
  const rows = el('div', 'rows');
  res.rows.forEach((x) => rows.appendChild(rowFn(x)));
  body.appendChild(rows);
}

function renderWebTab(body, def) {
  if (!def.url) { body.innerHTML = '<div class="empty-note">This tab has no URL configured.</div>'; return; }
  body.style.position = 'relative';
  body.innerHTML = '';
  const wrap = el('div', 'artifact-wrap');
  const bar = el('div', 'artifact-bar');
  bar.appendChild(el('div', 'a-title', esc(def.label)));
  const reload = el('button', 'btn mini', 'Reload'); bar.appendChild(reload);
  const ob = el('button', 'btn mini', 'Open in browser'); ob.onclick = () => M.openExternal(def.url); bar.appendChild(ob);
  wrap.appendChild(bar);
  const abody = el('div', 'artifact-body');
  // <webview> renders the page in its own process (handles SPAs / localhost sites that
  // don't paint inside a sandboxed iframe, e.g. Quartz), and stays isolated from the app.
  const wv = document.createElement('webview');
  wv.setAttribute('src', def.url);
  wv.setAttribute('allowpopups', '');
  wv.style.cssText = 'width:100%;height:100%;flex:1;border:none;background:transparent;';
  const err = el('div', 'empty-note');
  err.style.display = 'none';
  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3 || !e.isMainFrame) return;   // -3 = aborted (e.g. our own reload)
    err.innerHTML = `<span class="big">Can’t reach this page</span>${esc(def.url)} — ${esc(e.errorDescription || 'failed to load')}. Check that the server is running, then hit Reload.`;
    wv.style.display = 'none'; err.style.display = '';
  });
  reload.onclick = () => { err.style.display = 'none'; wv.style.display = ''; try { wv.reload(); } catch (_) { wv.src = def.url; } };
  abody.appendChild(wv);
  abody.appendChild(err);
  wrap.appendChild(abody);
  body.appendChild(wrap);
}

async function renderCustomTab(body, def) {
  const res = await M.tabContent(def.path);
  body.style.position = '';
  body.innerHTML = '';
  if (!res || res.type === 'missing') {
    body.innerHTML = `<div class="empty-note"><span class="big">${esc(def.label)}</span>${esc(def.empty || ('Nothing at ' + def.path + ' yet — ask the agent to create it.'))}</div>`;
    return;
  }
  if (res.type === 'dir') {
    body.appendChild(el('div', 'section-title', esc(def.label)));
    if (!res.items.length) { body.appendChild(el('div', 'empty-note', esc(def.empty || 'This folder is empty.'))); return; }
    const rows = el('div', 'rows');
    res.items.forEach((o) => rows.appendChild(outputRow(o)));
    body.appendChild(rows);
    return;
  }
  const f = res.file;   // single-file tab
  const bar = el('div', 'section-title', esc(def.label));
  if (f.kind === 'html') {
    body.style.position = 'relative';
    const wrap = el('div', 'artifact-wrap');
    const abody = el('div', 'artifact-body');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-modals');
    iframe.src = f.url;
    abody.appendChild(iframe); wrap.appendChild(abody); body.appendChild(wrap);
  } else if (f.kind === 'image') {
    body.appendChild(bar);
    const img = el('img', 'artifact-img'); img.src = f.dataUri; body.appendChild(img);
  } else {
    body.appendChild(bar);
    const d = el('div', 'artifact-md bubble'); d.innerHTML = f.html || ('<pre>' + esc(f.content || '') + '</pre>'); body.appendChild(d);
  }
}

// ============================================================ ARTIFACT VIEWER
let currentArtifact = null;

function displayArtifact(art) {   // no history push
  currentArtifact = art;
  state.hasArtifact = true;
  $('artifactTab').style.display = '';
  $('artifactTab').textContent = 'Artifact';
  setActiveTab('artifact');
  renderArtifact();
}
function showArtifact(art) { navigate({ k: 'art', art }); }

function renderArtifact() {
  const body = $('panelBody');
  body.style.position = 'relative';
  body.innerHTML = '';
  if (!currentArtifact) { body.innerHTML = '<div class="empty-note">No artifact yet. Ask the agent for a dashboard or report.</div>'; return; }
  const a = currentArtifact;
  const wrap = el('div', 'artifact-wrap');
  const bar = el('div', 'artifact-bar');
  bar.appendChild(el('div', 'a-title', esc(a.title || 'Artifact')));
  if (a.rel) { const ob = el('button', 'btn mini', 'Open file'); ob.onclick = () => M.openExternal(a.rel); bar.appendChild(ob); }
  wrap.appendChild(bar);
  const abody = el('div', 'artifact-body');
  if (a.kind === 'html') {
    // Served from the artifact:// origin (its own CSP-free secure origin) so the
    // artifact's inline scripts run; cross-origin from the app, so it stays isolated.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-modals');
    iframe.src = a.url;
    abody.appendChild(iframe);
  } else if (a.kind === 'image') {
    const img = el('img', 'artifact-img'); img.src = a.dataUri; abody.appendChild(img);
  } else {
    const md = el('div', 'artifact-md bubble'); md.innerHTML = a.html || esc(a.text || ''); abody.appendChild(md);
  }
  wrap.appendChild(abody);
  body.appendChild(wrap);
}

async function openNote(rel, title) {
  const f = await M.readNote(rel);
  if (!f) { flash('Could not read ' + rel); return; }
  if (!title) title = rel.split('/').pop().replace(/\.[^.]+$/, '');
  let art;
  if (f.kind === 'html') art = { title: title || rel, kind: 'html', url: f.url, rel };
  else if (f.kind === 'image') art = { title: title || rel, kind: 'image', dataUri: f.dataUri, rel };
  else if (f.kind === 'markdown') art = { title: title || rel, kind: 'markdown', html: f.html, rel };
  else art = { title: title || rel, kind: 'markdown', html: '<pre>' + esc(f.content) + '</pre>', rel };
  navigate({ k: 'note', rel, title, art });
}

// ============================================================ DRAG & DROP
function wireDrop(zone) {
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('over')));
  zone.addEventListener('drop', (e) => { e.preventDefault(); handleDrop(e); });
}

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (!state.vault) return; dragDepth++; e.preventDefault(); $('dropOverlay').classList.add('show'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) $('dropOverlay').classList.remove('show'); });
window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('dropOverlay').classList.remove('show'); handleDrop(e); });

async function handleDrop(e) {
  if (!state.vault) return;
  const files = Array.from(e.dataTransfer.files || []);
  if (!files.length) return;
  const paths = files.map((f) => M.getPathForFile(f)).filter(Boolean);
  const res = await M.dropIntoInbox(paths);
  if (res && res.ok) { $('statusLine').textContent = `Added ${res.copied.length} to inbox`; refreshSummary(); if (state.tab === 'inbox') renderTab('inbox'); flashChat(`Dropped ${res.copied.length} file(s) into the inbox. Say “triage the inbox” when ready.`); }
}

// ============================================================ FS WATCH
let fsTimer = null;
M.onFsChanged(({ area }) => {
  clearTimeout(fsTimer);
  fsTimer = setTimeout(async () => {
    refreshSummary();
    if (area === 'config') {
      await loadAppConfig();
      // rebuilding the tab bar wipes the active class — and the active tab itself may be gone
      if (!document.querySelector(`.tab[data-tab="${CSS.escape(state.tab)}"]`)) return switchTab('dashboard');
      setActiveTab(state.tab);
    }
    const map = { inbox: 'inbox', outputs: 'outbox', tasks: 'tasks', atlas: state.tab, briefings: 'dashboard' };
    const isCustom = state.customTabs.some((t) => t.id === state.tab);
    if (isCustom || state.tab === map[area] || state.tab === 'dashboard') renderTab(state.tab);
  }, 200);
});

// ============================================================ MISC
// back/forward keyboard shortcuts for the right panel
window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (e.key === '[') { e.preventDefault(); goBack(); }
  else if (e.key === ']') { e.preventDefault(); goForward(); }
});

// wikilinks inside rendered markdown (chat bubbles + artifact md) open the target note
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a.wikilink[data-rel]');
  if (!a) return;
  e.preventDefault();
  const rel = a.getAttribute('data-rel');
  openNote(rel, a.textContent);
});

$('themeToggle').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
};
function flash(msg) { $('statusLine') && ($('statusLine').textContent = msg); }
function fmtSize(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }
function fmtTime(ms) { const d = new Date(ms); const diff = (Date.now() - ms) / 1000; if (diff < 60) return 'just now'; if (diff < 3600) return Math.floor(diff / 60) + 'm ago'; if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'; return d.toLocaleDateString(); }

// divider resize
(() => {
  const d = $('divider'); let dragging = false;
  d.addEventListener('mousedown', () => { dragging = true; document.body.style.cursor = 'col-resize'; });
  window.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const ws = $('workspace'); const rect = ws.getBoundingClientRect();
    const w = Math.min(Math.max(e.clientX - rect.left, 340), rect.width - 360);
    ws.style.setProperty('--chat-w', w + 'px');
  });
})();

// dev bridge (harmless in prod; used by the screenshot harness)
window.__dev = { open: openVault, tab: switchTab, send: sendMessage, artifact: showArtifact, note: openNote };

initOnboarding();
