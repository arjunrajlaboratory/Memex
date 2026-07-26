// The terms-acceptance gate. Compiled as a plain (non-module) script like
// renderer.ts, so everything lives inside one IIFE: top-level names in these
// files share a single global scope, and `$`/`el`/`M` are already taken.
//
// Self-contained on purpose — it owns its markup, its wiring, and the
// vault-switcher link that reopens it read-only, so renderer.ts needs to know
// nothing about it. Enforcement is in the main process (vault:open and
// vault:create refuse until terms are accepted); this overlay is only how the
// user satisfies that check.
(() => {
  const api = window.memex;
  const id = (name: string): HTMLElement => document.getElementById(name) as HTMLElement;

  const gate = id('legalGate');
  const docPane = id('legalDoc');
  const agree = id('legalAgree') as HTMLInputElement;
  const acceptBtn = id('legalAcceptBtn') as HTMLButtonElement;
  const closeBtn = id('legalClose') as HTMLButtonElement;
  const tabTerms = id('legalTabTerms');
  const tabPrivacy = id('legalTabPrivacy');

  let rendered = { terms: '', privacy: '' };

  // Everything outside the gate. The title bar is included: it is not part of
  // #workspace, so leaving it live let you switch vaults and toggle the theme
  // from behind a supposedly blocking dialog, and let Tab wrap out of the gate.
  const chrome = (): Element[] => [
    id('workspace'),
    id('onboard'),
    ...Array.from(document.querySelectorAll('.titlebar')),
  ];
  const setChromeInert = (on: boolean): void => {
    for (const el of chrome()) (el as HTMLElement).inert = on;
  };

  const isOpen = (): boolean => gate.style.display !== 'none';

  // renderer.ts binds Cmd/Ctrl-K (search), Cmd/Ctrl-[ and -] (history), and
  // Escape (close the vault switcher) on window in the bubble phase. Search in
  // particular would open its own overlay and pull focus out of the gate. A
  // capture-phase listener runs before those, so the gate can swallow exactly
  // those chords while it is up — and nothing else, so Tab still moves within
  // the gate and Cmd-C still copies the terms.
  window.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    const chord = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
      && (e.key === 'k' || e.key === 'K' || e.key === '[' || e.key === ']');
    if (chord || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // The documents are HTML rendered by the main process through the hardened
  // marked renderer, which strips raw HTML and admits only vetted links.
  const showDoc = (which: 'terms' | 'privacy'): void => {
    docPane.innerHTML = which === 'terms' ? rendered.terms : rendered.privacy;
    docPane.scrollTop = 0;
    tabTerms.classList.toggle('active', which === 'terms');
    tabPrivacy.classList.toggle('active', which === 'privacy');
  };

  const open = (mode: 'gate' | 'review', state: LegalState): void => {
    rendered = { terms: state.terms, privacy: state.privacy };
    id('legalEffective').textContent = state.version
      ? `Version ${state.version}${state.effective ? ` · effective ${state.effective}` : ''}`
      : '';

    // "What changed" only helps someone who accepted an earlier version; the
    // main process leaves `summary` empty on a first run.
    const changed = id('legalChanged');
    const showChanged = mode === 'gate' && !!state.summary;
    changed.textContent = showChanged ? `What changed: ${state.summary}` : '';
    changed.style.display = showChanged ? '' : 'none';

    agree.checked = false;
    acceptBtn.disabled = true;
    id('legalConsent').style.display = mode === 'gate' ? '' : 'none';
    closeBtn.style.display = mode === 'gate' ? 'none' : '';

    showDoc('terms');
    gate.style.display = 'grid';
    setChromeInert(true);
    (mode === 'gate' ? agree : closeBtn).focus();
  };

  const close = (): void => {
    gate.style.display = 'none';
    setChromeInert(false);
  };

  tabTerms.onclick = () => showDoc('terms');
  tabPrivacy.onclick = () => showDoc('privacy');
  agree.onchange = () => { acceptBtn.disabled = !agree.checked; };

  acceptBtn.onclick = async () => {
    acceptBtn.disabled = true;
    const res = await api.legalAccept();
    if (res.ok) { close(); return; }
    // The main process confirmed the record did not reach disk, so it will keep
    // refusing to open a vault. Do not close the gate — say why, and leave the
    // checkbox re-tickable so this is retryable once the cause is fixed.
    agree.checked = false;
    const changed = id('legalChanged');
    changed.textContent = 'Memex could not save your acceptance. Check that your disk is not full '
      + 'and that Memex can write to its application-data folder, then try again.';
    changed.style.display = '';
  };

  id('legalDecline').onclick = () => { void api.legalQuit(); };
  closeBtn.onclick = close;
  id('legalReview').onclick = async () => { open('review', await api.legalState()); };

  void (async () => {
    const state = await api.legalState();
    if (state.needsAcceptance) open('gate', state);
  })();
})();
