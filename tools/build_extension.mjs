// Copies the shared code (age format, byte helpers, DOM helper, style, fonts)
// into extension/, so the extension folder can be loaded on its own.
// Run after changing src/core/tabularium.js, src/core/bytes.js, src/ui/dom.js or css/.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const ext = join(root, 'extension');
const copy = (from, to) => { mkdirSync(join(ext, to, '..'), { recursive: true }); cpSync(join(root, from), join(ext, to), { recursive: true }); };
copy('src/core/tabularium.js', 'src/core/tabularium.js');
copy('src/core/bytes.js', 'src/core/bytes.js');
copy('src/core/codec.js', 'src/core/codec.js');
copy('src/core/tabula.js', 'src/core/tabula.js');
copy('src/ui/dom.js', 'src/ui/dom.js');
copy('src/ui/genera.js', 'src/ui/genera.js');
copy('src/core/verba.js', 'src/core/verba.js');
copy('src/core/wordlist.js', 'src/core/wordlist.js');
copy('vendor/age.bundle.js', 'vendor/age.bundle.js');
for (const l of ['age-encryption', 'noble-ciphers', 'noble-hashes', 'noble-curves', 'noble-post-quantum', 'scure-base']) copy(`vendor/${l}.LICENSE`, `vendor/${l}.LICENSE`);
copy('css', 'css');
copy('fonts', 'fonts');
const v = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const m = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
m.version = v;
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
console.log(`extension/ refreshed, version ${v}`);
