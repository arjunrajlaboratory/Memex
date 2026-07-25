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

**1. Create the certificate.** In the Apple Developer portal → Certificates → `+`
→ **Developer ID Application** (not "Mac App Distribution" — that's for the App
Store). Follow the CSR flow, download the `.cer`, and double-click to install it
into your login keychain.

**2. Export it as a `.p12`.** In Keychain Access, find
"Developer ID Application: <your name> (<team id>)", right-click → Export →
`.p12`, and set a strong password. This file contains your private key — treat it
like one.

**3. Base64-encode it** for the GitHub secret:

```bash
base64 -i DeveloperID.p12 | pbcopy
```

## macOS: notarization credentials (App Store Connect API key)

Notarization proves to Gatekeeper that Apple has scanned the build. It needs
separate credentials from the signing certificate. This project uses an **App
Store Connect API key**: it belongs to the team rather than one person's Apple
ID, survives password rotations and 2FA changes, and can be revoked on its own.

**4. Create the key.** [App Store Connect](https://appstoreconnect.apple.com) →
**Users and Access** → **Integrations** tab → **App Store Connect API** →
**Team Keys**.

Use *Team Keys*, not *Individual Keys* — an individual key is bound to your
personal account and defeats the point of using an API key at all.

Click `+`, name it something like `notarize-ci`, and give it the **Developer**
role. Developer is sufficient for notarization; Admin also works but grants far
more than this needs.

**5. Download the `.p8` — you only get one chance.** Apple lets you download the
private key exactly once. If you lose it, the key must be revoked and replaced.
Download it and keep a copy in your password manager before going further.

**6. Note the two identifiers** from that same page:

- **Key ID** — the 10-character string in the key's row.
- **Issuer ID** — the UUID shown above the key list. It's per-team, not per-key,
  and it's easy to miss because it sits outside the table.

**7. Base64-encode the key** for the GitHub secret:

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
```

Base64 rather than pasting the raw PEM: it survives any whitespace or
line-ending mangling on the way into a secret.

### GitHub secrets to add

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | base64 of the `.p12` from step 3 |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` export password from step 2 |
| `APPLE_API_KEY_P8` | base64 of the `.p8` from step 7 |
| `APPLE_API_KEY_ID` | the 10-character Key ID from step 6 |
| `APPLE_API_ISSUER` | the Issuer UUID from step 6 |

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

## Auto-update (not wired up yet)

The `build.publish` block already points at GitHub Releases, which is the feed
format `electron-updater` expects (`latest-mac.yml` / `latest.yml` alongside the
`zip` and `nsis` artifacts — this is why `zip` is a macOS target and not just
`dmg`). Turning it on is a follow-up: add `electron-updater` and call
`autoUpdater.checkForUpdatesAndNotify()` from the main process.

Two constraints worth knowing before that work starts:

- macOS auto-update only functions on **signed** builds — Squirrel.Mac silently
  refuses unsigned or mismatched-identity updates. Signing is a prerequisite, not
  a nice-to-have.
- Because this repo is public, the updater needs no token. (A private repo would
  have to embed one, which is why the usual workaround is a separate public
  releases repo as the feed.)

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
