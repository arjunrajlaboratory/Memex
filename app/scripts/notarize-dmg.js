// electron-builder notarizes the .app and then builds the DMG around it, so the
// disk image itself ships un-notarized: Gatekeeper rejects it with "no usable
// signature" even though the app inside is signed, notarized and stapled. Users
// hit that when they open the downloaded DMG. This hook submits each DMG to the
// notary service and staples the ticket to it.
//
// It runs on `artifactBuildCompleted` rather than `afterAllArtifactBuild`
// because that fires before the artifact's hash reaches latest-mac.yml.
// Stapling rewrites the DMG, so the hash electron-builder already computed goes
// stale — `event.updateInfo` is patched below to keep the update manifest
// honest. (Verified: without the patch, latest-mac.yml records the pre-staple
// size and sha512.)
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

exports.default = async function notarizeDmg(event) {
  if (!event.file || !event.file.endsWith('.dmg')) return;

  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env;
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
    console.log('  • skipped DMG notarization  reason=App Store Connect API key env vars not set');
    return;
  }

  const name = path.basename(event.file);
  console.log(`  • notarizing DMG  file=${name}`);
  execFileSync('xcrun', [
    'notarytool', 'submit', event.file,
    '--key', APPLE_API_KEY,
    '--key-id', APPLE_API_KEY_ID,
    '--issuer', APPLE_API_ISSUER,
    '--wait',
  ], { stdio: 'inherit' });
  execFileSync('xcrun', ['stapler', 'staple', event.file], { stdio: 'inherit' });

  if (event.updateInfo) {
    const contents = fs.readFileSync(event.file);
    event.updateInfo.sha512 = crypto.createHash('sha512').update(contents).digest('base64');
    event.updateInfo.size = contents.length;
  }
  console.log(`  • DMG notarized and stapled  file=${name}`);
};
