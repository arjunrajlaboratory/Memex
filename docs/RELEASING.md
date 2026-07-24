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

## macOS: one-time Apple setup

You need the Apple Developer Program ($99/yr).

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

**4. Create an app-specific password** for notarization at
[appleid.apple.com](https://appleid.apple.com) → Sign-In and Security →
App-Specific Passwords. (Apple's notary service will not accept your normal
password.)

**5. Find your Team ID** — the 10-character code in the Apple Developer portal
under Membership details.

### GitHub secrets to add

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | base64 of the `.p12` from step 3 |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` export password from step 2 |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password from step 4 |
| `APPLE_TEAM_ID` | your 10-character Team ID |

**Alternative — App Store Connect API key.** More robust than an app-specific
password (team-owned rather than tied to one person's Apple ID, and unaffected by
password rotation). electron-builder reads `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
and `APPLE_API_ISSUER` instead of the three `APPLE_*` values above. Note that
`APPLE_API_KEY` must be a **filesystem path to the `.p8` file**, not the key
contents, so the workflow needs an extra step to materialize it:

```yaml
- name: Write App Store Connect key
  run: |
    mkdir -p ~/private_keys
    echo "${{ secrets.APPLE_API_KEY_P8 }}" | base64 --decode > ~/private_keys/AuthKey.p8
    echo "APPLE_API_KEY=$HOME/private_keys/AuthKey.p8" >> "$GITHUB_ENV"
```

### Entitlements, and why the hand-off needs them

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
