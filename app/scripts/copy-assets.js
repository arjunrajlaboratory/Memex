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
