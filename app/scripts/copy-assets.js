// Copies the renderer's static assets into dist/. Replaces `mkdir -p && cp`,
// which is not valid on Windows (cmd's mkdir has no -p, and there is no cp), so
// the packaging build failed there.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'renderer');
const dest = path.join(__dirname, '..', 'dist', 'renderer');

fs.mkdirSync(dest, { recursive: true });
for (const file of ['index.html', 'styles.css']) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
}

// The terms/privacy documents are read at runtime by src/main/legal.ts and shown in
// the acceptance gate, so they have to land in dist/ like any other static asset.
const legalSrc = path.join(__dirname, '..', 'legal');
const legalDest = path.join(__dirname, '..', 'dist', 'legal');

fs.mkdirSync(legalDest, { recursive: true });
for (const file of ['manifest.json', 'terms.md', 'privacy.md']) {
  fs.copyFileSync(path.join(legalSrc, file), path.join(legalDest, file));
}
