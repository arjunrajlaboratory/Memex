// Renderer for Memex Desktop. Compiled as a plain (non-module) script — no
// import/export statements — so index.html can load it with a bare <script> tag.
// Shared types live in src/shared/types.d.ts as ambient globals.

const M = window.memex;
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const el = (tag: string, cls?: string, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const textEl = (tag: string, cls: string, value: unknown): HTMLElement => {
  const e = el(tag, cls);
  e.textContent = String(value ?? '');
  return e;
};
const esc = (s: unknown): string => String(s == null ? '' : s)
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);

interface ActiveAssistant { bubble: HTMLElement; streamed: boolean; raw: string; }

type HistoryEntry =
  | { k: 'tab'; tab: string }
  | { k: 'note'; rel: string; title?: string; art: ArtifactView }
  | { k: 'art'; art: ArtifactView };

interface UIState {
  vault: VaultSummary | null;
  tab: string;
  activeAssistant: ActiveAssistant | null;   // streaming bubble in progress
  toolCards: Map<string, HTMLElement>;       // tool_use id -> card
  busy: boolean;
  hasArtifact: boolean;
  history: HistoryEntry[];
  histPos: number;
  customTabs: TabDef[];
  configuredTabs: TabDef[];
  customChips: ChipDef[];
  hiddenTabs: string[];
  selectedFolders: string[];
  availableFolders: string[];
}

const state: UIState = {
  vault: null,
  tab: 'dashboard',
  activeAssistant: null,
  toolCards: new Map(),
  busy: false,
  hasArtifact: false,
  history: [],
  histPos: -1,
  customTabs: [],
  configuredTabs: [],
  customChips: [],
  hiddenTabs: [],
  selectedFolders: [],
  availableFolders: [],
};

const BUILTIN_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'projects', label: 'Projects' },
  { id: 'ideas', label: 'Ideas' },
  { id: 'people', label: 'People' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'outbox', label: 'Outbox' },
] as const;
let vaultOpening = false;
let vaultEpoch = 0;
const vaultOpenEpochs: VaultOpenEpochState = { request: 0, epoch: 0 };
let deferredAgentErrors: string[] = [];
let deferredIconDrops: Array<{ copied: string[]; error?: string }> = [];

// ============================================================ ONBOARDING
async function initOnboarding(): Promise<void> {
  $('resetApprovals').style.display = state.vault ? 'block' : 'none';
  void refreshVaultUpdate();
  const { recent } = await M.recentVaults();
  const list = $('recentList');
  list.innerHTML = '';
  if (!recent.length) list.appendChild(el('div', 'ocard-sub', 'No recent vaults yet.'));
  for (const p of recent) {
    const r = el('div', 'recent');
    const name = p.split('/').pop() || p;
    r.appendChild(el('div', 'file-ic', '◈'));
    const main = el('div', 'r-main');
    main.appendChild(el('div', 'rn', esc(name)));
    main.appendChild(el('div', 'rp', esc(p)));
    r.appendChild(main);
    r.onclick = () => openVault(p);
    list.appendChild(r);
  }
}

// ---- vault engine updates ----
// Not the app updater (that's the button further down): the app ships an
// engine tree, and the open vault records the engine version it was last
// baked from. When the app — and so its bundled engine — moves ahead, the
// vault needs an /update run to adopt it. That run is driven through the
// agent, which handles merges and asks on conflicts, so the upgrade button
// hands the chat a prompt rather than running a script blind.
async function refreshVaultUpdate(): Promise<void> {
  const row = $('vaultUpdate');
  const btn = $('vaultUpdateBtn') as HTMLButtonElement;
  const text = $('vaultUpdateText');
  row.style.display = 'none';
  btn.style.display = 'none';
  if (!state.vault) return;
  const epoch = vaultEpoch;
  const s = await M.checkVaultUpdate().catch((): VaultUpdateStatus => ({ state: 'error' }));
  // A vault switch while the check was in flight would otherwise pin the old
  // vault's versions (and upgrade prompt) on the new vault's switcher.
  if (!state.vault || epoch !== vaultEpoch) return;
  if (s.state === 'current') {
    text.textContent = `Vault engine ${s.vaultVersion} — up to date`;
    row.style.display = 'flex';
  } else if (s.state === 'available') {
    text.textContent = `Vault engine ${s.vaultVersion} — engine ${s.engineVersion} available`;
    btn.style.display = '';
    row.style.display = 'flex';
    btn.onclick = () => {
      closeOnboard();
      void sendMessage(`Run the /update skill to update this vault from the newer Memex engine at ${s.enginePath} (the vault is on engine ${s.vaultVersion}; the engine is ${s.engineVersion}). Walk me through anything that needs a decision.`);
    };
  } else if (s.state === 'untracked') {
    text.textContent = 'This vault predates engine-update tracking — ask the agent about one-time reconciliation.';
    row.style.display = 'flex';
  }
  // 'error' / 'no-vault': leave the row hidden.
}

$('browseVault').onclick = async () => {
  const p = await M.pickDirectory();
  if (!p) return;
  const det = await M.detectVault(p);
  if (det.isVault) openVault(p);
  else { ($('f_path') as HTMLInputElement).value = p; flash('That folder isn\'t a Memex vault yet. The form on the right can set one up there, or pick another folder.'); }
};

$('pickPath').onclick = async () => { const p = await M.pickDirectory(); if (p) ($('f_path') as HTMLInputElement).value = p; };

($('setupForm') as HTMLFormElement).onsubmit = async (e: SubmitEvent) => {
  e.preventDefault();
  const name = ($('f_name') as HTMLInputElement).value.trim();
  const email = ($('f_email') as HTMLInputElement).value.trim();
  const tz = ($('f_tz') as HTMLInputElement).value.trim() || 'America/New_York';
  const target = ($('f_path') as HTMLInputElement).value.trim();   // ~ is expanded in the main process
  const packs = (document.querySelector('input[name=pack]:checked') as HTMLInputElement).value;
  if (!name || !email || !target) return;
  const btn = $('createBtn') as HTMLButtonElement; btn.disabled = true; btn.textContent = 'Creating…';
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
async function openVault(p: string): Promise<void> {
  if (vaultOpening) return;
  const request = beginVaultOpen(vaultOpenEpochs);
  let committed = false;
  renderEpoch++;   // prevent an old tab response from committing during the switch
  closeSearch();
  if (fsTimer) window.clearTimeout(fsTimer);
  fsTimer = null;
  pendingFsAreas.clear();
  vaultOpening = true;
  $('workspace').inert = true;
  $('onboard').inert = true;
  try {
    const res = await M.openVault(p);
    if (request !== vaultOpenEpochs.request) return;
    if (!res.ok || !res.summary) { flash(res.error || 'Could not open vault'); return; }
    const epoch = commitVaultOpen(vaultOpenEpochs, request);
    if (epoch == null) return;
    vaultEpoch = epoch;
    committed = true;
    resetVaultScopedUi();
    state.vault = res.summary;
    $('onboard').style.display = 'none';
    $('workspace').style.display = 'grid';
    $('vaultName').textContent = res.summary.name;
    $('searchOpen').style.display = '';
    $('connDot').classList.add('live');
    applySummary(res.summary);
    try {
      await loadAppConfig(epoch);
    } catch (error) {
      flashChat('⚠ Could not load this vault\'s desktop tabs: ' + String((error as Error)?.message || error));
    }
    if (request !== vaultOpenEpochs.request) return;
    switchTab(firstVisibleTab() || 'dashboard');
    if (res.warning) flashChat('⚠ ' + res.warning);
    if (res.pendingDrop) reportIconDrop(res.pendingDrop.copied || [], res.pendingDrop.error);
    // Surface a stale vault engine without making the user open the switcher.
    void M.checkVaultUpdate().then((s) => {
      if (epoch !== vaultEpoch || s.state !== 'available') return;
      flashChat(`⚙ This vault runs engine ${s.vaultVersion}; the app bundles ${s.engineVersion}. Open the vault menu (top left) to upgrade, or just ask me to update the vault.`);
    }).catch(() => {});
  } catch (error) {
    if (request === vaultOpenEpochs.request) flash('Could not open vault: ' + String((error as Error)?.message || error));
  } finally {
    if (request === vaultOpenEpochs.request) {
      vaultOpening = false;
      $('workspace').inert = false;
      $('onboard').inert = false;
      if (!committed && state.vault) void renderTab(state.tab);
      const errors = deferredAgentErrors;
      deferredAgentErrors = [];
      for (const message of errors) flashChat('⚠ ' + message);
      if (committed) void refreshModelPicker();
      const iconDrops = deferredIconDrops;
      deferredIconDrops = [];
      for (const drop of iconDrops) reportIconDrop(drop.copied, drop.error);
    }
  }
}

async function loadAppConfig(expectedEpoch = vaultEpoch): Promise<void> {
  const cfg = (await M.appConfig()) || { tabs: [], chips: [], hiddenTabs: [], folders: [], availableFolders: [] };
  if (expectedEpoch !== vaultEpoch) return;
  state.configuredTabs = cfg.tabs || [];
  state.hiddenTabs = cfg.hiddenTabs || [];
  state.selectedFolders = cfg.folders || [];
  state.availableFolders = cfg.availableFolders || [];
  const folderTabs: TabDef[] = state.selectedFolders.map((folder) => ({
    id: `folder:${folder}`,
    label: folder.split('/').filter(Boolean).pop() || folder,
    kind: 'path',
    path: folder,
    url: '',
    source: '',
    where: null,
    empty: '',
  }));
  state.customTabs = [...state.configuredTabs, ...folderTabs];
  state.customChips = cfg.chips || [];
  document.querySelectorAll<HTMLElement>('.tab[data-builtin="1"]').forEach((button) => {
    button.style.display = state.hiddenTabs.includes(button.dataset.tab || '') ? 'none' : '';
  });
  // rebuild custom tab buttons
  document.querySelectorAll('.tab[data-custom="1"]').forEach((b) => b.remove());
  const artifactTab = $('artifactTab');
  for (const def of state.customTabs) {
    if (state.hiddenTabs.includes(def.id)) continue;
    const isFolder = def.id.startsWith('folder:');
    const b = el('button', isFolder ? 'tab tab-folder' : 'tab tab-custom');
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
  renderTabSettingsOptions();
}

function firstVisibleTab(): string | null {
  return selectFirstVisibleTab(Array.from(document.querySelectorAll<HTMLElement>('.tab[data-tab]')).map((button) => ({
    tab: button.dataset.tab || '',
    visible: button.style.display !== 'none',
    artifact: button.id === 'artifactTab',
  })));
}

function visibleTab(tab: string): boolean {
  const button = document.querySelector<HTMLElement>(`.tab[data-tab="${CSS.escape(tab)}"]`);
  return !!button && button.style.display !== 'none';
}

interface TabSettingsOption {
  kind: 'tab' | 'folder';
  value: string;
  label: string;
  detail?: string;
  checked: boolean;
}

function addTabSettingsGroup(title: string, options: TabSettingsOption[]): void {
  if (!options.length) return;
  const container = $('tabSettingsOptions');
  container.appendChild(textEl('div', 'tab-settings-group-title', title));
  for (const option of options) {
    const row = el('label', 'tab-settings-option');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = option.checked;
    input.dataset.kind = option.kind;
    input.dataset.value = option.value;
    row.appendChild(input);
    const main = el('span', 'tab-settings-option-main');
    main.appendChild(textEl('span', 'tab-settings-option-name', option.label));
    if (option.detail) main.appendChild(textEl('span', 'tab-settings-option-path', option.detail));
    row.appendChild(main);
    container.appendChild(row);
  }
}

function renderTabSettingsOptions(): void {
  const container = $('tabSettingsOptions');
  container.innerHTML = '';
  addTabSettingsGroup('Essentials', BUILTIN_TABS.map((tab) => ({
    kind: 'tab', value: tab.id, label: tab.label, checked: !state.hiddenTabs.includes(tab.id),
  })));
  addTabSettingsGroup('Custom tabs', state.configuredTabs.map((tab) => ({
    kind: 'tab', value: tab.id, label: tab.label,
    detail: tab.kind === 'path' ? tab.path : tab.kind === 'query' ? `${tab.source || 'tasks'} query` : tab.url,
    checked: !state.hiddenTabs.includes(tab.id),
  })));
  const selected = new Set(state.selectedFolders);
  addTabSettingsGroup('Vault folders', state.availableFolders.map((folder) => ({
    kind: 'folder', value: folder,
    label: folder.split('/').filter(Boolean).pop() || folder,
    detail: folder,
    checked: selected.has(folder),
  })));
  if (!state.availableFolders.length) {
    container.appendChild(textEl('div', 'tab-settings-empty', 'No additional vault folders are available yet.'));
  }
}

function closeTabSettings(): void {
  const popover = $('tabSettingsPopover') as HTMLFormElement;
  popover.hidden = true;
  $('tabSettingsToggle').setAttribute('aria-expanded', 'false');
  $('tabSettingsStatus').textContent = '';
}

function openTabSettings(): void {
  renderTabSettingsOptions();
  const popover = $('tabSettingsPopover') as HTMLFormElement;
  popover.hidden = false;
  $('tabSettingsToggle').setAttribute('aria-expanded', 'true');
  $('tabSettingsStatus').textContent = '';
  window.requestAnimationFrame(() => popover.querySelector<HTMLInputElement>('input')?.focus());
}

$('tabSettingsToggle').onclick = () => {
  const popover = $('tabSettingsPopover') as HTMLFormElement;
  if (popover.hidden) openTabSettings(); else closeTabSettings();
};
$('tabSettingsClose').onclick = closeTabSettings;
$('tabSettingsReset').onclick = () => {
  document.querySelectorAll<HTMLInputElement>('#tabSettingsOptions input').forEach((input) => {
    input.checked = input.dataset.kind === 'tab';
  });
  $('tabSettingsStatus').textContent = '';
};
($('tabSettingsPopover') as HTMLFormElement).onsubmit = async (event: SubmitEvent) => {
  event.preventDefault();
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('#tabSettingsOptions input'));
  if (!inputs.some((input) => input.checked)) {
    $('tabSettingsStatus').textContent = 'Choose at least one tab.';
    return;
  }
  const hiddenTabs = inputs
    .filter((input) => input.dataset.kind === 'tab' && !input.checked)
    .map((input) => input.dataset.value || '').filter(Boolean);
  const folders = inputs
    .filter((input) => input.dataset.kind === 'folder' && input.checked)
    .map((input) => input.dataset.value || '').filter(Boolean);
  const save = $('tabSettingsSave') as HTMLButtonElement;
  const expectedEpoch = vaultEpoch;
  save.disabled = true;
  save.textContent = 'Saving…';
  $('tabSettingsStatus').textContent = '';
  try {
    await M.updateTabPreferences({ hiddenTabs, folders });
    if (expectedEpoch !== vaultEpoch) return;
    await loadAppConfig(expectedEpoch);
    if (expectedEpoch !== vaultEpoch) return;
    if (!visibleTab(state.tab)) switchTab(firstVisibleTab() || 'dashboard');
    else setActiveTab(state.tab);
    closeTabSettings();
  } catch (error) {
    $('tabSettingsStatus').textContent = String((error as Error)?.message || 'Could not save tabs');
  } finally {
    save.disabled = false;
    save.textContent = 'Done';
  }
};
document.addEventListener('click', (event) => {
  const settings = $('tabSettings');
  if (!(event.target instanceof Node) || settings.contains(event.target)) return;
  closeTabSettings();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !($('tabSettingsPopover') as HTMLFormElement).hidden) closeTabSettings();
});

$('vaultSwitch').onclick = () => { $('onboard').classList.toggle('dismissible', !!state.vault); $('onboard').style.display = 'grid'; initOnboarding(); };
// The switcher overlays a working vault — always let the user back out without re-opening.
function closeOnboard(): void { if (state.vault) $('onboard').style.display = 'none'; }
$('onboardClose').onclick = closeOnboard;
$('resetApprovals').onclick = async () => {
  const reset = $('resetApprovals') as HTMLButtonElement;
  reset.disabled = true;
  const result = await M.resetToolApprovals();
  reset.textContent = result.ok ? 'Tool approvals reset' : 'No open vault to reset';
  window.setTimeout(() => {
    reset.textContent = 'Reset tool approvals for this vault';
    reset.disabled = false;
  }, 1800);
};
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOnboard(); });

// Fetched once at startup: the version cannot change while the window is open
// (an update is applied on quit).
void M.appVersion().then((v) => { $('appVersion').textContent = v ? `Memex ${v}` : ''; }).catch(() => {});

// ---- app updates ----
// The startup auto-check stays silent; this button is the loud path. The
// check invoke resolves only once the answer is final (a found update is
// downloaded first), with progress arriving as update:status pushes — which
// also fire for the silent startup download, so the button flips to "Restart
// to update" even when the user never clicked.
const updateBtn = $('checkUpdates') as HTMLButtonElement;
let updateReady = false;
let updateDownloading = false;
let updateResetTimer = 0;
function showUpdateStatus(s: UpdateStatus): void {
  window.clearTimeout(updateResetTimer);
  if (s.state === 'downloading') {
    updateDownloading = true;
    updateBtn.disabled = true;
    updateBtn.textContent = typeof s.percent === 'number'
      ? `Downloading update… ${s.percent}%`
      : `Downloading update${s.version ? ` ${s.version}` : ''}…`;
  } else if (s.state === 'ready') {
    updateDownloading = false;
    updateReady = true;
    updateBtn.disabled = false;
    updateBtn.title = '';
    updateBtn.classList.add('ready');
    updateBtn.textContent = s.version ? `Restart to update to ${s.version}` : 'Restart to update';
  } else if (s.state === 'error' && updateDownloading && !updateReady) {
    // A background download died after its progress pushes disabled the
    // button; re-enable it. Errors outside a visible download stay silent —
    // the user didn't ask, and the manual path reports through its invoke.
    updateDownloading = false;
    updateBtn.disabled = false;
    updateBtn.textContent = 'Couldn’t download the update';
    if (s.message) updateBtn.title = s.message;
    updateResetTimer = window.setTimeout(() => { if (!updateReady) updateBtn.textContent = 'Check for app updates'; }, 6000);
  }
}
M.onUpdateStatus(showUpdateStatus);
updateBtn.onclick = async () => {
  if (updateReady) {
    updateBtn.disabled = true;
    updateBtn.textContent = 'Restarting…';
    const r = await M.installUpdate().catch(() => ({ ok: false }));
    // The app quits on success; reaching here with !ok means main lost the
    // downloaded update state (shouldn't happen) — fall back to a fresh check.
    if (!r.ok) { updateReady = false; updateBtn.classList.remove('ready'); updateBtn.disabled = false; updateBtn.textContent = 'Check for app updates'; }
    return;
  }
  updateBtn.disabled = true;
  updateBtn.title = '';
  updateBtn.textContent = 'Checking for app updates…';
  const s: UpdateStatus = await M.checkForUpdates()
    .catch((e) => ({ state: 'error' as const, message: String(e) }));
  showUpdateStatus(s);
  if (s.state === 'ready' || s.state === 'downloading') return;
  updateDownloading = false;
  updateBtn.disabled = false;
  if (s.state === 'uptodate') {
    updateBtn.textContent = `Up to date${s.version ? ` — Memex ${s.version}` : ''}`;
  } else {
    // unsupported / error: keep the button short, park the detail in a tooltip.
    updateBtn.textContent = s.state === 'unsupported' ? (s.message || 'Updates unavailable in this build') : 'Couldn’t check for app updates';
    if (s.message) updateBtn.title = s.message;
  }
  updateResetTimer = window.setTimeout(() => { if (!updateReady) updateBtn.textContent = 'Check for app updates'; }, 6000);
};

function applySummary(s: VaultSummary): void {
  const c = s.counts;
  $('cntTasks').textContent = c.openTasks ? String(c.openTasks) : '';
  $('cntProjects').textContent = c.projects ? String(c.projects) : '';
  $('cntIdeas').textContent = c.ideas ? String(c.ideas) : '';
  $('cntPeople').textContent = c.people ? String(c.people) : '';
  $('cntInbox').textContent = c.inbox ? String(c.inbox) : '';
  $('cntOutputs').textContent = c.outputs ? String(c.outputs) : '';
}

async function refreshSummary(): Promise<void> {
  const epoch = vaultEpoch;
  const s = await M.data('summary');
  if (s && epoch === vaultEpoch && !vaultOpening) { state.vault = s; applySummary(s); }
}

// ============================================================ CHAT
const chatScroll = $('chatScroll');
const composer = $('composerInput') as HTMLTextAreaElement;
const chatEmptyTemplate = document.getElementById('chatEmpty')?.cloneNode(true) as HTMLElement | undefined;

function resetVaultScopedUi(): void {
  resetVaultUiModel(state);
  closeTabSettings();
  clearThinking();
  // Invalidate any in-flight picker populate from the previous vault; the new
  // session's init event (or openVault's re-sync) rebuilds it.
  modelPickerToken++;
  sessionModel = '';
  modelTag.style.display = 'none';
  modelTag.textContent = '';
  currentArtifact = null;
  liveQuickNote = null;
  document.querySelectorAll('.tab[data-custom="1"], .chip[data-custom="1"]').forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>('.tab[data-builtin="1"]').forEach((button) => { button.style.display = ''; });
  $('artifactTab').style.display = 'none';
  $('panelBody').replaceChildren();
  chatScroll.replaceChildren(...(chatEmptyTemplate ? [chatEmptyTemplate.cloneNode(true)] : []));
  composer.value = '';
  autosize();
  setBusy(false);
}

function scrollChat(): void { chatScroll.scrollTop = chatScroll.scrollHeight; }

function addUserMsg(text: string): void {
  document.getElementById('chatEmpty')?.remove();
  const m = el('div', 'msg user');
  m.appendChild(el('div', 'msg-role', 'You'));
  const b = el('div', 'bubble'); b.textContent = text;
  m.appendChild(b);
  chatScroll.appendChild(m);
  scrollChat();
}

function ensureAssistantBubble(): ActiveAssistant {
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

function closeAssistantBubble(): void {
  if (state.activeAssistant) {
    const cur = state.activeAssistant.bubble.querySelector('.cursor');
    if (cur) cur.remove();
  }
  state.activeAssistant = null;
}

function onAssistantDelta(text: string): void {
  const a = ensureAssistantBubble();
  a.streamed = true; a.raw += text;
  let live = a.bubble.querySelector('.live-text');
  if (!live) { live = el('span', 'live-text'); a.bubble.appendChild(live); a.bubble.appendChild(el('span', 'cursor')); }
  live.textContent = a.raw;
  scrollChat();
}

function onAssistantText(text: string, html: string): void {
  const a = ensureAssistantBubble();
  a.bubble.innerHTML = html;          // authoritative, rendered markdown
  a.streamed = true;
  closeAssistantBubble();             // this text block is complete
  scrollChat();
}

const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading', Write: 'Writing', Edit: 'Editing', Bash: 'Running',
  Glob: 'Finding files', Grep: 'Searching', WebFetch: 'Fetching', WebSearch: 'Searching web',
  TodoWrite: 'Planning', Task: 'Delegating', NotebookEdit: 'Editing notebook',
};
function toolLabel(name: string): string {
  if (name.startsWith('mcp__ui__show_artifact')) return 'Showing artifact';
  if (name.startsWith('mcp__ui__open_in_claude_code')) return 'Opening in Claude Code';
  if (name.startsWith('mcp__')) return name.replace('mcp__', '').replace(/__/g, ' · ');
  return TOOL_LABELS[name] || name;
}
function toolDetail(name: string, input?: Record<string, unknown>): string {
  if (!input) return '';
  const s = (k: string) => (input[k] != null ? String(input[k]) : '');
  if (input.file_path) return s('file_path').split('/').slice(-2).join('/');
  if (input.path) return s('path');
  if (input.command) return s('command');
  if (input.pattern) return s('pattern');
  if (input.query) return s('query');
  if (input.description) return s('description');
  if (input.title) return s('title');
  if (input.prompt) return s('prompt').slice(0, 80);
  return '';
}

function addToolCard(id: string | undefined, name: string, input?: Record<string, unknown>): HTMLElement {
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
  (card.querySelector('.tool-head') as HTMLElement).onclick = () => card.classList.toggle('open');
  chatScroll.appendChild(card);
  if (id) state.toolCards.set(id, card);
  scrollChat();
  return card;
}

function completeToolCard(id: string | undefined, text?: string, isError?: boolean): void {
  const card = id ? state.toolCards.get(id) : undefined;
  if (!card) return;
  card.classList.add('done');
  if (isError) card.classList.add('err');
  const pre = card.querySelector('.tool-body pre');
  if (pre && text) pre.textContent = text.slice(0, 4000);
  else (card.querySelector('.tool-body') as HTMLElement).style.display = 'none';
}

function setBusy(b: boolean): void {
  state.busy = b;
  $('sendBtn').style.display = b ? 'none' : 'grid';
  $('stopBtn').style.display = b ? 'grid' : 'none';
  $('connDot').classList.toggle('busy', b);
  $('connDot').classList.toggle('live', !b && !!state.vault);
  $('statusLine').textContent = b ? 'Thinking…' : 'Ready';
}

// ---------------- model picker ----------------
// The titlebar tag doubles as a dropdown: the "default" entry inherits whatever
// the user's Claude Code configuration says (the pre-picker behaviour), and an
// explicit choice is applied live and persisted per vault by the main process.
const modelTag = $('modelTag') as HTMLSelectElement;
let sessionModel = '';           // model reported by the session init event
let modelPickerToken = 0;        // ignore stale populates across vault switches

async function refreshModelPicker(): Promise<void> {
  const token = ++modelPickerToken;
  const state = await M.agentModels().catch((): ModelState => ({ models: [], selected: null }));
  if (token !== modelPickerToken) return;
  if (!state.models.length && !sessionModel) { modelTag.style.display = 'none'; return; }
  modelTag.textContent = '';
  const shortName = sessionModel.replace('claude-', '');
  // With no override active, the session runs on the inherited model — name it.
  const defaultLabel = !state.selected && shortName ? `default (${shortName})` : 'default';
  modelTag.appendChild(new Option(defaultLabel, ''));
  // The CLI lists its own "default" row; our inherit option already covers it.
  for (const m of state.models.filter((m) => m.value !== 'default')) {
    const opt = new Option(m.label, m.value);
    if (m.description) opt.title = m.description;
    modelTag.appendChild(opt);
  }
  // A persisted value the CLI no longer lists must still round-trip visibly.
  if (state.selected && !state.models.some((m) => m.value === state.selected)) {
    modelTag.appendChild(new Option(state.selected, state.selected));
  }
  modelTag.value = state.selected || '';
  modelTag.style.display = '';
}

modelTag.onchange = async () => {
  const r = await M.setAgentModel(modelTag.value || null).catch(() => ({ ok: false, error: 'Could not switch models' }));
  if (!r.ok) flashChat('⚠ ' + (r.error || 'Could not switch models'));
  // Re-sync either way: on failure this reverts the visible selection.
  void refreshModelPicker();
};

// A dim, single-line trace of the model's extended thinking so long thinking
// stretches aren't a silent "Thinking…" with no sign of life.
let thinkingBuf = '';
function onThinkingDelta(text: string): void {
  thinkingBuf += text;
  let line = document.getElementById('thinkingLine');
  if (!line) { line = el('div', 'thinking-line'); line.id = 'thinkingLine'; chatScroll.appendChild(line); }
  line.textContent = '✳ ' + thinkingBuf.slice(-120).replace(/\s+/g, ' ').trimStart();
  scrollChat();
}
function clearThinking(): void { thinkingBuf = ''; document.getElementById('thinkingLine')?.remove(); }

// agent events
M.onAgentEvent((evt) => {
  // Session startup runs while the open IPC is pending. Preserve an early
  // failure until the vault UI has either reset or resumed its prior view.
  if (vaultOpening && evt.kind === 'error') {
    deferredAgentErrors.push(evt.message);
    return;
  }
  switch (evt.kind) {
    // While a vault open is in flight the main process reports no active vault,
    // so hold the refresh; openVault re-syncs the picker once the open commits.
    case 'session': sessionModel = evt.model || ''; if (!vaultOpening) void refreshModelPicker(); break;
    case 'turn_start': setBusy(true); break;
    case 'thinking_delta': onThinkingDelta(evt.text); break;
    case 'assistant_delta': clearThinking(); onAssistantDelta(evt.text); break;
    case 'assistant_text': clearThinking(); onAssistantText(evt.text, evt.html || ''); break;
    case 'tool_use': clearThinking(); addToolCard(evt.id, evt.name, evt.input); break;
    case 'tool_result': completeToolCard(evt.id, evt.text, evt.isError); break;
    case 'artifact': if (evt.artifact) showArtifact(evt.artifact); break;
    case 'tool_start': case 'permission': break;   // cards render from tool_use; permissions are auto-allowed
    case 'result':
      setBusy(false); closeAssistantBubble(); clearThinking();
      if (evt.subtype && evt.subtype !== 'success') $('statusLine').textContent = `Ended: ${evt.subtype}`;
      else if (evt.usage) {
        const u = evt.usage; const tok = (u.output_tokens || 0) + (u.input_tokens || 0);
        $('statusLine').textContent = `Done · ${tok.toLocaleString()} tok${evt.costUsd ? ' · $' + evt.costUsd.toFixed(3) : ''}`;
      }
      break;
    case 'error': setBusy(false); clearThinking(); flashChat('⚠ ' + evt.message); break;
  }
});

function flashChat(text: string): void {
  document.getElementById('chatEmpty')?.remove();
  const m = el('div', 'msg assistant');
  m.appendChild(el('div', 'msg-role', 'System'));
  const b = el('div', 'bubble'); b.style.color = 'var(--rose)'; b.textContent = text;
  m.appendChild(b); chatScroll.appendChild(m); scrollChat();
}

async function sendMessage(text?: string): Promise<void> {
  text = (text || composer.value).trim();
  if (!text || !state.vault || vaultOpening) return;
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
function autosize(): void { composer.style.height = 'auto'; composer.style.height = Math.min(composer.scrollHeight, 180) + 'px'; }
composer.addEventListener('input', autosize);

$('chips').addEventListener('click', (e) => {
  const chip = (e.target as Element).closest('.chip') as HTMLElement | null; if (!chip) return;
  sendMessage(chip.dataset.prompt);
});

// ============================================================ TABS + DATA + HISTORY
$('tabs').addEventListener('click', (e) => {
  const t = (e.target as Element).closest('.tab') as HTMLElement | null;
  if (t && t.dataset.tab) switchTab(t.dataset.tab);
});
$('navBack').onclick = goBack;
$('navFwd').onclick = goForward;

function setActiveTab(tab: string): void {
  state.tab = tab;
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
}

// The right panel keeps a back/forward history over what it has shown:
// data tabs, opened notes, and agent-pushed artifacts.
function navigate(entry: HistoryEntry): void {
  const cur = state.history[state.histPos];
  const dup = !!cur && cur.k === entry.k &&
    ((entry.k === 'tab' && (cur as { tab?: string }).tab === entry.tab) ||
     (entry.k === 'note' && (cur as { rel?: string }).rel === entry.rel));
  if (!dup) {
    if (state.histPos < state.history.length - 1) state.history = state.history.slice(0, state.histPos + 1);
    state.history.push(entry);
    state.histPos = state.history.length - 1;
  }
  renderEntry(entry);
  updateNav();
}
let renderEpoch = 0;
function renderEntry(entry: HistoryEntry): void {
  if (entry.k === 'tab') {
    setActiveTab(entry.tab);
    void renderTab(entry.tab);
  }
  else { displayArtifact(entry.art); }
}
function goBack(): void { if (state.histPos > 0) { state.histPos--; renderEntry(state.history[state.histPos]); updateNav(); } }
function goForward(): void { if (state.histPos < state.history.length - 1) { state.histPos++; renderEntry(state.history[state.histPos]); updateNav(); } }
function updateNav(): void {
  ($('navBack') as HTMLButtonElement).disabled = state.histPos <= 0;
  ($('navFwd') as HTMLButtonElement).disabled = state.histPos >= state.history.length - 1;
}

function switchTab(tab: string): void { navigate({ k: 'tab', tab }); }

async function renderTab(tab: string): Promise<void> {
  const epoch = ++renderEpoch;
  const body = $('panelBody');
  try {
    if (tab === 'artifact') { renderArtifact(); return; }
    body.style.position = ''; body.innerHTML = '<div style="display:grid;place-items:center;padding:60px"><div class="spinner-lg"></div></div>';
    // Render off-DOM so a slower, older IPC response cannot mutate the panel after
    // the user has already selected a different tab.
    const stage = document.createElement('div');
    if (tab === 'dashboard') await renderDashboard(stage);
    else if (tab === 'inbox') await renderInbox(stage);
    else if (tab === 'outbox') await renderOutbox(stage);
    else {
      const cdef = state.customTabs.find((t) => t.id === tab);
      if (cdef) {
        if (cdef.kind === 'query') await renderQueryTab(stage, cdef);
        else if (cdef.kind === 'web') renderWebTab(stage, cdef);
        else await renderCustomTab(stage, cdef);
      } else if (['tasks', 'projects', 'ideas', 'people'].includes(tab)) {
        const data = await M.data(tab as DataKind);
        if (tab === 'tasks') renderTasks(stage, data as TaskRow[]);
        else if (tab === 'projects') renderProjects(stage, data as ProjectRow[]);
        else if (tab === 'ideas') renderIdeas(stage, data as IdeaRow[]);
        else if (tab === 'people') renderPeople(stage, data as PersonRow[]);
      } else {
        // Unrecognized id (e.g. a custom tab removed from config but still in history).
        stage.innerHTML = '<div class="empty-note"><span class="big">This view is no longer available</span>It may have been a custom tab that was removed. Pick another tab above.</div>';
      }
    }
    if (epoch !== renderEpoch || state.tab !== tab) return;
    body.style.position = stage.style.position;
    body.replaceChildren(...Array.from(stage.childNodes));
    if (liveQuickNote?.input.isConnected &&
        (document.activeElement === document.body || !document.activeElement)) {
      liveQuickNote.input.focus();
    }
  } catch (error) {
    if (epoch !== renderEpoch || state.tab !== tab) return;
    const message = String((error as Error)?.message || error);
    body.style.position = '';
    body.innerHTML = `<div class="empty-note"><span class="big">Couldn’t load this view</span>${esc(message)}<br>Pick another tab above.</div>`;
  }
}

const STATUS_COLORS: Record<string, string> = {
  in_progress: 'var(--accent)', next: 'var(--accent-2)', waiting: 'var(--rose)',
  needs_review: 'var(--rose)', backlog: 'var(--ink-faint)', scheduled: 'var(--ink-dim)',
  done: 'var(--ink-faint)', canceled: 'var(--ink-faint)', inbox: 'var(--ink-faint)',
};

async function renderDashboard(body: HTMLElement): Promise<void> {
  const [s, brief, outputs] = await Promise.all([
    M.data('summary'), M.data('briefing'), M.data('outputs'),
  ]);
  if (!s) return;
  state.vault = s; applySummary(s);
  const fresh = (s.counts.tasks + s.counts.projects + s.counts.ideas + s.counts.people + s.counts.sources) === 0;
  if (fresh && !localStorage.getItem('memex-gs-skip:' + s.path)) return renderGettingStarted(body);
  body.innerHTML = '';
  const c = s.counts;
  const grid = el('div', 'dash-grid');
  const stats: Array<[string, number, string, string, boolean]> = [
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
    card.innerHTML = `<div class="bubble">${note && note.html ? note.html : esc(brief.body)}</div>`;
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

const GS_HERO_SVG = `<svg class="gs-hero" viewBox="0 0 720 250" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="360" cy="125" rx="330" ry="110" class="gs-glow"/>
  <path class="gs-link" d="M116 128 C 170 150, 260 160, 330 150"/>
  <path class="gs-link" d="M256 70 C 300 90, 320 110, 342 128"/>
  <path class="gs-link" d="M256 62 C 330 30, 420 32, 480 64"/>
  <path class="gs-link" d="M386 148 C 450 160, 540 150, 596 132"/>
  <g class="gs-doc"><rect x="60" y="86" width="56" height="72" rx="8"/><line x1="72" y1="104" x2="104" y2="104"/><line x1="72" y1="118" x2="104" y2="118"/><line x1="72" y1="132" x2="94" y2="132"/></g>
  <g class="gs-doc"><rect x="200" y="26" width="56" height="72" rx="8"/><line x1="212" y1="44" x2="244" y2="44"/><line x1="212" y1="58" x2="244" y2="58"/><line x1="212" y1="72" x2="234" y2="72"/></g>
  <g class="gs-doc"><rect x="330" y="112" width="56" height="72" rx="8"/><line x1="342" y1="130" x2="374" y2="130"/><line x1="342" y1="144" x2="374" y2="144"/><line x1="342" y1="158" x2="364" y2="158"/></g>
  <g class="gs-doc"><rect x="480" y="34" width="56" height="72" rx="8"/><line x1="492" y1="52" x2="524" y2="52"/><line x1="492" y1="66" x2="524" y2="66"/><line x1="492" y1="80" x2="514" y2="80"/></g>
  <g class="gs-doc"><rect x="596" y="96" width="56" height="72" rx="8"/><line x1="608" y1="114" x2="640" y2="114"/><line x1="608" y1="128" x2="640" y2="128"/><line x1="608" y1="142" x2="630" y2="142"/></g>
  <path class="gs-trail" d="M88 122 C 120 60, 180 52, 228 62 C 290 76, 310 120, 358 148 C 420 182, 460 120, 508 70 C 540 38, 600 60, 624 100"/>
  <g class="gs-node">
    <rect x="80" y="114" width="15" height="15" transform="rotate(45 88 122)"/>
    <rect x="220" y="54" width="15" height="15" transform="rotate(45 228 62)"/>
    <rect x="350" y="140" width="15" height="15" transform="rotate(45 358 148)"/>
    <rect x="500" y="62" width="15" height="15" transform="rotate(45 508 70)"/>
    <rect x="616" y="92" width="15" height="15" transform="rotate(45 624 100)"/>
  </g>
</svg>`;

function renderGettingStarted(body: HTMLElement): void {
  body.innerHTML = '';
  const wrap = el('div', 'gs-wrap');
  wrap.innerHTML = GS_HERO_SVG;

  wrap.appendChild(el('h1', 'gs-title', 'Welcome to your memex'));
  wrap.appendChild(el('p', 'gs-sub', 'It learns by conversation. Everything you tell it becomes notes, tasks, and trails it keeps for you — drop something in, or just start talking.'));

  const cta = el('button', 'btn primary gs-cta', '✦ Start the guided setup');
  cta.onclick = () => sendMessage("I'm new here — run my first-time setup. Introduce yourself in two sentences, then interview me: one question at a time, covering my current projects, what's on my plate this week, and the people I work with. When the interview is done, create the corresponding project, task, and people notes in the vault, then show me a summary artifact of everything you created.");
  wrap.appendChild(cta);

  wrap.appendChild(el('div', 'gs-cta-note', 'One short interview — it creates your first projects, tasks, and people.'));

  const cards = el('div', 'gs-cards');
  const cardDefs: Array<[string, string, () => void]> = [
    ['Tour this vault', 'What lives where, and how it stays tidy.',
      () => sendMessage('Give me a quick tour of how this vault is organized — what lives where, and how you keep it tidy.')],
    ['Brain-dump my week', 'Tell it everything on your plate; it files the pieces.',
      () => { composer.value = "Here's what's on my plate this week: "; autosize(); composer.focus(); }],
    ["Today's briefing", 'A first look at how mornings will feel.',
      () => sendMessage("Give me today's briefing.")],
  ];
  for (const [t, d, onclick] of cardDefs) {
    const card = el('div', 'gs-card', `<div class="t">${esc(t)}</div><div class="d">${esc(d)}</div>`);
    card.onclick = onclick;
    cards.appendChild(card);
  }
  wrap.appendChild(cards);

  const how = el('div', 'gs-how');
  const howDefs: Array<[string, string, string]> = [
    ['⇣', 'Capture', 'Drop files on the inbox — or on the app icon in the Dock. Everything lands in the Inbox for triage.'],
    ['✎', 'Converse', 'Ask in plain language. The agent files notes, links them into trails, and tracks the work.'],
    ['◈', 'Consult', 'Tabs stay live as the vault changes. Click any wikilink to follow a trail.'],
  ];
  for (const [ic, t, d] of howDefs) {
    how.appendChild(el('div', 'gs-how-item', `<div class="ic">${ic}</div><div class="t">${esc(t)}</div><div class="d">${esc(d)}</div>`));
  }
  wrap.appendChild(how);

  // Mail/calendar reach the agent through Claude connectors, configured once per account.
  const connect = el('div', 'gs-connect');
  connect.innerHTML = `
    <div class="t">⚲ Connect mail &amp; calendar</div>
    <div class="d">Your memex reads mail and calendar through Claude connectors — set up once in your Claude account, not in this app.</div>
    <ol>
      <li>At <a class="gs-ext" data-url="https://claude.ai/customize/connectors">claude.ai → Settings → Connectors</a>, connect your suite — Google (Gmail, Google Calendar, Drive) or Microsoft 365 (Outlook mail &amp; calendar, OneDrive) <span class="dim">(Pro, Max, Team, and Enterprise plans)</span>.</li>
      <li>Sign in to the <span class="mono">claude</span> CLI with that same account — connectors flow into this agent automatically.</li>
      <li>Then ask here: <em>“What sources are connected?”</em> — the agent can check its own tools.</li>
    </ol>`;
  const ext = connect.querySelector('.gs-ext') as HTMLElement;
  ext.onclick = (e) => { e.preventDefault(); M.openExternal(ext.dataset.url || ''); };
  wrap.appendChild(connect);

  const skip = el('button', 'gs-skip', 'Skip for now — show the dashboard');
  skip.onclick = () => { localStorage.setItem('memex-gs-skip:' + (state.vault?.path || ''), '1'); renderTab('dashboard'); };
  wrap.appendChild(skip);

  body.appendChild(wrap);
}

function metaRow(children: Array<HTMLElement | ''>): HTMLElement {
  const s = el('div', 'r-sub');
  children.filter((c): c is HTMLElement => c !== '').forEach((c) => s.appendChild(c));
  return s;
}
function span(cls: string, txt: string): HTMLElement { return el('span', cls, esc(txt)); }

function renderList<T>(body: HTMLElement, items: T[] | null | undefined, emptyMsg: string, rowFn: (it: T) => HTMLElement): void {
  body.innerHTML = '';
  if (!items || !items.length) { body.innerHTML = `<div class="empty-note"><span class="big">Nothing here yet</span>${emptyMsg}</div>`; return; }
  const rows = el('div', 'rows');
  items.forEach((it) => rows.appendChild(rowFn(it)));
  body.appendChild(rows);
}

function taskRow(t: TaskRow): HTMLElement {
  const r = el('div', 'row');
  r.appendChild(textEl('span', `prio ${t.priority}`, t.priority));
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(t.title)));
  main.appendChild(metaRow([
    t.project ? span('', '◆ ' + t.project) : '',
    t.due ? span('mono', 'due ' + t.due) : '',
    t.effort ? span('mono', t.effort) : '',
  ]));
  r.appendChild(main);
  r.appendChild(textEl('span', `pill s-${t.status}`, t.status.replace('_', ' ')));
  r.onclick = () => openNote(t.rel, t.title);
  return r;
}

function projectRow(p: ProjectRow): HTMLElement {
  const r = el('div', 'row');
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(p.title)));
  main.appendChild(metaRow([
    p.area ? span('', '▲ ' + p.area) : '',
    p.phase ? span('mono', p.phase) : '',
    p.target_date ? span('mono', '→ ' + p.target_date) : '',
  ]));
  r.appendChild(main);
  r.appendChild(textEl('span', `pill s-${p.status}`, p.status));
  r.onclick = () => openNote(p.rel, p.title);
  return r;
}

function ideaRow(i: IdeaRow): HTMLElement {
  const r = el('div', 'row');
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(i.title)));
  main.appendChild(metaRow([
    (i.tags && i.tags.length) ? span('', i.tags.map((t) => '#' + t).join(' ')) : '',
    i.effort ? span('mono', i.effort + ' effort') : '',
  ]));
  r.appendChild(main);
  r.appendChild(textEl('span', `pill s-${i.status}`, i.status));
  r.onclick = () => openNote(i.rel, i.title);
  return r;
}

function peopleRow(p: PersonRow): HTMLElement {
  const r = el('div', 'row');
  const av = el('div', 'file-ic'); av.textContent = (p.title || '?').slice(0, 1); av.style.textTransform = 'none';
  r.appendChild(av);
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(p.title)));
  main.appendChild(metaRow([p.role ? span('', p.role) : '', p.org ? span('', p.org) : '']));
  r.appendChild(main);
  if (p.strength) r.appendChild(textEl('span', 'prio', p.strength));
  r.onclick = () => openNote(p.rel, p.title);
  return r;
}

function sourceRow(s: SourceRow): HTMLElement {
  const r = el('div', 'row');
  r.appendChild(textEl('div', 'file-ic', (s.kind || 'src').slice(0, 3)));
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(s.title)));
  main.appendChild(metaRow([s.author ? span('', s.author) : '', s.status ? span('mono', s.status) : '']));
  r.appendChild(main);
  r.onclick = () => openNote(s.rel, s.title);
  return r;
}

// Rows arrive over IPC as plain data; each fn narrows to its own row shape.
const ROW_FNS: Record<string, (x: never) => HTMLElement> = {
  tasks: taskRow, projects: projectRow, ideas: ideaRow, people: peopleRow, sources: sourceRow,
};

function renderTasks(body: HTMLElement, tasks: TaskRow[] | null): void { renderList(body, tasks, 'Ask the agent to create a task.', taskRow); }
function renderProjects(body: HTMLElement, items: ProjectRow[] | null): void { renderList(body, items, 'Ask the agent to set up a project.', projectRow); }
function renderIdeas(body: HTMLElement, items: IdeaRow[] | null): void { renderList(body, items, 'Brain-dump an idea into the inbox or chat.', ideaRow); }
function renderPeople(body: HTMLElement, items: PersonRow[] | null): void { renderList(body, items, 'People show up as you capture work.', peopleRow); }

// ============================================================ INBOX
async function renderInbox(body: HTMLElement): Promise<void> {
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
  (dz.querySelector('.dz-actions') as HTMLElement).append(addNote, triage);
  dz.onclick = (e) => { if (e.target === addNote || e.target === triage) return; pickFilesToInbox(); };
  wireDrop(dz);
  body.appendChild(dz);
  if (liveQuickNote) {
    // a live refresh already wiped the panel (renderTab's spinner) — re-attach the
    // detached form so a half-typed quick note survives; it keeps value + listeners
    dz.appendChild(liveQuickNote.form);
  }

  if (!items || !items.length) {
    body.appendChild(el('div', 'empty-note', 'Inbox is clear. Everything has been filed.'));
    return;
  }
  body.appendChild(el('div', 'section-title', `In the inbox (${items.length})`));
  const rows = el('div', 'rows');
  items.forEach((it) => {
    const r = el('div', 'row');
    r.appendChild(textEl('div', 'file-ic', it.isDir ? '⁄' : (it.ext || 'txt')));
    const main = el('div', 'r-main');
    main.appendChild(el('div', 'r-title', esc(it.name)));
    main.appendChild(metaRow([span('mono', fmtSize(it.size)), span('mono', fmtTime(it.mtime))]));
    r.appendChild(main);
    if (!it.isDir && /^(md|markdown|txt|html?)$/.test(it.ext || '')) r.onclick = () => openNote(it.rel, it.name);
    rows.appendChild(r);
  });
  body.appendChild(rows);
}

// The open quick-note form (if any); module-level so a live inbox re-render can
// re-attach it instead of losing the user's half-typed text.
let liveQuickNote: { form: HTMLElement; input: HTMLInputElement } | null = null;

function quickNote(): void {
  // window.prompt() is not implemented in Electron — use an inline input in the dropzone.
  if (vaultOpening) return;
  const dz = document.querySelector('.dropzone');
  if (!dz || liveQuickNote) return;
  const form = el('div', 'qn-form');
  const input = document.createElement('input');
  input.type = 'text'; input.placeholder = 'Quick note… Enter to add, Esc to cancel';
  input.className = 'qn-input';
  const save = el('button', 'btn primary mini', 'Add');
  const cancel = el('button', 'btn mini', 'Cancel');
  form.append(input, save, cancel);
  form.onclick = (e) => e.stopPropagation();   // the dropzone itself opens the file picker on click
  liveQuickNote = { form, input };
  const done = () => { liveQuickNote = null; form.remove(); };
  const submit = async () => {
    const text = input.value.trim();
    if (!text) { done(); return; }
    const epoch = vaultEpoch;
    save.setAttribute('disabled', '');
    input.disabled = true;
    try {
      const result = await M.addInboxNote(text);
      if (epoch !== vaultEpoch) return;
      if (!result.ok) {
        input.disabled = false;
        save.removeAttribute('disabled');
        flash(result.error || 'Could not save the quick note');
        input.focus();
        return;
      }
      done();
      if (state.tab === 'inbox') void renderTab('inbox');
      void refreshSummary();
    } catch (error) {
      if (epoch !== vaultEpoch) return;
      input.disabled = false;
      save.removeAttribute('disabled');
      flash('Could not save the quick note: ' + String((error as Error)?.message || error));
      input.focus();
    }
  };
  save.onclick = submit;
  cancel.onclick = done;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.stopPropagation(); done(); }
  };
  dz.appendChild(form);
  input.focus();
}

async function pickFilesToInbox(): Promise<void> {
  if (vaultOpening) return;
  const epoch = vaultEpoch;
  const paths = await M.pickFiles();
  if (epoch !== vaultEpoch || vaultOpening || !paths || !paths.length) return;
  const res = await M.dropIntoInbox(paths);
  if (epoch !== vaultEpoch || vaultOpening) return;
  if (res && res.ok) {
    $('statusLine').textContent = `Added ${(res.copied || []).length} to inbox`;
    refreshSummary();
    if (state.tab === 'inbox') renderTab('inbox');
  } else {
    flash(res?.error || 'Could not copy those files into the Inbox');
  }
}

// ============================================================ OUTBOX
function outputRow(o: FileEntry): HTMLElement {
  const r = el('div', 'row');
  r.appendChild(textEl('div', 'file-ic', o.ext || 'txt'));
  const main = el('div', 'r-main');
  main.appendChild(el('div', 'r-title', esc(o.name)));
  main.appendChild(metaRow([span('mono', o.rel.replace(/^outputs\//, '')), span('mono', fmtSize(o.size)), span('mono', fmtTime(o.mtime))]));
  r.appendChild(main);
  const acts = el('div', 'r-actions');
  const viewable = /^(md|markdown|html?|txt|png|jpe?g|gif|svg|webp)$/.test(o.ext || '');
  if (viewable) {
    const view = el('button', 'btn mini', 'View');
    view.onclick = (e) => { e.stopPropagation(); openNote(o.rel, o.name); };
    acts.appendChild(view);
  }
  const open = el('button', 'btn mini', 'Open');
  open.onclick = (e) => { e.stopPropagation(); M.openExternal(o.rel); };
  acts.appendChild(open);
  r.appendChild(acts);
  r.onclick = viewable ? () => openNote(o.rel, o.name) : () => M.openExternal(o.rel);
  return r;
}

async function renderOutbox(body: HTMLElement): Promise<void> {
  const items = await M.data('outputs');
  body.innerHTML = '';
  body.appendChild(el('div', 'section-title', 'Outbox — generated artifacts'));
  if (!items || !items.length) { body.appendChild(el('div', 'empty-note', 'No generated outputs yet. Ask for a report or a dashboard.')); return; }
  const rows = el('div', 'rows');
  items.forEach((o) => rows.appendChild(outputRow(o)));
  body.appendChild(rows);
}

// ============================================================ CUSTOM TABS
async function renderQueryTab(body: HTMLElement, def: TabDef): Promise<void> {
  const res = await M.tabQuery(def);
  body.style.position = '';
  body.innerHTML = '';
  const rowFn = (ROW_FNS[res.source] || taskRow) as (x: DataRow) => HTMLElement;
  const head = el('div', 'section-title');
  head.appendChild(document.createTextNode(def.label));
  const count = el('span', 'tab-count'); count.textContent = String(res.rows.length); head.appendChild(count);
  body.appendChild(head);
  if (!res.rows.length) { body.appendChild(el('div', 'empty-note', esc(def.empty || 'Nothing matches this query right now.'))); return; }
  const rows = el('div', 'rows');
  res.rows.forEach((x) => rows.appendChild(rowFn(x)));
  body.appendChild(rows);
}

function renderWebTab(body: HTMLElement, def: TabDef): void {
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
  const wv = document.createElement('webview') as WebviewTag;
  wv.setAttribute('src', def.url);
  wv.setAttribute('allowpopups', '');
  // transparent while loading/failed (no white flash over the dark theme), then a
  // white backing once loaded — unstyled guest pages are transparent and would
  // otherwise show black default text on the dark panel
  wv.style.cssText = 'width:100%;height:100%;flex:1;border:none;background:transparent;';
  wv.addEventListener('did-finish-load', () => { wv.style.background = '#fff'; });
  const err = el('div', 'empty-note');
  err.style.display = 'none';
  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3 || !e.isMainFrame) return;   // -3 = aborted (e.g. our own reload)
    err.innerHTML = `<span class="big">Can’t reach this page</span>${esc(def.url)} — ${esc(e.errorDescription || 'failed to load')}. Check that the server is running, then hit Reload.`;
    wv.style.display = 'none'; err.style.display = '';
  });
  reload.onclick = () => {
    err.style.display = 'none'; wv.style.display = ''; wv.style.background = 'transparent';
    try { wv.reload(); } catch (_) { wv.src = def.url; }
  };
  abody.appendChild(wv);
  abody.appendChild(err);
  wrap.appendChild(abody);
  body.appendChild(wrap);
}

async function renderCustomTab(body: HTMLElement, def: TabDef): Promise<void> {
  const res = await M.tabContent(def.path);
  body.style.position = '';
  body.innerHTML = '';
  if (!res || res.type === 'missing') {
    body.innerHTML = `<div class="empty-note"><span class="big">${esc(def.label)}</span>${esc(def.empty || ('Nothing at ' + def.path + ' yet — ask the agent to create it.'))}</div>`;
    return;
  }
  if (res.type === 'dir') {
    body.appendChild(el('div', 'section-title', esc(def.label)));
    const items = res.items || [];
    if (!items.length) { body.appendChild(el('div', 'empty-note', esc(def.empty || 'This folder is empty.'))); return; }
    const rows = el('div', 'rows');
    items.forEach((o) => rows.appendChild(outputRow(o)));
    body.appendChild(rows);
    return;
  }
  const f = res.file;   // single-file tab
  if (!f) return;
  const bar = el('div', 'section-title', esc(def.label));
  if (f.kind === 'html') {
    body.style.position = 'relative';
    const wrap = el('div', 'artifact-wrap');
    const abody = el('div', 'artifact-body');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
    iframe.referrerPolicy = 'no-referrer';
    iframe.src = f.url || '';
    abody.appendChild(iframe); wrap.appendChild(abody); body.appendChild(wrap);
  } else if (f.kind === 'image') {
    body.appendChild(bar);
    const img = el('img', 'artifact-img') as HTMLImageElement; img.src = f.dataUri || ''; body.appendChild(img);
  } else {
    body.appendChild(bar);
    const d = el('div', 'artifact-md bubble'); d.innerHTML = f.html || ('<pre>' + esc(f.content || '') + '</pre>'); body.appendChild(d);
  }
}

// ============================================================ ARTIFACT VIEWER
let currentArtifact: ArtifactView | null = null;

function displayArtifact(art: ArtifactView): void {   // no history push
  renderEpoch++;   // cancel any in-flight tab render before it can commit
  currentArtifact = art;
  state.hasArtifact = true;
  $('artifactTab').style.display = '';
  setActiveTab('artifact');
  renderArtifact();
}
function showArtifact(art: ArtifactView): void { navigate({ k: 'art', art }); }

// Closing clears the pinned artifact and hides the tab. Panel back-history is
// deliberately left intact: ‹ can restore a closed artifact, doubling as undo.
function closeArtifact(): void {
  currentArtifact = null;
  state.hasArtifact = false;
  $('artifactTab').style.display = 'none';
  if (state.tab === 'artifact') switchTab(firstVisibleTab() || 'dashboard');
}
$('artifactClose').onclick = (e) => { e.stopPropagation(); closeArtifact(); };

function renderArtifact(): void {
  const body = $('panelBody');
  body.style.position = 'relative';
  body.innerHTML = '';
  if (!currentArtifact) { body.innerHTML = '<div class="empty-note">No artifact yet. Ask the agent for a dashboard or report.</div>'; return; }
  const a = currentArtifact;
  const wrap = el('div', 'artifact-wrap');
  const bar = el('div', 'artifact-bar');
  bar.appendChild(el('div', 'a-title', esc(a.title || 'Artifact')));
  if (a.rel) {
    const rel = a.rel;
    const ob = el('button', 'btn mini', 'Open file'); ob.onclick = () => M.openExternal(rel); bar.appendChild(ob);
  }
  wrap.appendChild(bar);
  const abody = el('div', 'artifact-body');
  if (a.kind === 'html') {
    // Served from a unique artifact:// origin with a no-network CSP. Each document
    // keeps its isolated origin while same-origin enables localStorage for its scripts.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
    iframe.referrerPolicy = 'no-referrer';
    iframe.src = a.url || '';
    abody.appendChild(iframe);
  } else if (a.kind === 'image') {
    const img = el('img', 'artifact-img') as HTMLImageElement; img.src = a.dataUri || ''; abody.appendChild(img);
  } else {
    const md = el('div', 'artifact-md bubble'); md.innerHTML = a.html || esc(a.text || ''); abody.appendChild(md);
  }
  wrap.appendChild(abody);
  body.appendChild(wrap);
}

async function openNote(rel: string, title?: string): Promise<void> {
  if (vaultOpening) return;
  const epoch = vaultEpoch;
  const f = await M.readNote(rel);
  if (epoch !== vaultEpoch || vaultOpening) return;
  if (!f) { flash('Could not read ' + rel); return; }
  if (!title) title = (rel.split('/').pop() || rel).replace(/\.[^.]+$/, '');
  let art: ArtifactView;
  if (f.kind === 'html') art = { title: title || rel, kind: 'html', url: f.url, rel };
  else if (f.kind === 'image') art = { title: title || rel, kind: 'image', dataUri: f.dataUri, rel };
  else if (f.kind === 'markdown') art = { title: title || rel, kind: 'markdown', html: f.html, rel };
  else art = { title: title || rel, kind: 'markdown', html: '<pre>' + esc(f.content) + '</pre>', rel };
  navigate({ k: 'note', rel, title, art });
}

// ============================================================ DRAG & DROP
function wireDrop(zone: HTMLElement): void {
  (['dragenter', 'dragover'] as const).forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  (['dragleave', 'drop'] as const).forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('over')));
  zone.addEventListener('drop', (e) => { e.preventDefault(); handleDrop(e); });
}

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (!state.vault || vaultOpening) return; dragDepth++; e.preventDefault(); $('dropOverlay').classList.add('show'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) $('dropOverlay').classList.remove('show'); });
window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('dropOverlay').classList.remove('show'); handleDrop(e); });

async function handleDrop(e: DragEvent): Promise<void> {
  if (!state.vault || vaultOpening) return;
  const epoch = vaultEpoch;
  const files = Array.from(e.dataTransfer?.files || []);
  if (!files.length) return;
  const paths = files.map((f) => M.getPathForFile(f)).filter(Boolean);
  const res = await M.dropIntoInbox(paths);
  if (epoch !== vaultEpoch || vaultOpening) return;
  if (res && res.ok) {
    $('statusLine').textContent = `Added ${(res.copied || []).length} to inbox`;
    refreshSummary();
    if (state.tab === 'inbox') renderTab('inbox');
    flashChat(`Dropped ${(res.copied || []).length} file(s) into the inbox. Say “triage the inbox” when ready.`);
  } else {
    flashChat('⚠ ' + (res?.error || 'Could not copy those files into the Inbox'));
  }
}

function reportIconDrop(copied: string[], error?: string): void {
  if (error) { flashChat('⚠ ' + error); return; }
  flashChat(`Dropped ${copied.length} file(s) into the inbox from the app icon. Say “triage the inbox” when ready.`);
  if (state.tab === 'inbox') renderTab('inbox');
  refreshSummary();
}

// files dropped on the app's Dock/taskbar icon land here instead of the drop zone
M.onIconDrop(({ copied, error }) => {
  if (vaultOpening) deferredIconDrops.push({ copied, error });
  else reportIconDrop(copied, error);
});

// ============================================================ FS WATCH
let fsTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFsAreas = new AreaBatch();
M.onFsChanged(({ area }) => {
  pendingFsAreas.add(area);
  if (fsTimer) clearTimeout(fsTimer);
  fsTimer = setTimeout(async () => {
    fsTimer = null;
    const areas = pendingFsAreas.drain();
    if (vaultOpening || !areas.length) return;
    void refreshSummary();
    const configChanged = areas.includes('config');
    if (configChanged) {
      const epoch = vaultEpoch;
      await loadAppConfig(epoch);
      if (epoch !== vaultEpoch || vaultOpening) return;
      // rebuilding the tab bar wipes the active class — and the active tab itself may be gone
      if (!visibleTab(state.tab)) return switchTab(firstVisibleTab() || 'dashboard');
      setActiveTab(state.tab);
    }
    const cdef = state.customTabs.find((t) => t.id === state.tab);
    // web tabs don't show vault data — re-rendering would reload the embedded page
    // unless their own configuration changed.
    if (cdef && cdef.kind === 'web' && !configChanged) return;
    const map: Record<string, string> = { inbox: 'inbox', outputs: 'outbox', tasks: 'tasks', atlas: state.tab, briefings: 'dashboard' };
    if (configChanged || cdef || state.tab === 'dashboard' || areas.some((changed) => state.tab === map[changed])) {
      void renderTab(state.tab);
    }
  }, 200);
});

// ============================================================ VAULT SEARCH (⌘K)
let searchSel = 0;
let searchSeq = 0;
let searchTimer: number | undefined;
// title doubles as the query text for the trailing ask-the-agent row
let searchItems: Array<{ rel: string; ext: string; title: string; ask?: boolean }> = [];

// extensions openNote can display in the artifact panel; everything else reveals in Finder
const VIEWABLE_EXTS = new Set(['md', 'markdown', 'txt', 'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const SEARCH_QUERY_LIMIT = 256;

function currentSearchQuery(): string {
  return ($('searchInput') as HTMLInputElement).value.trim().slice(0, SEARCH_QUERY_LIMIT);
}

function openSearch(): void {
  if (!state.vault || vaultOpening) return;
  window.clearTimeout(searchTimer);
  searchTimer = undefined;
  searchSeq++;   // invalidate a response left over from an earlier palette session
  $('searchOverlay').style.display = 'grid';
  const input = $('searchInput') as HTMLInputElement;
  input.value = '';
  renderSearchResults(null);
  input.focus();
}
function closeSearch(): void {
  window.clearTimeout(searchTimer);
  searchTimer = undefined;
  searchSeq++;
  searchItems = [];
  $('searchOverlay').style.display = 'none';
}

function activateSearchItem(i: number): void {
  const item = searchItems[i];
  if (!item) return;
  closeSearch();
  if (item.ask) { void sendMessage(item.title); return; }
  if (VIEWABLE_EXTS.has(item.ext)) void openNote(item.rel, item.title);
  else void M.revealPath(item.rel);
}

function highlightMatch(text: string, q: string): string {
  const t = esc(text);
  const needle = esc(q).toLowerCase();
  const idx = t.toLowerCase().indexOf(needle);
  if (idx < 0) return t;
  return t.slice(0, idx) + '<mark>' + t.slice(idx, idx + needle.length) + '</mark>' + t.slice(idx + needle.length);
}

function updateSearchSel(): void {
  const rows = document.querySelectorAll('#searchResults .sr-row');
  rows.forEach((r, i) => r.classList.toggle('sel', i === searchSel));
  rows[searchSel]?.scrollIntoView({ block: 'nearest' });
}

function renderSearchResults(res: SearchResults | null): void {
  const box = $('searchResults');
  const q = currentSearchQuery();
  searchItems = []; searchSel = 0;
  box.innerHTML = '';
  if (q.length < 2) {
    box.appendChild(el('div', 'sr-hint', 'Type to search filenames, titles, and note text.'));
    return;
  }
  const addSection = (label: string, hits: SearchHit[]) => {
    if (!hits.length) return;
    box.appendChild(el('div', 'sr-section', esc(label)));
    hits.forEach((h) => {
      const row = el('div', 'sr-row');
      const main = el('div', 'sr-main');
      main.innerHTML = `<div class="sr-title">${highlightMatch(h.title, q)}</div><div class="sr-rel">${esc(h.rel)}</div>`;
      if (h.snippet) { const sn = el('div', 'sr-snip'); sn.innerHTML = highlightMatch(h.snippet, q); main.appendChild(sn); }
      row.append(el('span', 'sr-ext', esc(h.ext || 'md')), main);
      const idx = searchItems.length;
      row.onclick = () => activateSearchItem(idx);
      row.onmousemove = () => { if (searchSel !== idx) { searchSel = idx; updateSearchSel(); } };
      searchItems.push({ rel: h.rel, ext: h.ext, title: h.title });
      box.appendChild(row);
    });
  };
  if (res) {
    addSection('Files & titles', res.files);
    addSection('In note text', res.content);
    if (!res.files.length && !res.content.length) box.appendChild(el('div', 'sr-hint', 'No direct matches in the vault.'));
  }
  const ask = el('div', 'sr-row sr-ask');
  ask.innerHTML = `<span class="sr-ext">⁂</span><div class="sr-main"><div class="sr-title">Ask your memex about “${esc(q)}”</div><div class="sr-rel">sends the query to the agent — it can search meaning, not just text</div></div>`;
  const askIdx = searchItems.length;
  ask.onclick = () => activateSearchItem(askIdx);
  ask.onmousemove = () => { if (searchSel !== askIdx) { searchSel = askIdx; updateSearchSel(); } };
  searchItems.push({ rel: '', ext: '', title: q, ask: true });
  box.appendChild(ask);
  updateSearchSel();
}

$('searchOpen').onclick = openSearch;
$('searchOverlay').onclick = (e) => { if (e.target === $('searchOverlay')) closeSearch(); };
$('searchInput').addEventListener('input', () => {
  const q = currentSearchQuery();
  window.clearTimeout(searchTimer);
  searchTimer = undefined;
  const seq = ++searchSeq;   // invalidate old results before the debounce elapses
  renderSearchResults(null); // remove stale, actionable rows immediately
  if (q.length < 2) return;
  searchTimer = window.setTimeout(() => {
    searchTimer = undefined;
    void M.search(q).then((res) => {
      const current = currentSearchQuery();
      if (seq === searchSeq && current === q && res.query === q.toLowerCase()) renderSearchResults(res);
    }).catch((error: unknown) => {
      if (seq !== searchSeq) return;
      const box = $('searchResults');
      searchItems = [];
      searchSel = 0;
      box.innerHTML = '';
      const message = el('div', 'sr-hint');
      message.textContent = 'Search failed: ' + String((error as Error)?.message || error);
      box.appendChild(message);
    });
  }, 120);
});
$('searchInput').addEventListener('keydown', (e) => {
  const ke = e as KeyboardEvent;
  if (ke.key === 'ArrowDown') { ke.preventDefault(); if (searchItems.length) searchSel = Math.min(searchSel + 1, searchItems.length - 1); updateSearchSel(); }
  else if (ke.key === 'ArrowUp') { ke.preventDefault(); if (searchItems.length) searchSel = Math.max(searchSel - 1, 0); updateSearchSel(); }
  else if (ke.key === 'Enter') { ke.preventDefault(); activateSearchItem(searchSel); }
  else if (ke.key === 'Escape') { ke.stopPropagation(); closeSearch(); }
});

// ============================================================ MISC
// back/forward keyboard shortcuts for the right panel
window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (e.key === 'k' || e.key === 'K') {
    e.preventDefault();
    if ($('searchOverlay').style.display === 'grid') closeSearch(); else openSearch();
    return;
  }
  if (e.key === '[') { e.preventDefault(); goBack(); }
  else if (e.key === ']') { e.preventDefault(); goForward(); }
});

// Links live in the privileged renderer. Internal wikilinks stay in-app; ordinary
// HTTP(S) links are delegated to the system browser; every other scheme is blocked.
document.addEventListener('click', (e) => {
  const target = e.target as Element | null;
  const wikilink = target?.closest?.('a.wikilink[data-rel]');
  if (wikilink) {
    e.preventDefault();
    const rel = wikilink.getAttribute('data-rel');
    if (rel) openNote(rel, wikilink.textContent || undefined);
    return;
  }
  const link = target?.closest?.('a[href]');
  if (!link) return;
  e.preventDefault();
  const href = link.getAttribute('href') || '';
  if (/^https?:\/\//i.test(href)) M.openExternal(href);
});

$('themeToggle').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
};
function flash(msg: string): void { const s = document.getElementById('statusLine'); if (s) s.textContent = msg; }
function fmtSize(b: number): string { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }
function fmtTime(ms: number): string { const d = new Date(ms); const diff = (Date.now() - ms) / 1000; if (diff < 60) return 'just now'; if (diff < 3600) return Math.floor(diff / 60) + 'm ago'; if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'; return d.toLocaleDateString(); }

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
