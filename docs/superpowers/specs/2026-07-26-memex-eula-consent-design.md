# Memex Desktop — terms acceptance (EULA) design

**Date:** 2026-07-26
**Status:** approved design, not yet implemented
**Scope:** two new legal documents published by CytoPixel Software LLC, plus a blocking
in-app acceptance gate in the Memex desktop app.

## Why

Memex is shipping as a general-purpose assistant that reads and writes a folder of the
user's notes and sends their contents to a third-party AI provider. Before launch it needs
a document that (a) discloses that data flow, (b) disclaims warranty and liability, and
(c) prohibits categories of data that must not be handed to a third-party AI provider.
Nothing in the app collects or transmits data to CytoPixel — the point of the document is
disclosure and allocation of risk, not a data-collection notice.

The existing `cytopixel_website` policies do **not** cover this. Both are titled
"CytoPixel NimbusImage Terms of Service / Privacy Policy" and describe a SaaS product with
accounts, server-side image uploads, subscription fees, and AWS hosting. Pointing Memex
users at them would have users agreeing to terms about a product they aren't using. The
terms page is already structured as "Per-product Terms of Service", so Memex slots in as a
sibling section.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Licensor | CytoPixel Software LLC | Same entity and site as NimbusImage; an LLC absorbs liability, an individual doesn't. |
| Where documents live | New per-product sections on cytopixel.com | Canonical public copy; matches the existing per-product structure. |
| In-app text source | Bundled in the build, versioned | Works offline (launch is network-free today), renders instantly, and pins the exact text a user accepted to the version they installed. |
| Gate behavior | Blocking on first launch and on every terms-version bump | Terms carry their own version, bumped only for substantive change, so typo fixes don't re-prompt. One code path. |
| Sensitive-data posture | Hard prohibition on PHI / regulated data / clinical reliance | Chosen deliberately for the strongest shield. |
| Research-use-only clause | **Not** included | NimbusImage's "internal research purposes" restriction would bar someone from tracking personal errands in a personal-notes app. CytoPixel never receives or stores vault data, so the narrow PHI prohibition carries the weight on its own. |
| Governing law | Delaware, exclusive Delaware venue | Mirrors the NimbusImage terms verbatim. |
| Contact | support@cytopixel.com | Same as NimbusImage. |

## Verified facts these documents rest on

Established by reading the code, not assumed:

- **No telemetry of any kind.** The app makes exactly two categories of outbound request:
  `autoUpdater.checkForUpdatesAndNotify()` to GitHub releases (`app/src/main/main.ts:548`),
  and Agent SDK traffic to Anthropic under the user's own credentials. No analytics, no
  crash reporting. "CytoPixel collects nothing" is literally true.
- **Local state** lives in `config.json` under `app.getPath('userData')`
  (`app/src/main/main.ts:36`): recent vault paths, `last`, and per-vault tool grants.
- **The packaged app redistributes proprietary Anthropic software.**
  `@anthropic-ai/claude-agent-sdk` declares `license: "SEE LICENSE IN README.md"`, and its
  `LICENSE.md` reads "© Anthropic PBC. All rights reserved. Use is subject to the Legal
  Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance". The
  platform sibling `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` carries the same
  posture and contains the `claude` executable the app spawns from `app.asar.unpacked`
  (`app/src/main/claude-binary.ts:9`). So `app/package.json`'s `"license": "MIT"` describes
  the source, not the shipped artifact.
- **MIT with an outside contributor.** `LICENSE` is MIT, copyright "Memex Engine
  contributors"; git history shows one commit from `Andrew Su <asu@scripps.edu>`.
- **Anthropic covers PHI only under a BAA with Zero Data Retention enabled**
  (Anthropic legal-and-compliance page), which gives the PHI prohibition a precise reason.

## Open items — launch-gating, not resolved by this design

These are business/legal questions this document cannot settle. They are recorded here so
they don't get lost, and they do not block implementation of the gate.

1. **Redistribution of the bundled Claude CLI.** Anthropic's legal-and-compliance page is
   silent on redistribution, embedding, or bundling; `LICENSE.md` says "All rights
   reserved", so no redistribution right is granted by default. Shipping the `claude`
   binary inside a third-party DMG/installer needs express permission or a different
   packaging approach.
2. **The OAuth credential model.** Anthropic's page states that OAuth auth "is intended
   exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription
   plans and is designed to support ordinary use of Claude Code and other native Anthropic
   applications", that Agent SDK developers "should use API key authentication", and that
   "Anthropic does not permit third-party developers to offer Claude.ai login or to route
   requests through Free, Pro, or Max plan credentials on behalf of their users" —
   reserving enforcement "without prior notice". Memex's documented auth model ("Auth
   comes from your logged-in Claude Code CLI (no API key needed)") is squarely in that
   territory. Arguments that Memex is on the right side: it routes nothing through
   CytoPixel servers, does not implement Claude.ai login itself, and each user's
   credentials are used on their own machine for their own benefit — close to "ordinary,
   individual usage". **Action: raise with Anthropic (sales/support) in parallel with
   launch.** An EULA cannot resolve this; CytoPixel's own terms grant CytoPixel no rights
   against Anthropic.
3. **Counsel review** of both drafted documents before publication.

Decision on record: proceed with the gate as designed, disclose the auth relationship in
the terms, and pursue (1) and (2) with Anthropic in parallel.

## Part A — the documents

Both are new per-product sections on cytopixel.com, licensor CytoPixel Software LLC,
Delaware law, mirroring the NimbusImage structure and tone.

### A1. Memex Desktop Terms of Use

1. **What Memex is.** Software the user installs and runs locally. No hosted service, no
   accounts, no CytoPixel servers. Deliberately *not* the SaaS framing NimbusImage uses.
2. **License grant.** Free, non-exclusive, non-transferable right to install and use the
   packaged application. States explicitly that the source is separately available under
   the MIT License and that these terms govern the *distributed binary* without reducing
   MIT rights in the source.
   **Ownership language must not be copied from NimbusImage.** Its "CytoPixel retains all
   right, title, and interest in and to the Program" is false here (MIT, outside
   contributor, copyright held by "Memex Engine contributors"). Instead: CytoPixel and its
   licensors retain ownership of their respective contributions, and nothing in these terms
   limits rights granted by the MIT License in the source.
3. **Trademark reservation.** MIT grants no trademark rights, so the "Memex" and
   "CytoPixel" names and logos are reserved separately. This is the one restriction in the
   document that MIT does not undercut.
4. **Third-party AI services.** The core disclosure. Memex operates by sending the user's
   prompts and the contents of files in their vault to Anthropic, PBC through the user's
   *own* Claude account. The user's agreement with Anthropic and Anthropic's privacy and
   usage policies govern that data, including retention and any use Anthropic permits
   itself. CytoPixel is not a party to that agreement, receives none of that data, and
   cannot access, control, or delete it.
5. **Third-party components.** The application includes software licensed by Anthropic PBC
   (the Claude Agent SDK and the bundled `claude` CLI), whose use is subject to Anthropic's
   Commercial Terms (Team, Enterprise, API) or Consumer Terms of Service (Free, Pro, Max)
   and the Anthropic Usage Policy, with links. The user is responsible for holding an
   Anthropic account in good standing and for using an authentication method Anthropic
   permits for their plan. The document must not instruct users toward any authentication
   method Anthropic disallows.
6. **Agentic operation.** The user acknowledges the software autonomously creates,
   modifies, moves, and deletes files in the vault directory and can execute commands the
   user approves; output may be inaccurate; the user is responsible for reviewing its
   actions and maintaining backups; output is not medical, legal, or financial advice.
7. **Prohibited data and uses.** No HIPAA PHI; no identifiable patient or research-subject
   data; no clinical or diagnostic reliance; no data whose disclosure to a third-party AI
   provider would breach law, contract, IRB protocol, FERPA, export control, or a
   confidentiality obligation; no unlawful use; no circumventing Anthropic's usage
   policies. Cite the reason: Anthropic covers PHI only where the user's own organization
   holds a BAA with Zero Data Retention enabled, which an individual Memex user will not
   have.
8. **Updates.** The application checks GitHub for updates and may download and install
   them.
9. **Disclaimer of warranties** — AS IS / AS AVAILABLE, mirroring NimbusImage §7.
10. **Limitation of liability** with cap, mirroring NimbusImage §8.
11. **Indemnification**, mirroring NimbusImage §9 minus the upload-specific clause.
12. **Term and termination.** Stop using and uninstall; no fees to unwind.
13. **Changes to these terms.** A new version is presented in the application; continued
    use requires acceptance; a user who declines should discontinue use.
14. **Governing law and jurisdiction** — Delaware, exclusive Delaware venue, UN CISG
    excluded, mirroring NimbusImage §13.
15. **Contact** — support@cytopixel.com.

### A2. Memex Privacy Notice

Short, and its headline is genuinely "we collect nothing":

- CytoPixel operates no servers for Memex and collects **no** personal information,
  telemetry, analytics, or crash reports. The vault never touches CytoPixel
  infrastructure.
- **What leaves the device, and to whom:** Anthropic (prompts and vault content, under the
  user's own account, governed by Anthropic); GitHub (update checks expose IP and
  user-agent to GitHub); and anything the user explicitly opens — external links handed to
  the system browser, `kind: "web"` tabs they configure, MCP connectors they enable in
  their own Claude account.
- **Stored locally, never transmitted:** `config.json` in the OS app-data directory —
  recent vault paths, per-vault tool approvals, and the terms-acceptance record.
- No cookies (this is not a website), no data sales, children's use, contact.

## Part B — the app

### B1. Enforcement lives in the main process

A renderer-only overlay would be cosmetic and bypassable — note `MEMEX_OPEN=/path` already
auto-opens a vault at launch, sailing past anything purely visual. The check therefore sits
at the one chokepoint where anything meaningful begins: the `vault:open` and `vault:create`
IPC handlers refuse while terms are unaccepted. The overlay is the UI for satisfying that
check, not the check itself.

### B2. New module: `app/src/main/legal.ts` (~60 lines)

The entire decision surface, kept small and directly testable:

- `loadLegal()` — reads `dist/legal/manifest.json` and the two markdown documents.
- `needsAcceptance(cfg, manifest)` — `!cfg.terms || cfg.terms.version !== manifest.version`.
  Plain inequality rather than a semver comparison, so any declared-version change
  re-prompts, including a rollback. **Fails closed:** a missing or unparseable manifest
  shows the gate rather than skipping it.
- `recordAcceptance(cfg, manifest)` — writes the acceptance record into the existing
  config.

Config shape, extending `PersistedConfig` in `app/src/main/main.ts:38`:

```ts
terms?: { version: string; acceptedAt: string; appVersion: string }
```

Per-machine and per-OS-user. There is no login to attach acceptance to, and inventing one
for this would be disproportionate.

### B3. Bundled text as source of truth

- `app/legal/terms.md`, `app/legal/privacy.md`, `app/legal/manifest.json`
  (`{ version, effective, summary }`).
- `app/scripts/copy-assets.js` gains a copy of `legal/` into `dist/legal/` (it currently
  copies only `index.html` and `styles.css` from `src/renderer`; it exists because
  `mkdir -p && cp` broke the Windows build, so the addition follows the same `fs` style).
- Rendered through the `marked` pipeline already present in `app/src/main/markdown.ts`.
- Bumping the terms = edit markdown, bump `version`, set `summary`, ship a release.

### B4. The overlay: `app/src/renderer/legal-gate.ts`

A new file rather than more `renderer.ts`, which is already 1336 lines. Loaded as its own
`<script>` exactly like `area-batch.js` and `vault-ui-state.js` are today
(`app/src/renderer/index.html:184-185`). Styled as a sibling of `.onboard` and layered
above it.

- Wordmark → "Before you start" → effective date.
- On a re-consent run, the manifest's `summary` renders as a "What changed" line so
  returning users aren't stonewalled by an undifferentiated wall of text.
- Segmented control **[Terms of Use] [Privacy Notice]** over one scroll pane — two
  documents, one decision.
- Checkbox "I have read and agree to the Memex Terms of Use and Privacy Notice" enables
  **Agree and continue**. **Decline and quit** calls `app.quit()`. Standard clickwrap; no
  scroll-lock, since forcing a scroll-to-bottom is friction that buys nothing.
- "View online" links hand off to the system browser through the existing `shell:open`
  path.
- Reuses the established `inert` pattern (`app/src/renderer/renderer.ts:122`) to trap focus
  while the gate is up.

### B5. IPC and preload

Two additions, following the existing `MemexApi` pattern (`app/src/shared/types.d.ts` is
the single source of truth, `app/src/preload/preload.ts` annotates against it so drift is a
compile error):

- `legal:state` → `{ needsAcceptance: boolean, version, effective, summary, terms: string, privacy: string }`,
  where `terms` and `privacy` are **rendered HTML**, not raw markdown. Rendering happens in
  main via `markdown.ts`, matching how the app already treats main-rendered markdown as
  authoritative (`app/src/renderer/renderer.ts:290`).
- `legal:accept` → records acceptance, returns success

Read-only review (B6) needs no additional IPC: it reuses `legal:state` and ignores
`needsAcceptance`.

### B6. Persistent access after acceptance

The vault-switcher footer already holds `#appVersion` and "Reset tool approvals for this
vault" (`app/src/renderer/index.html:179-180`) — the de facto settings surface. A "Terms of
Use · Privacy" row joins it and reopens the same overlay read-only (no checkbox, just
Close). No new settings panel.

### B7. Package metadata

`app/package.json` author email changes to `araj@cytopixel.com`. `license: "MIT"` and the
author name stay as they are — MIT accurately describes CytoPixel's own code, and the
bundled proprietary Anthropic components are addressed by the third-party components clause
(A1 §5) rather than by changing this field. Deciding whether the shipped artifact needs a
composite license notice is folded into the counsel review (open item 3).

## Testing

- **Unit** (`app/test/legal.test.cjs`, existing `node --test` suite): `needsAcceptance`
  across first run, version match, version bump, malformed config, and missing manifest
  (must fail closed); `recordAcceptance` round-trips through config without disturbing
  `recent`/`last`/tool grants.
- **Main-process enforcement:** `vault:open` and `vault:create` refuse while unaccepted.
- **Driven run:** first launch gates → accept → relaunch is clean → bump the manifest
  version → gate returns → decline quits.
- **Packaged build:** required. `app/README.md` and `docs/RELEASING.md` are emphatic that
  `npm start` does not exercise packaged asset paths, and this change adds new bundled
  files that must land correctly in the built app.

## Rollout

Two repositories, two pull requests:

1. `Memex` — bundled documents, `legal.ts`, gate UI, IPC, tests, `package.json` email.
2. `cytopixel_website` — the two new per-product sections, transcribed from
   `app/legal/*.md`.

Canonical text lives in `app/legal/*.md`; the website sections are transcribed from it.
Keeping those in sync manually is proportionate for two rarely-edited documents — add a
line to `docs/RELEASING.md` rather than building a generator, with `version` and
`effective` as the tell if they ever drift.
