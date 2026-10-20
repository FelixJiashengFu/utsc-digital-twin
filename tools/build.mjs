// Assemble the static site in dist/ from src/ and the processed data in data/.
// Every local script and data URL gets a content hash, so a new deploy is never mixed with a cached one.
// Usage: deno run -A tools/build.mjs        (or: node tools/build.mjs)
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src'), DATA = join(ROOT, 'data'), DIST = join(ROOT, 'dist');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'data'), { recursive: true });
cpSync(join(SRC, 'vendor'), join(DIST, 'vendor'), { recursive: true });
for (const f of ['campus.json', 'terrain.bin']) cpSync(join(DATA, f), join(DIST, 'data', f));

const hashOf = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const dataHash = hashOf(Buffer.concat(['campus.json', 'terrain.bin'].map((f) => readFileSync(join(DATA, f)))));
const files = readdirSync(SRC).filter((f) => statSync(join(SRC, f)).isFile());
const version = {};
for (const f of files) version[f] = hashOf(readFileSync(join(SRC, f)));
for (const f of files) {
  let text = readFileSync(join(SRC, f), 'utf8');
  if (f.endsWith('.js')) {
    text = text.replace(/from '\.\/([\w-]+\.js)'/g, (_, name) => `from './${name}?v=${version[name]}'`);
    text = text.replace(/'data\/campus\.json'/g, `'data/campus.json?v=${dataHash}'`).replace(/'data\/' \+ spec\.file/g, `'data/' + spec.file + '?v=${dataHash}'`);
  }
  if (f === 'index.html') {
    text = text.replace('href="styles.css"', `href="styles.css?v=${version['styles.css']}"`)
      .replace('src="app.js"', `src="app.js?v=${version['app.js']}"`);
  }
  writeFileSync(join(DIST, f), text);
}
writeFileSync(join(DIST, '.nojekyll'), '');
const size = (p) => statSync(p).size;
console.log(`dist/ built: index.html ${(size(join(DIST, 'index.html')) / 1024).toFixed(0)} KB, campus.json ${(size(join(DIST, 'data', 'campus.json')) / 1024).toFixed(0)} KB, terrain.bin ${(size(join(DIST, 'data', 'terrain.bin')) / 1024).toFixed(0)} KB, data ${dataHash}`);
