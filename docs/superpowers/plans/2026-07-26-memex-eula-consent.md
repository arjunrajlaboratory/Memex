# Memex Terms-Acceptance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate Memex Desktop behind a blocking Terms of Use / Privacy Notice acceptance screen on first launch and whenever the terms version changes, enforced in the main process.

**Architecture:** The legal documents ship as markdown in `app/legal/`, copied into `dist/legal/` at build time and rendered to HTML in the main process. A pure, electron-free module (`src/main/legal.ts`) owns the accept/deny decision and fails closed. The main process refuses `vault:open` and `vault:create` while terms are unaccepted, so the overlay is the way to *satisfy* the check rather than the check itself. The overlay (`src/renderer/legal-gate.ts`) is a self-contained IIFE that also owns the vault-switcher link which reopens it read-only, so `renderer.ts` needs no knowledge of it.

**Tech Stack:** TypeScript (strict) compiled by `tsc` only — no bundler. Electron 43 main/preload/renderer split. `marked` for markdown (already a dependency). Tests are `node:test` in CommonJS (`.cjs`) run against compiled `dist/`.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-07-26-memex-eula-consent-design.md`. Read it before starting.
- **No new dependencies.** Everything needed is already in `app/package.json`.
- **The renderer is not a module.** `src/renderer/*.ts` and `src/shared/*.ts` compile as plain scripts (`moduleDetection: "legacy"`), loaded with bare `<script>` tags. No `import`/`export` in renderer files. All top-level names in those files share one global scope — wrap new renderer code in an IIFE to avoid collisions with `renderer.ts`.
- **Shared types are ambient.** Add renderer-visible types to `src/shared/types.d.ts`, which has no imports/exports on purpose.
- **`src/main/legal.ts` must not import electron.** Like `grants.ts` and `security.ts`, it takes paths and values as parameters. This is what makes it unit-testable.
- **Fail closed.** A missing, unreadable, or unparseable manifest, or an acceptance record of the wrong shape, must show the gate. Re-reading terms is a nuisance; shipping an ungated build is not.
- **Build scripts must be Windows-safe.** `scripts/copy-assets.js` exists because `mkdir -p && cp` broke the Windows build. Use `fs` calls only.
- **Do not add any instruction telling users to `mkdir` a vault folder.** `tools/memex_init.py:318` already does `target.mkdir(parents=True, exist_ok=True)` and `main.ts:42` expands `~`. See Task 5.
- **Copy strings are exact.** Where this plan gives user-facing text, use it verbatim.
- **Terms version is independent of app version.** `app/legal/manifest.json` carries `version`; bump it only for substantive changes.

---

### Task 1: Bundle the legal documents into the build

The documents already exist and are committed (`app/legal/terms.md`, `app/legal/privacy.md`, `app/legal/manifest.json`). They are not yet copied into `dist/`, so the main process cannot read them at runtime.

**Files:**
- Modify: `app/scripts/copy-assets.js`
- Test: `app/test/legal.test.cjs` (created here, extended in Task 2)

**Interfaces:**
- Consumes: nothing.
- Produces: `dist/legal/manifest.json`, `dist/legal/terms.md`, `dist/legal/privacy.md` — the directory `src/main/legal.ts` reads in Task 2.

- [ ] **Step 1: Write the failing test**

Create `app/test/legal.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LEGAL_DIST = path.join(__dirname, '..', 'dist', 'legal');

test('the build bundles the legal documents into dist/legal', () => {
  for (const file of ['manifest.json', 'terms.md', 'privacy.md']) {
    assert.ok(fs.existsSync(path.join(LEGAL_DIST, file)), `dist/legal/${file} must exist after a build`);
  }
});

test('the bundled manifest declares a version and effective date', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(LEGAL_DIST, 'manifest.json'), 'utf8'));
  assert.match(manifest.version, /^\d+\.\d+$/);
  assert.match(manifest.effective, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof manifest.summary, 'string');
});

test('the bundled documents are the real ones, not placeholders', () => {
  const terms = fs.readFileSync(path.join(LEGAL_DIST, 'terms.md'), 'utf8');
  const privacy = fs.readFileSync(path.join(LEGAL_DIST, 'privacy.md'), 'utf8');
  assert.match(terms, /# Memex Desktop Terms of Use/);
  assert.match(privacy, /# Memex Desktop Privacy Notice/);
  // The Anthropic data-flow disclosure is the reason this gate exists.
  assert.match(terms, /Anthropic/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npm run build && node --test test/legal.test.cjs`

Expected: FAIL — `dist/legal/manifest.json must exist after a build`.

- [ ] **Step 3: Copy the documents in the assets script**

In `app/scripts/copy-assets.js`, append after the existing renderer copy loop:

```js
// The terms/privacy documents are read at runtime by src/main/legal.ts and shown in
// the acceptance gate, so they have to land in dist/ like any other static asset.
const legalSrc = path.join(__dirname, '..', 'legal');
const legalDest = path.join(__dirname, '..', 'dist', 'legal');

fs.mkdirSync(legalDest, { recursive: true });
for (const file of ['manifest.json', 'terms.md', 'privacy.md']) {
  fs.copyFileSync(path.join(legalSrc, file), path.join(legalDest, file));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npm run build && node --test test/legal.test.cjs`

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/scripts/copy-assets.js app/test/legal.test.cjs
git commit -m "build: bundle the legal documents into dist/legal"
```

---

### Task 2: The acceptance-decision module

**Files:**
- Create: `app/src/main/legal.ts`
- Test: `app/test/legal.test.cjs` (extend)

**Interfaces:**
- Consumes: `dist/legal/` from Task 1.
- Produces, all imported by `main.ts` in Task 3:
  - `interface LegalManifest { version: string; effective: string; summary: string }`
  - `interface LegalDocs { manifest: LegalManifest; terms: string; privacy: string }`
  - `interface TermsAcceptance { version: string; acceptedAt: string; appVersion: string }`
  - `loadLegal(dir: string): LegalDocs | null`
  - `needsAcceptance(accepted: unknown, manifest: LegalManifest | null): boolean`
  - `acceptanceRecord(manifest: LegalManifest, appVersion: string, now: Date): TermsAcceptance`

> Naming note: the spec sketched this as `recordAcceptance(cfg, manifest)`. It is split
> here into a pure `acceptanceRecord(…)` that builds the record and a config write that
> stays in `main.ts`, which keeps `legal.ts` free of both `Date.now()` and config I/O and
> so keeps it directly testable. Same behavior, better seam.

- [ ] **Step 1: Write the failing tests**

Append to `app/test/legal.test.cjs`:

```js
const os = require('node:os');
const { loadLegal, needsAcceptance, acceptanceRecord } = require('../dist/main/legal.js');

const MANIFEST = { version: '1.0', effective: '2026-07-26', summary: '' };

function tempLegalDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-legal-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test('loadLegal reads the manifest and both documents', () => {
  const dir = tempLegalDir({
    'manifest.json': JSON.stringify({ version: '2.5', effective: '2027-01-01', summary: 'Clarified §4.' }),
    'terms.md': '# Terms\nbody',
    'privacy.md': '# Privacy\nbody',
  });
  const docs = loadLegal(dir);
  assert.deepEqual(docs.manifest, { version: '2.5', effective: '2027-01-01', summary: 'Clarified §4.' });
  assert.match(docs.terms, /# Terms/);
  assert.match(docs.privacy, /# Privacy/);
});

test('loadLegal reads the real bundled documents', () => {
  const docs = loadLegal(LEGAL_DIST);
  assert.ok(docs);
  assert.match(docs.terms, /Memex Desktop Terms of Use/);
});

test('loadLegal returns null when anything is missing or unusable', () => {
  assert.equal(loadLegal(path.join(os.tmpdir(), 'memex-legal-does-not-exist')), null);
  assert.equal(loadLegal(tempLegalDir({ 'manifest.json': '{ not json' })), null);
  assert.equal(loadLegal(tempLegalDir({
    'manifest.json': JSON.stringify({ version: '1.0' }),
  })), null, 'a manifest without documents is unusable');
  assert.equal(loadLegal(tempLegalDir({
    'manifest.json': JSON.stringify({ effective: '2026-07-26' }),
    'terms.md': 'x', 'privacy.md': 'x',
  })), null, 'a manifest without a version is unusable');
  assert.equal(loadLegal(tempLegalDir({
    'manifest.json': JSON.stringify({ version: '1.0' }),
    'terms.md': '   ', 'privacy.md': 'x',
  })), null, 'an empty document is unusable');
});

test('needsAcceptance is true on a first run', () => {
  assert.equal(needsAcceptance(undefined, MANIFEST), true);
});

test('needsAcceptance is false once the current version is accepted', () => {
  assert.equal(needsAcceptance({ version: '1.0', acceptedAt: 'x', appVersion: '0.1.4' }, MANIFEST), false);
});

test('needsAcceptance is true when the terms version changed', () => {
  assert.equal(needsAcceptance({ version: '1.0', acceptedAt: 'x', appVersion: '0.1.4' }, { ...MANIFEST, version: '1.1' }), true);
  // Plain inequality, not a semver comparison: a rollback re-prompts too.
  assert.equal(needsAcceptance({ version: '2.0', acceptedAt: 'x', appVersion: '0.9.0' }, MANIFEST), true);
});

test('needsAcceptance fails closed on a malformed record or missing manifest', () => {
  assert.equal(needsAcceptance(null, MANIFEST), true);
  assert.equal(needsAcceptance('1.0', MANIFEST), true);
  assert.equal(needsAcceptance({}, MANIFEST), true);
  assert.equal(needsAcceptance({ version: 42 }, MANIFEST), true);
  assert.equal(needsAcceptance({ version: '  ' }, MANIFEST), true);
  assert.equal(needsAcceptance({ version: '1.0' }, null), true, 'no manifest means show the gate');
  assert.equal(needsAcceptance({ version: '1.0' }, { version: '', effective: '', summary: '' }), true);
});

test('acceptanceRecord stamps the version, time, and app version', () => {
  const rec = acceptanceRecord(MANIFEST, '0.1.4', new Date('2026-07-26T12:00:00.000Z'));
  assert.deepEqual(rec, { version: '1.0', acceptedAt: '2026-07-26T12:00:00.000Z', appVersion: '0.1.4' });
  assert.equal(needsAcceptance(rec, MANIFEST), false, 'a fresh record satisfies the gate');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npm run build && node --test test/legal.test.cjs`

Expected: FAIL — `Cannot find module '../dist/main/legal.js'`.

- [ ] **Step 3: Write the implementation**

Create `app/src/main/legal.ts`:

```ts
// Terms-acceptance decision logic. Deliberately free of electron imports so the
// whole decision surface is unit-testable: main.ts asks this module, and the gate
// overlay in the renderer is only how the user satisfies the answer.
import * as fs from 'fs';
import * as path from 'path';

export interface LegalManifest { version: string; effective: string; summary: string; }
export interface LegalDocs { manifest: LegalManifest; terms: string; privacy: string; }
export interface TermsAcceptance { version: string; acceptedAt: string; appVersion: string; }

/** Reads a bundled legal directory. Returns null if anything is missing or unusable. */
export function loadLegal(dir: string): LegalDocs | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Partial<LegalManifest>;
    const version = typeof raw.version === 'string' ? raw.version.trim() : '';
    if (!version) return null;
    const terms = fs.readFileSync(path.join(dir, 'terms.md'), 'utf8');
    const privacy = fs.readFileSync(path.join(dir, 'privacy.md'), 'utf8');
    if (!terms.trim() || !privacy.trim()) return null;
    return {
      manifest: {
        version,
        effective: typeof raw.effective === 'string' ? raw.effective : '',
        summary: typeof raw.summary === 'string' ? raw.summary : '',
      },
      terms,
      privacy,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Fails closed. A missing manifest, an unreadable document, or a record of the
 * wrong shape all mean "show the gate": re-reading the terms is a nuisance,
 * shipping a build that never shows them is not.
 *
 * Plain inequality rather than a semver comparison, so any declared-version
 * change re-prompts — including a rollback.
 */
export function needsAcceptance(accepted: unknown, manifest: LegalManifest | null): boolean {
  if (!manifest || !manifest.version) return true;
  if (!accepted || typeof accepted !== 'object') return true;
  const version = (accepted as { version?: unknown }).version;
  if (typeof version !== 'string' || !version.trim()) return true;
  return version !== manifest.version;
}

export function acceptanceRecord(manifest: LegalManifest, appVersion: string, now: Date): TermsAcceptance {
  return { version: manifest.version, acceptedAt: now.toISOString(), appVersion: String(appVersion || '') };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm run build && node --test test/legal.test.cjs`

Expected: PASS — 11 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `cd app && npm test && npm run typecheck`

Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/main/legal.ts app/test/legal.test.cjs
git commit -m "feat: add the terms-acceptance decision module"
```

---

### Task 3: Main-process enforcement and IPC

**Files:**
- Modify: `app/src/main/main.ts` (imports near line 27; `PersistedConfig` line 38; `mdRenderer` line 56; `renderMarkdown` lines 160-169; IPC block from line 688; `vault:create` lines 742-745; `vault:open` lines 747-749)
- Modify: `app/src/shared/types.d.ts` (add `LegalState`, extend `MemexApi`)
- Modify: `app/src/preload/preload.ts` (three bridge methods)

**Interfaces:**
- Consumes: `loadLegal`, `needsAcceptance`, `acceptanceRecord`, `TermsAcceptance` from Task 2.
- Produces, all used by Task 4:
  - `interface LegalState { needsAcceptance: boolean; version: string; effective: string; summary: string; terms: string; privacy: string }` — `terms` and `privacy` are **rendered HTML**, not markdown.
  - `window.memex.legalState(): Promise<LegalState>`
  - `window.memex.legalAccept(): Promise<{ ok: boolean }>`
  - `window.memex.legalQuit(): Promise<void>`

- [ ] **Step 1: Add the shared types**

In `app/src/shared/types.d.ts`, add after the `CreateVaultResult` line (~line 134):

```ts
// Terms/privacy state for the acceptance gate. `terms` and `privacy` are HTML
// rendered by the main process, not markdown.
interface LegalState {
  needsAcceptance: boolean;
  version: string;
  effective: string;
  summary: string;
  terms: string;
  privacy: string;
}
```

And in `interface MemexApi`, after `appVersion(): Promise<string>;`:

```ts
  legalState(): Promise<LegalState>;
  legalAccept(): Promise<{ ok: boolean }>;
  legalQuit(): Promise<void>;
```

- [ ] **Step 2: Add the preload bridge methods**

In `app/src/preload/preload.ts`, after the `appVersion` line in the `// vault lifecycle` group:

```ts
  legalState: () => invoke('legal:state'),
  legalAccept: () => invoke('legal:accept'),
  legalQuit: () => invoke('app:quit'),
```

- [ ] **Step 3: Wire the module into main.ts**

Add to the import block after line 27 (`import { unpackedClaudeBinaryPath } from './claude-binary';`):

```ts
import { acceptanceRecord, loadLegal, needsAcceptance, type LegalDocs, type TermsAcceptance } from './legal';
```

Add after the `RENDERER_PATH` / `CONFIG_PATH` constants (line 36):

```ts
const LEGAL_DIR = path.join(__dirname, '..', 'legal');
```

Change `PersistedConfig` (line 38) to carry the acceptance record:

```ts
interface PersistedConfig extends ToolGrantState { recent?: string[]; last?: string; terms?: TermsAcceptance; }
```

Add after `let mdRenderer: ((md: string) => string) | null = null;` (line 56):

```ts
// `undefined` = not yet read, `null` = read and unusable. Cached because the
// documents cannot change without a new build.
let legalDocs: LegalDocs | null | undefined;
function legal(): LegalDocs | null {
  if (legalDocs === undefined) legalDocs = loadLegal(LEGAL_DIR);
  return legalDocs;
}
// The gate is enforced here, not in the renderer: MEMEX_OPEN and any UI bug
// would otherwise sail straight past a purely visual overlay.
function termsAccepted(): boolean {
  return !needsAcceptance(loadConfig().terms, legal()?.manifest || null);
}
```

- [ ] **Step 4: Split the markdown renderer so legal text skips the wikilink pass**

Replace `renderMarkdown` (lines 160-169) with:

```ts
async function ensureMarkdownRenderer(): Promise<(md: string) => string> {
  if (!mdRenderer) {
    const { marked, Renderer } = await import('marked');
    const renderer = new Renderer();
    hardenMarkdownRenderer(renderer);
    marked.setOptions({ breaks: true, gfm: true, renderer });
    mdRenderer = (s: string) => marked.parse(s) as string;
  }
  return mdRenderer;
}

async function renderMarkdown(md: string): Promise<string> {
  const render = await ensureMarkdownRenderer();
  return render(await linkifyWikilinks(md || ''));
}

// Legal documents contain no wikilinks and are shown before any vault is open,
// so they skip the vault-scoped wikilink pass entirely.
async function renderPlainMarkdown(md: string): Promise<string> {
  const render = await ensureMarkdownRenderer();
  return render(md || '');
}
```

- [ ] **Step 5: Add the IPC handlers**

Inside `registerIpc()`, after the `handle('vault:pick', …)` block (line 700):

```ts
  handle('legal:state', async (): Promise<LegalState> => {
    const docs = legal();
    if (!docs) {
      // Fail closed and say so, rather than silently letting the user through.
      return {
        needsAcceptance: true, version: '', effective: '', summary: '',
        terms: '<p>The Terms of Use could not be loaded, so Memex cannot continue. Please reinstall the app.</p>',
        privacy: '<p>The Privacy Notice could not be loaded, so Memex cannot continue. Please reinstall the app.</p>',
      };
    }
    const cfg = loadConfig();
    return {
      needsAcceptance: needsAcceptance(cfg.terms, docs.manifest),
      version: docs.manifest.version,
      effective: docs.manifest.effective,
      // "What changed" is meaningless on a first run — only show it to someone
      // who accepted an earlier version.
      summary: cfg.terms ? docs.manifest.summary : '',
      terms: await renderPlainMarkdown(docs.terms),
      privacy: await renderPlainMarkdown(docs.privacy),
    };
  });

  handle('legal:accept', async () => {
    const docs = legal();
    if (!docs) return { ok: false };
    const cfg = loadConfig();
    cfg.terms = acceptanceRecord(docs.manifest, app.getVersion(), new Date());
    saveConfig(cfg);
    return { ok: true };
  });

  handle('app:quit', async () => { app.quit(); });
```

- [ ] **Step 6: Refuse to open or create a vault while terms are unaccepted**

Replace the `vault:create` handler (lines 742-745):

```ts
  handle('vault:create', async (_e, opts: { target: string; answers: Record<string, string>; packs: string }) => {
    if (!termsAccepted()) return { ok: false, code: -1, output: 'Please accept the Terms of Use to continue.' };
    const res = await createVault({ ...opts, target: expandHome(opts.target) });
    return res;
  });
```

In the `vault:open` handler, add as the first line of the body (before `const full = expandHome(p);` at line 748):

```ts
    if (!termsAccepted()) return { ok: false, error: 'Please accept the Terms of Use to continue' };
```

- [ ] **Step 7: Verify it compiles and nothing regressed**

Run: `cd app && npm run typecheck && npm test`

Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add app/src/main/main.ts app/src/shared/types.d.ts app/src/preload/preload.ts
git commit -m "feat: enforce terms acceptance in the main process"
```

---

### Task 4: The acceptance gate overlay

**Files:**
- Create: `app/src/renderer/legal-gate.ts`
- Modify: `app/src/renderer/index.html` (gate markup after the `.onboard` block ending line 182; review link inside `.onboard-inner`; script tag)
- Modify: `app/src/renderer/styles.css` (append a gate section)

**Interfaces:**
- Consumes: `window.memex.legalState()`, `legalAccept()`, `legalQuit()`, and the `LegalState` type from Task 3.
- Produces: nothing consumed by later tasks. The overlay is self-contained — it owns its DOM, its wiring, and the `#legalReview` link. `renderer.ts` is not modified in this task.

- [ ] **Step 1: Add the gate markup**

In `app/src/renderer/index.html`, insert the review link inside `.onboard-inner`, immediately after the `#resetApprovals` button (line 179):

```html
      <button class="legal-link" id="legalReview" type="button">Terms of Use · Privacy</button>
```

Then insert this block after the closing `</div>` of the `.onboard` overlay (after line 182, before the `<script>` tags):

```html
  <!-- ======================= TERMS GATE ======================= -->
  <div class="legal" id="legalGate" style="display:none">
    <div class="legal-inner">
      <div class="legal-head">
        <div class="wordmark big"><span class="mark">Memex</span></div>
        <h2 class="legal-title">Before you start</h2>
        <p class="legal-eff" id="legalEffective"></p>
        <p class="legal-changed" id="legalChanged" style="display:none"></p>
      </div>

      <div class="legal-tabs">
        <button class="legal-tab active" id="legalTabTerms" type="button">Terms of Use</button>
        <button class="legal-tab" id="legalTabPrivacy" type="button">Privacy Notice</button>
      </div>

      <div class="legal-doc" id="legalDoc"></div>

      <p class="legal-online">
        Also published at
        <a href="https://cytopixel.com/terms-of-service/">cytopixel.com/terms-of-service</a> and
        <a href="https://cytopixel.com/privacy-policy/">cytopixel.com/privacy-policy</a>.
      </p>

      <div class="legal-foot">
        <div id="legalConsent">
          <label class="legal-agree">
            <input type="checkbox" id="legalAgree" />
            <span>I have read and agree to the Memex Terms of Use and Privacy Notice.</span>
          </label>
          <div class="legal-actions">
            <button class="btn ghost" id="legalDecline" type="button">Decline and quit</button>
            <button class="btn primary" id="legalAcceptBtn" type="button" disabled>Agree and continue</button>
          </div>
        </div>
        <button class="btn ghost legal-close" id="legalClose" type="button" style="display:none">Close</button>
      </div>
    </div>
  </div>
```

Add the script tag as the **last** script, after `renderer.js` (line 186):

```html
  <script src="legal-gate.js"></script>
```

- [ ] **Step 2: Add the styles**

Append to `app/src/renderer/styles.css`:

```css
/* ======================= TERMS GATE ======================= */
/* Above .onboard (z-index 20): the gate must cover the vault switcher too. */
.legal { position: fixed; inset: 0; z-index: 40; background: radial-gradient(ellipse at 30% 0%, var(--bg-2), var(--bg)); display: grid; place-items: center; overflow: auto; }
.legal-inner { width: min(760px, 92vw); padding: 34px 0; }
.legal-head { text-align: center; margin-bottom: 20px; }
.legal-title { font-family: var(--font-display); font-size: 24px; font-weight: 600; color: var(--ink); margin: 14px 0 6px; }
.legal-eff { font-size: 12px; color: var(--ink-faint); margin: 0; }
.legal-changed { font-size: 13px; line-height: 1.6; color: var(--ink-dim); max-width: 520px; margin: 12px auto 0; }
.legal-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.legal-tab { padding: 7px 14px; border: 1px solid var(--line); border-radius: 20px; background: transparent; color: var(--ink-dim); font: 12.5px var(--font-ui); cursor: pointer; }
.legal-tab.active { border-color: var(--accent); background: var(--accent-soft); color: var(--ink); }
.legal-doc {
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  padding: 20px 26px; max-height: 46vh; overflow: auto;
  font-size: 13px; line-height: 1.7; color: var(--ink-dim);
}
.legal-doc h1 { font-family: var(--font-display); font-size: 20px; color: var(--ink); margin: 0 0 10px; }
.legal-doc h2 { font-size: 14px; color: var(--ink); margin: 22px 0 8px; }
.legal-doc h3 { font-size: 13px; color: var(--ink); margin: 16px 0 6px; }
.legal-doc p, .legal-doc li { margin: 8px 0; }
.legal-doc ul, .legal-doc ol { padding-left: 22px; }
.legal-doc strong { color: var(--ink); }
.legal-doc a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.legal-doc hr { border: none; border-top: 1px solid var(--line); margin: 20px 0; }
/* Plain <a href>: renderer.ts's document-level click handler already delegates
   http(s) links to the system browser, so these need no wiring of their own. */
.legal-online { font-size: 11.5px; color: var(--ink-faint); margin: 10px 0 0; text-align: center; }
.legal-online a { color: var(--ink-dim); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.legal-foot { margin-top: 18px; }
.legal-agree { display: flex; align-items: flex-start; gap: 9px; font-size: 13px; line-height: 1.5; color: var(--ink-dim); cursor: pointer; }
.legal-agree input { margin-top: 2px; }
.legal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.legal-close { display: block; margin: 0 auto; }
.legal-link { display: block; margin: 9px auto 0; padding: 2px 4px; border: 0; background: transparent; color: var(--ink-faint); font: 11px var(--font-ui); text-decoration: underline; cursor: pointer; }
.legal-link:hover { color: var(--ink-dim); }
```

- [ ] **Step 3: Write the gate script**

Create `app/src/renderer/legal-gate.ts`:

```ts
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
```

- [ ] **Step 4: Verify it compiles**

Run: `cd app && npm run typecheck && npm run build`

Expected: no errors, and `dist/renderer/legal-gate.js` exists.

- [ ] **Step 5: Drive the gate in the real app**

Capture the userData directory rather than guessing it — it differs between dev and
packaged builds (dev uses the `name` from `package.json`, a packaged build uses the
`build.productName`):

```bash
cd app
CFG="$(npx electron -e "const {app}=require('electron');app.whenReady().then(()=>{console.log(app.getPath('userData'));app.quit()})" | tail -1)/config.json"
echo "$CFG"
```

Move the config aside to simulate a first run, then launch:

```bash
[ -f "$CFG" ] && mv "$CFG" "$CFG.bak"
npm start
```

Confirm by observation:
1. The gate appears over the vault switcher on launch.
2. "Agree and continue" is disabled until the checkbox is ticked.
3. The Privacy Notice tab switches documents; an Anthropic link opens in the system browser.
4. Accepting dismisses the gate and reveals the vault switcher.
5. Relaunching (`npm start`) shows no gate.
6. `grep terms "<userData>/config.json"` shows the recorded version, timestamp, and app version.
7. The "Terms of Use · Privacy" link in the switcher footer reopens the overlay with a Close button and no checkbox.

Then restore your config: `mv "$CFG.bak" "$CFG"` (if you moved one aside).

- [ ] **Step 6: Commit**

```bash
git add app/src/renderer/legal-gate.ts app/src/renderer/index.html app/src/renderer/styles.css
git commit -m "feat: add the terms acceptance gate overlay"
```

---

### Task 5: Folder-creation clarity and publisher email

Part C of the spec. A user was told to `mkdir` their vault folder in Terminal before starting. That step is not required — `tools/memex_init.py:318` mkdirs parents and `main.ts:42` expands `~`. The fix is copy that says so. **Do not add the mkdir instruction.**

**Files:**
- Modify: `app/src/renderer/index.html` (Location field, lines 160-165)
- Modify: `app/src/renderer/styles.css` (one rule)
- Modify: `app/src/renderer/renderer.ts:84` (flash copy)
- Modify: `app/package.json` (author email)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add the hint under the Location field**

In `app/src/renderer/index.html`, replace the Location label (lines 160-165) with:

```html
            <label>Location
              <div class="path-row">
                <input id="f_path" placeholder="~/code/my-vault" required />
                <button type="button" class="btn tiny" id="pickPath">…</button>
              </div>
              <span class="field-hint">Doesn't exist yet? Memex creates it for you, including parent folders.</span>
            </label>
```

- [ ] **Step 2: Style the hint**

Append to `app/src/renderer/styles.css`:

```css
.field-hint { font-size: 11.5px; line-height: 1.5; color: var(--ink-faint); }
```

- [ ] **Step 3: Reword the non-vault flash**

In `app/src/renderer/renderer.ts`, replace line 84:

```ts
  else { ($('f_path') as HTMLInputElement).value = p; flash('That folder isn\'t a Memex vault yet. The form on the right can set one up there, or pick another folder.'); }
```

- [ ] **Step 4: Update the publisher email**

In `app/package.json`, change the author email:

```json
  "author": {
    "name": "Arjun Raj",
    "email": "araj@cytopixel.com"
  },
```

Leave `"license": "MIT"` and the author name unchanged — see the spec's "License choice: MIT retained".

- [ ] **Step 5: Verify the behavior the new copy promises**

Run: `cd app && npm run build && npm start`

In the create form, enter a Location whose parent does not exist (for example `~/memex-parent-check/v1`), fill name and email, and click Create vault. Confirm it succeeds with no prior `mkdir`, then clean up:

```bash
rm -rf ~/memex-parent-check
```

- [ ] **Step 6: Commit**

```bash
git add app/src/renderer/index.html app/src/renderer/styles.css app/src/renderer/renderer.ts app/package.json
git commit -m "fix: say that Memex creates the vault folder; update publisher email"
```

---

### Task 6: Full verification, including a packaged build

`app/README.md` and `docs/RELEASING.md` are emphatic that `npm start` does not exercise packaged asset paths, and this change adds new bundled files that must land correctly in the built app. This has bitten the project three times.

**Files:** none modified — this task is verification, plus a `docs/RELEASING.md` note.

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: a verified build.

- [ ] **Step 1: Full local suite**

Run: `cd app && npm test && npm run typecheck`

Expected: all tests pass, no type errors.

- [ ] **Step 2: Verify re-consent on a version bump**

Bump the terms version and add a summary:

```bash
cd app && node -e "
const fs=require('fs'),p='legal/manifest.json';
const m=JSON.parse(fs.readFileSync(p,'utf8'));
fs.writeFileSync(p,JSON.stringify({...m,version:'1.1',summary:'Test bump — clarified the Anthropic disclosure.'},null,2)+'\n');
"
npm start
```

Confirm the gate reappears for an already-accepted user, and that "What changed: Test bump — clarified the Anthropic disclosure." shows above the documents.

Then revert the bump:

```bash
cd app && git checkout legal/manifest.json
```

- [ ] **Step 3: Verify decline quits**

Move the config aside as in Task 4 Step 5, run `npm start`, and click "Decline and quit". Confirm the app exits and that no `terms` key was written to `config.json`. Restore the config.

- [ ] **Step 4: Verify the packaged build**

```bash
cd app && npm run pack
```

Then confirm the documents are inside the bundle:

```bash
npx asar list "release/mac-arm64/Memex.app/Contents/Resources/app.asar" | grep legal
```

Expected: `/dist/legal/manifest.json`, `/dist/legal/terms.md`, `/dist/legal/privacy.md`.

(Adjust the path for your platform's output directory. On a first packaged run the userData directory differs from dev, so the gate should appear even if you already accepted in dev — that is correct behavior and confirms the record is per-install-target.)

Launch the packaged app and confirm the gate renders with real document text, not the "could not be loaded" fallback. That fallback appearing in a packaged build but not in dev is exactly the class of failure this step exists to catch.

- [ ] **Step 5: Note the two-repo sync requirement**

Add to `docs/RELEASING.md`, in the release checklist:

```markdown
- **Legal documents:** if `app/legal/terms.md` or `app/legal/privacy.md` changed, bump
  `version` and set `summary` in `app/legal/manifest.json` (this triggers the in-app
  re-consent gate), and transcribe the same text into the matching per-product sections
  on cytopixel.com. `version` and `effective` are the tell if the two drift.
```

- [ ] **Step 6: Commit**

```bash
git add docs/RELEASING.md
git commit -m "docs: note the legal-document release checklist"
```

---

## Second deliverable: the website sections

Tracked separately because it lives in another repository (`../cytopixel_website`, `github.com/CytoPixel/cytopixel_website`), and it is publication rather than code.

- [ ] Transcribe `app/legal/terms.md` into a new per-product section of `terms-of-service/index.html`, alongside the existing "CytoPixel NimbusImage Terms of Service" section, matching that page's existing markup and `.legal-*` classes.
- [ ] Transcribe `app/legal/privacy.md` into `privacy-policy/index.html` the same way.
- [ ] Keep the version and effective date identical to `app/legal/manifest.json`.
- [ ] Open as a separate pull request in that repository.

**Do not publish before counsel review.** The spec's "Remaining open item" flags two clauses specifically: the MIT carve-out in Terms §2, and the HIPAA framing in §7(a).
