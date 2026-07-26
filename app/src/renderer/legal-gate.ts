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
    // Keep focus and screen readers inside the gate while it is up.
    id('workspace').inert = true;
    id('onboard').inert = true;
    (mode === 'gate' ? agree : closeBtn).focus();
  };

  const close = (): void => {
    gate.style.display = 'none';
    id('workspace').inert = false;
    id('onboard').inert = false;
  };

  tabTerms.onclick = () => showDoc('terms');
  tabPrivacy.onclick = () => showDoc('privacy');
  agree.onchange = () => { acceptBtn.disabled = !agree.checked; };

  acceptBtn.onclick = async () => {
    acceptBtn.disabled = true;
    const res = await api.legalAccept();
    if (res.ok) { close(); return; }
    // Recording failed, which means the documents are unreadable. Do not let the
    // user through — the main process would refuse to open a vault anyway — and
    // say why instead of leaving a dead button.
    agree.checked = false;
    const changed = id('legalChanged');
    changed.textContent = 'Memex could not record your acceptance. Please reinstall the app.';
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
