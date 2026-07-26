# Releasing Memex Desktop

How to produce signed, distributable builds of the desktop app (`app/`).

Builds run in GitHub Actions (`.github/workflows/release.yml`) and publish to a
**draft** GitHub Release. Because this repo is public, the release assets double as
the update feed — no separate hosting or access token needed.

```
git tag app-v0.1.0
git push origin app-v0.1.0     # → builds mac/win/linux, uploads to a draft release
```

Then review the draft release on GitHub and publish it by hand. To rehearse the
pipeline without uploading anything, use the workflow's manual trigger
("Run workflow") with `publish` left unchecked.

App tags are prefixed `app-v` so desktop releases stay distinguishable from
engine versioning (`VERSION`).

## Before you tag: legal documents

- **Legal documents:** if `app/legal/terms.md` or `app/legal/privacy.md` changed, bump
  `version` and set `summary` in `app/legal/manifest.json` (this triggers the in-app
  re-consent gate), and transcribe the same text into the matching per-product sections
  on cytopixel.com. `version` and `effective` are the tell if the two drift.

The terms version is deliberately independent of the app version — bump it only for
substantive changes, since every bump re-prompts every existing user.

## What each platform needs

| Platform | Signing | Status |
| --- | --- | --- |
| macOS | Developer ID Application cert + notarization | needs the secrets below |
| Windows | Azure Trusted Signing (or an EV cert) | **unsigned today** — SmartScreen warns |
| Linux | none | works as-is |

Missing macOS secrets are not fatal: electron-builder logs a warning, skips
signing and notarization, and still produces a build. That keeps forks and
credential-less runs working — but an unsigned macOS build is quarantined by
Gatekeeper on other people's machines, so real distribution needs the secrets.

## macOS: signing certificate

You need the Apple Developer Program ($99/yr). Signing and notarization are two
separate credentials: this section covers the certificate that signs the app, the
next one covers the key that submits it to Apple's notary service. You need both.

This produces two secrets — `MAC_CSC_LINK` (the certificate and its private key)
and `MAC_CSC_KEY_PASSWORD` (the password protecting them).

**1. Generate a certificate signing request (CSR).** For CI the certificate only
ever needs to exist as a `.p12` file, so the whole thing can be done with
`openssl` — no GUI, and every step is verifiable:

```bash
mkdir -p ~/memex-signing && chmod 700 ~/memex-signing && cd ~/memex-signing
openssl req -new -newkey rsa:2048 -nodes \
  -keyout DeveloperID.key \
  -out DeveloperID.csr \
  -subj "/emailAddress=you@example.com/CN=Your Name/C=US"
chmod 600 DeveloperID.key
openssl req -in DeveloperID.csr -noout -verify   # "verify OK"
```

Apple requires RSA 2048 for this CSR. Keep `DeveloperID.key` — the certificate
Apple issues is useless without the matching private key.

<details>
<summary>GUI alternative via Keychain Access</summary>

Worth knowing: on macOS 15+ **Keychain Access is no longer in Applications →
Utilities** (Passwords.app took its slot) and Spotlight may not index it. It now
lives at `/System/Library/CoreServices/Applications/Keychain Access.app`:

```bash
open "/System/Library/CoreServices/Applications/Keychain Access.app"
```

Then use the **Keychain Access** application menu (next to the Apple menu) →
**Certificate Assistant** → **Request a Certificate From a Certificate
Authority**. Enter your email and name, choose **Saved to disk**. This route puts
the private key in your login keychain rather than a file, which is what you want
if you also intend to sign builds locally.

</details>

**2. Create the certificate.** Apple Developer portal → **Certificates, IDs &
Profiles** → Certificates → `+` → **Developer ID Application**.

Not "Mac App Distribution" or "Apple Development" — those are App Store and
local-development certificates and neither one lets you distribute a downloadable
app. Creating a Developer ID certificate requires the **Account Holder** role
(automatic if this is an individual account).

Upload `DeveloperID.csr`, then download the resulting `.cer` (it'll land in
`~/Downloads` as something like `developerID_application.cer`).

**3. Build the `.p12`.** Combine Apple's certificate with the private key from
step 1. Apple ships the `.cer` in DER form, so convert it first:

```bash
cd ~/memex-signing
mv ~/Downloads/developerID_application.cer .        # adjust to the real filename
openssl x509 -inform DER -in developerID_application.cer -out DeveloperID.pem
openssl pkcs12 -export -legacy \
  -inkey DeveloperID.key \
  -in DeveloperID.pem \
  -out DeveloperID.p12          # prompts for an export password — save it
```

**`-legacy` is required, not optional.** OpenSSL 3 defaults to PBES2 / AES-256-CBC
with a SHA-256 MAC, which Apple's `security` tool cannot read. Without the flag
the CI build fails at certificate import with:

```
security: SecKeychainItemImport: MAC verification failed during PKCS12 import (wrong password?)
```

The password is fine — it's the encryption scheme. `-legacy` emits the
SHA1/3DES form macOS expects. You can confirm before pushing the secret:

```bash
security create-keychain -p testpw /tmp/t.keychain
security import DeveloperID.p12 -k /tmp/t.keychain -P "$(cat p12-password.txt)" -T /usr/bin/codesign
security delete-keychain /tmp/t.keychain
```

Verify the bundle actually contains both halves:

```bash
openssl pkcs12 -in DeveloperID.p12 -nokeys -passin pass:YOUR_PASSWORD | grep subject
openssl pkcs12 -in DeveloperID.p12 -nocerts -noout -passin pass:YOUR_PASSWORD && echo "private key present"
```

A `.p12` without the private key is the classic failure here — it imports fine in
CI and then fails at signing time with an unhelpful error.

<details>
<summary>If you used the Keychain Access route instead</summary>

Double-click the `.cer` to install it, confirm with
`security find-identity -v -p codesigning | grep "Developer ID Application"`,
then in Keychain Access select the **My Certificates** category, right-click the
certificate → **Export** → `.p12`. Exporting from *My Certificates* is what
bundles the private key; exporting from plain *Certificates* silently omits it.

</details>

**4. Base64-encode it** for the GitHub secret:

```bash
base64 -i DeveloperID.p12 | pbcopy
```

`pbcopy` prints nothing — it copies silently. To confirm it worked:

```bash
pbpaste | wc -c        # should be a few thousand bytes
```

The `.p12`, the `.key`, and the `.p8` all contain private keys. Keep them in a
password manager, and don't commit them.

## macOS: notarization credentials (App Store Connect API key)

Notarization proves to Gatekeeper that Apple has scanned the build. It needs
separate credentials from the signing certificate. This project uses an **App
Store Connect API key**: it belongs to the team rather than one person's Apple
ID, survives password rotations and 2FA changes, and can be revoked on its own.

**1. Create the key.** [App Store Connect](https://appstoreconnect.apple.com) →
**Users and Access** → **Integrations** tab → **App Store Connect API** →
**Team Keys**.

Use *Team Keys*, not *Individual Keys* — an individual key is bound to your
personal account and defeats the point of using an API key at all.

Click `+`, name it something like `notarize-ci`, and give it the **Developer**
role. Developer is sufficient for notarization; Admin also works but grants far
more than this needs.

**2. Download the `.p8` — you only get one chance.** Apple lets you download the
private key exactly once. If you lose it, the key must be revoked and replaced.
Download it and keep a copy in your password manager before going further.

**3. Note the two identifiers** from that same page:

- **Key ID** — the 10-character string in the key's row.
- **Issuer ID** — the UUID shown above the key list. It's per-team, not per-key,
  and it's easy to miss because it sits outside the table.

**4. Base64-encode the key** for the GitHub secret:

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
```

Base64 rather than pasting the raw PEM: it survives any whitespace or
line-ending mangling on the way into a secret.

### GitHub secrets to add

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | base64 of `DeveloperID.p12` (certificate section, step 4) |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` export password you chose when running `openssl pkcs12 -export` |
| `APPLE_API_KEY_P8` | base64 of the `.p8` (API key section, step 4) |
| `APPLE_API_KEY_ID` | the 10-character Key ID (API key section, step 3) |
| `APPLE_API_ISSUER` | the Issuer UUID (API key section, step 3) |

No `APPLE_TEAM_ID` is needed on this route — that variable only applies to the
Apple ID / app-specific-password alternative.

### Two implementation details worth knowing

**`APPLE_API_KEY` is a file path, not key material.** `notarytool` reads the key
from disk, so the workflow decodes `APPLE_API_KEY_P8` into `$RUNNER_TEMP` and
points `APPLE_API_KEY` at that file. Setting `APPLE_API_KEY` to the key contents
fails with a confusing "file not found"-shaped error.

**Do not also set `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD`.** electron-builder's
documentation lists the API key as the first-choice route, but the implementation
checks the Apple ID variables *first* — so if both are present, your API key is
silently ignored. Pick one; this repo is set up for the API key.

<details>
<summary>Alternative: Apple ID + app-specific password</summary>

Quicker to set up, but tied to an individual and breaks on password rotation.
Create an app-specific password at [appleid.apple.com](https://appleid.apple.com)
→ Sign-In and Security → App-Specific Passwords, find your 10-character Team ID
under Membership details in the developer portal, then set `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` as secrets and swap those into
the macOS job's `env:` block in place of the `APPLE_API_*` values (also removing
the "Write App Store Connect API key" step).

</details>

## DMG notarization

electron-builder notarizes the `.app` and *then* builds the DMG around it, so the
disk image itself ships un-notarized. The app inside is fine — it's signed,
notarized and stapled, and Gatekeeper accepts it once installed — but the DMG
wrapper gets rejected:

```
$ spctl -a -t open --context context:primary-signature Memex-0.1.0-arm64.dmg
rejected  (source=no usable signature)
```

Users hit that when they open the downloaded disk image. `app/scripts/notarize-dmg.js`
closes the gap: it submits each DMG to the notary service and staples the ticket.

A DMG needs **both** halves, in this order: signed first, then notarized and
stapled. Notarizing alone is not enough — a stapled but unsigned disk image still
fails Gatekeeper with `no usable signature`, which we confirmed the hard way on a
published build.

So the fix is two settings working together:

1. **`"dmg": { "sign": true }`** in `package.json`. electron-builder's own
   `signDmg` resolves the Developer ID identity and the temporary keychain it
   created, so nothing has to be plumbed through by hand.
2. **`scripts/notarize-dmg.js`** submits the signed DMG and staples the ticket.

Two non-obvious details are baked into that script:

- **It runs on `artifactBuildCompleted`, not `afterAllArtifactBuild`.** Only the
  former fires before the artifact's hash is recorded for `latest-mac.yml`.
- **It re-hashes the DMG afterward.** Stapling rewrites the file, so the hash
  electron-builder computed goes stale; the script patches `event.updateInfo` so
  the update manifest matches the shipped bytes. Without this, `latest-mac.yml`
  records the pre-staple size and sha512.

The ordering works because `dmg-builder` signs, *then* computes the blockmap and
hash, *then* emits the event our hook listens to.

electron-builder's schema describes `dmg.sign` as "not required" and warns it
"will lead to unwanted errors in combination with notarization requirements".
That is misleading for this workflow: it applies to signing a DMG *without*
notarizing it. Signing before notarization is what Apple prescribes.

Known cosmetic gap: the `.dmg.blockmap` is generated before stapling, so it
describes the pre-staple file. Nothing reads it on macOS — `electron-updater`
updates from the `.zip` — but it is technically stale.

## Entitlements, and why the hand-off needs them

`app/build/entitlements.mac.plist` carries the usual Electron entitlements (JIT,
unsigned executable memory, library validation) plus
`com.apple.security.automation.apple-events`, paired with
`NSAppleEventsUsageDescription` in `package.json`'s `mac.extendInfo`.

That pair exists for the **Claude Code hand-off**: it drives Terminal.app through
`osascript`, which macOS attributes to Memex as an Apple Event send. Under the
hardened runtime, without the entitlement and the usage string, automation is
denied and the hand-off silently fails. The first hand-off in a signed build
triggers a one-time "Memex wants to control Terminal" prompt — expected, and the
usage string is what that dialog shows.

The app is **not** sandboxed (Developer ID direct distribution, not App Store),
which is what lets it read arbitrary vault directories and spawn `python3` for
vault creation. Sandboxing it would require an entitlement rethink.

## Windows: signing when you're ready

Since the 2023 CA/Browser rule change, OV and EV certificates must live on
hardware tokens or an HSM, which makes plain cert files a non-starter in CI. The
practical options:

- **Azure Trusted Signing** (~$10/month, Microsoft-operated, no hardware token,
  supported natively by electron-builder). Requires a verified organization or an
  individual identity validation. Add to `package.json` under `build.win`:

  ```json
  "azureSignOptions": {
    "publisherName": "<your verified name>",
    "endpoint": "https://<region>.codesigning.azure.net",
    "codeSigningAccountName": "<account>",
    "certificateProfileName": "<profile>"
  }
  ```

  then uncomment the `AZURE_*` env lines in the workflow and add those secrets.

- **An EV certificate** from DigiCert / Sectigo / SSL.com. EV clears SmartScreen
  immediately; OV has to accumulate reputation over time.

Until then the Windows installer is unsigned and users see a SmartScreen
"unrecognized app" warning — worth calling out in the release notes.

## Auto-update

**Working as of 0.1.3**, and verified end to end on a signed install (0.1.3
auto-updated itself to 0.1.4). `electron-updater` reads the `latest-*.yml` feed
published alongside the installers, downloads a newer version in the background,
and applies it when the app next quits. `initAutoUpdater()` in
`src/main/main.ts` is the whole of it.

It was *added* in 0.1.1 but crashed on the first line in both 0.1.1 and 0.1.2 —
see the CJS default-import trap below. Neither of those builds can self-update.

Behaviour worth knowing:

- **Packaged builds only.** Dev builds return early — electron-updater looks for
  a `dev-app-update.yml` that doesn't exist and throws.
- **Failures are silent by design.** A failed check is not something the user
  asked for or can act on, so the error handler logs and stops. That handler is
  also load-bearing: an unhandled `error` event from the updater would throw.
- **Checks once, at startup.** Fine for an app that gets restarted; if Memex
  turns out to be something people leave open for days, add a periodic check.
- **macOS updates come from the `.zip`, not the `.dmg`** — Squirrel.Mac installs
  from a zip, which is why `zip` is a macOS target.
- **Signing is a hard prerequisite on macOS.** Squirrel.Mac silently refuses
  updates that aren't signed with the same identity, so an unsigned build simply
  never updates rather than failing loudly.
- **Linux: AppImage only.** `.deb` installs are not supported by
  electron-updater; those errors land in the handler above and are ignored.
  Debian users update through their package manager.
- **Windows works but is unsigned**, so the downloaded updater triggers the same
  SmartScreen warning as the initial install until Windows signing is set up.
- **No token is embedded.** The repo is public, so the updater reads the feed
  anonymously. A private repo would have to ship a credential in the app, which
  is why the usual workaround there is a separate public releases repo.

A release can only carry forward users who already have a *working* updater.
0.1.0 shipped without one at all; 0.1.1 and 0.1.2 shipped a broken one. Those
three have to be replaced by hand. Every release from **0.1.3** onward updates
itself.

Confirming an update applied: the vault switcher shows the running version at
the bottom (`app:version` IPC). That exists precisely because there was no way
to tell otherwise without inspecting `Info.plist`.

## Packaged-build gotchas, and how to test for them

Three releases in a row shipped bugs that **could not occur in dev**. They share
one shape: code that only runs in a packaged app, verified only in dev.

> **The rule: anything behind `app.isPackaged`, anything that spawns a
> subprocess, and anything that imports a CommonJS dependency must be exercised
> in a real packaged build before release.** `npm start` proves nothing about
> these.

### Trap 1: paths through `app.asar` can't be spawned

`app.asar` is a file, not a directory. Electron's shim redirects file *reads*
into `app.asar.unpacked`, but **not** the executable path handed to
`child_process.spawn`. So a bundled binary fails with `ENOTDIR` even when
electron-builder has correctly unpacked it — unpacking is necessary but not
sufficient, and the consumer has to be pointed at the unpacked path explicitly
(see `src/main/claude-binary.ts`).

Symptom: works in dev, `spawn ENOTDIR` when packaged.

### Trap 2: default-importing a CommonJS dependency

`electron-updater` sets `__esModule: true` but exports no `default`. TypeScript's
`__importDefault` therefore passes the module through unwrapped, and
`import x from 'electron-updater'` yields an object whose `.default` is
`undefined`. Use a **named import**.

Symptom: `TypeError: Cannot destructure property 'autoUpdater' of '..._1.default'
as it is undefined` — and only at runtime, in packaged builds, because the call
site sits behind an `isPackaged` guard. Check before trusting a default import:

```bash
node -e "const m=require('<dep>'); console.log(m.__esModule, m.default!==undefined)"
```

### How to actually test a packaged build

```bash
npm run pack                       # builds release/mac-arm64/Memex.app

# Run it from a terminal so main-process console output is visible — launching
# from Finder hides exactly the errors you are looking for. The separate
# user-data-dir avoids the single-instance lock stealing your launch when a
# copy is already installed and running.
MEMEX_DEV=1 MEMEX_OPEN=~/some-vault \
  ./release/mac-arm64/Memex.app/Contents/MacOS/Memex \
  --user-data-dir=/tmp/memex-test-profile 2>&1 | tee /tmp/memex.log
```

Then **drive the feature**, don't just check that the app launched. A clean
startup log is not evidence that guarded code works: the ENOTDIR bug and the
updater crash both sat in an app that started perfectly.

### Testing auto-update specifically

`npm run pack` does not generate `app-update.yml`, so the updater fails with
`ENOENT` on it. Build a real target instead, with the version temporarily set
*below* the published release so there is something to find:

```bash
# temporarily set package.json version to the previous release, then:
npx electron-builder --mac dmg --arm64 --publish never
MEMEX_DEV=1 ./release/mac-arm64/Memex.app/Contents/MacOS/Memex \
  --user-data-dir=/tmp/upd-test 2>&1 | grep -iE "checking|found version|download"
```

Expect `Checking for update` → `Found version X` → `New version X has been
downloaded`. An **unsigned** local build then fails at
`Code signature ... did not pass validation` — that is correct and expected:
Squirrel.Mac requires the update to carry the same identity as the running app.
Reaching that line means everything upstream works. Afterwards, clear
`~/Library/Caches/memex-desktop-updater` and
`~/Library/Caches/app.memex.desktop.ShipIt` so a stale pending update doesn't
confuse the next run.

## Verifying a release before you publish it

CI logs are not proof. electron-builder *skips* signing with a warning rather
than failing, so a green run can still produce an unsigned app. Check the log for
the real evidence:

```
• signing   identityName=Developer ID Application: CytoPixel Software LLC (632L8D99KB)
• notarization successful
• DMG notarized and stapled
```

Then test an actual downloaded artifact on a Mac — this is the only check that
reflects what a user experiences:

```bash
# grab the DMG from the draft release (drafts need the asset API, not `gh release download`)
ID=$(gh api repos/arjunrajlaboratory/Memex/releases \
      --jq '.[] | select(.draft==true) | .assets[] | select(.name=="Memex-<version>-arm64.dmg") | .id')
gh api "repos/arjunrajlaboratory/Memex/releases/assets/$ID" \
      -H "Accept: application/octet-stream" > /tmp/Memex.dmg

codesign -dv /tmp/Memex.dmg                                # expect: a Developer ID authority
spctl -a -t open --context context:primary-signature -vv /tmp/Memex.dmg   # expect: accepted
xcrun stapler validate /tmp/Memex.dmg                                     # expect: worked

hdiutil attach /tmp/Memex.dmg -nobrowse -mountpoint /tmp/m
spctl -a -vvv /tmp/m/Memex.app        # expect: accepted, source=Notarized Developer ID
xcrun stapler validate /tmp/m/Memex.app
codesign -dv --verbose=2 /tmp/m/Memex.app   # expect flags=0x10000(runtime), TeamIdentifier
hdiutil detach /tmp/m
```

`flags=0x10000(runtime)` confirms the hardened runtime, which is what makes the
entitlements meaningful.

## Release naming: the git tag and the release tag differ

Pushing `app-v0.1.0` produces a GitHub Release tagged **`v0.1.0`**. electron-builder
names the release from `package.json`'s `version` and ignores the tag that
triggered the build. That's what `electron-updater` expects, so leave it alone —
just don't be surprised that the two differ, and remember to bump
`app/package.json` `version` before tagging a new release. Tagging without
bumping the version would try to reuse the existing release.

## Troubleshooting

**`security: SecKeychainItemImport: MAC verification failed during PKCS12 import (wrong password?)`**
The password is almost certainly fine. OpenSSL 3 writes PKCS#12 with
PBES2/AES-256-CBC, which Apple's `security` cannot read. Rebuild the `.p12` with
`openssl pkcs12 -export -legacy` and update `MAC_CSC_LINK`.

**`skipped macOS application code signing`**
`CSC_LINK` / `CSC_KEY_PASSWORD` are missing or unreadable. This is a *warning* —
the build still succeeds and silently produces an unsigned app.

**`skipped macOS notarization`**
The `APPLE_API_*` variables are absent. Also note that electron-builder checks
`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD` *first*: if those are set, your API key
is ignored regardless of what the docs imply.

**`⨯ Please specify project homepage`**
The Linux `deb` target needs `homepage` and an `author` with an email in
`app/package.json`.

**`The syntax of the command is incorrect.` on Windows**
A build script is using Unix shell syntax. `mkdir -p` and `cp` don't exist in
cmd/pwsh — this is why asset copying goes through `scripts/copy-assets.js`
instead of inline shell. Keep npm scripts cross-platform or Windows packaging
breaks.

**DMG rejected with `no usable signature` even though `stapler validate` passes**
The disk image has a notarization ticket but no code signature. Notarizing is not
sufficient on its own — set `"dmg": { "sign": true }` so it is signed before it is
submitted. `codesign -dv <dmg>` reporting "code object is not signed at all"
confirms this case.

**`syspolicy_check distribution` reports "Adhoc Signed App" for a `.dmg`**
Ignore it. That tool expects an `.app` bundle; its verdict on a disk image is
meaningless. Mount the DMG and run it against the `.app` inside, where
"App passed all pre-distribution checks" is the answer you want.

**`Agent session failed to start: spawn ENOTDIR` in a packaged build (works in dev)**
The agent SDK resolves its bundled `claude` binary relative to its own module
path, which in a packaged app runs through `app.asar` — a file, not a directory.
Electron redirects file *reads* into `app.asar.unpacked` but not the executable
handed to `spawn`, so electron-builder unpacking the binary is not sufficient on
its own. `src/main/claude-binary.ts` computes the unpacked path and the host
passes it to the SDK as `pathToClaudeCodeExecutable`. Any future bundled
subprocess needs the same treatment — unpacking alone will not fix it.

**A notarization failure that reads like bad credentials**
Check that the certificate and the API key belong to the *same* Apple team. A
cross-team mismatch surfaces as an authentication error that never mentions
teams.

**How long it should take.** A failing run dies in about a minute. A real signed
release takes roughly 7–8 minutes, since notarization adds ~2.5 minutes per
architecture and the DMGs are notarized separately on top of that.

## Local builds

```bash
cd app
npm run pack        # unpacked build in release/, no installer, no signing
npm run dist:mac    # full macOS build; signs only if a Developer ID cert is in your keychain
```

To force an unsigned local build even with a certificate installed:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
```

`release/` is gitignored.
