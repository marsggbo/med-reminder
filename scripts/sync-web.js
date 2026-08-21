// Copies the source web app (index.html + assets) into www/ so Capacitor
// packages only the app files. Models, vendor runtimes and static files
// in www/ are not touched.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_FILES = ['index.html'];
const SRC_DIRS = ['assets'];
const DEST = path.join(ROOT, 'www');

function cp(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      cp(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log('  ✓', path.relative(ROOT, src), '→', path.relative(ROOT, dest));
  }
}

for (const f of SRC_FILES) cp(path.join(ROOT, f), path.join(DEST, f));
for (const d of SRC_DIRS) cp(path.join(ROOT, d), path.join(DEST, d));
console.log('sync-web done →', DEST);