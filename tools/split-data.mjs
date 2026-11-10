#!/usr/bin/env node
// split-data.mjs — keeps masechta.html small for the website, without changing how versions are uploaded.
//
// Whatever was uploaded (masechta.html as the full single file or as the small one after editing it, or an
// edited masechta-full.html), this script leaves the repository in one consistent state:
//   masechta.html       small: every data block <script type="text/plain" id="__d_X"> is empty and has
//                       data-src="data/X.<hash>.dat"; the page fetches the file itself (see gunzipData in the page).
//   masechta-full.html  the full single file: the same code, with each block inlined as base64 (works offline).
//   data/X.<hash>.dat   the block's gzip bytes (base64-decoded). <hash> = first 10 hex of sha256 of the
//                       UNcompressed content, so an unchanged block keeps its file (and URL) across versions.
//   data/split-state.json  sha256 of the two html files as written here (to tell which one was edited next
//                       time) and the .dat files of this version and of the previous one.
// .dat files referenced neither by this version nor by the previous one are deleted.
// Running it again on its own output changes nothing.
//
// Usage: node tools/split-data.mjs        (no dependencies; Node 18+)
// Exit code 1 (with ::error::) when a referenced .dat file is missing or broken (checked before anything is
// written) or when the re-read output does not match the source.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SMALL = 'masechta.html', FULL = 'masechta-full.html', DATA = 'data', STATE = 'data/split-state.json';
const at = f => path.join(ROOT, f);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const mb = n => (n / 1048576).toFixed(2) + ' MB';
const BLOCK = /<script type="text\/plain" id="(__d_[A-Za-z0-9_]+)"(?: data-src="([^"]*)")?>([A-Za-z0-9+\/=\s]*)<\/script>/g;
const DAT = /^[A-Za-z0-9_-]+\.[0-9a-f]{10}\.dat$/;

const fail = msg => { console.log('::error::' + msg); process.exit(1); };
const warn = msg => console.log('::warning::' + msg);
const read = f => fs.existsSync(at(f)) ? fs.readFileSync(at(f), 'utf8') : null;
const gunzip = (buf, what) => { try { return zlib.gunzipSync(buf); } catch (e) { fail(`${what}: not a valid gzip stream (${e.message})`); } };
const blocks = html => [...html.matchAll(BLOCK)].map(m => ({ id: m[1], src: m[2] || '', b64: m[3].trim(), text: m[0] }));
const stripped = html => html.replace(BLOCK, (_, id) => `<script type="text/plain" id="${id}"></script>`);

// ── 1. which file is the source ──
const small = read(SMALL), full = read(FULL);
if (small === null) fail(`${SMALL} not found`);
let state = null;
try { state = JSON.parse(read(STATE)); } catch (e) { state = null; }
let srcName = SMALL;
if (state) {
  const chSmall = sha(small) !== state[SMALL], chFull = full !== null && sha(full) !== state[FULL];
  if (!chSmall && chFull) srcName = FULL;
  if (chSmall && chFull) warn(`both ${SMALL} and ${FULL} changed; using ${SMALL} and rebuilding ${FULL} from it`);
}
const src = srcName === SMALL ? small : full;
console.log(`source: ${srcName} (${mb(Buffer.byteLength(src))})`);

// ── 2. resolve every block to a .dat file ──
const code = stripped(src);
const hasLoader = /function gunzipData\(/.test(code) && /getAttribute\('data-src'\)/.test(code);
if (!hasLoader) warn(`${srcName} has no data-src loader (gunzipData) — publishing it unsplit; the site still works, only slower`);
const found = blocks(src);
const plan = [];   // {id, name, bytes, content, keepInline}
for (const b of found) {
  const short = b.id.replace(/^__d_/, '');
  const direct = new RegExp(`(getElementById|\\$)\\(\\s*['"]${b.id}['"]\\s*\\)\\s*\\.textContent`).test(code);
  if (b.b64) {
    const bytes = Buffer.from(b.b64, 'base64');
    const content = gunzip(bytes, `${srcName} block ${b.id}`);
    const name = `${DATA}/${short}.${sha(content).slice(0, 10)}.dat`;
    const keepInline = !hasLoader || direct;
    if (direct && hasLoader) warn(`${b.id} is read directly with .textContent — kept inline`);
    plan.push({ id: b.id, name, bytes, content, keepInline });
  } else if (b.src) {
    if (!DAT.test(path.basename(b.src)) || path.dirname(b.src) !== DATA) fail(`${b.id}: unexpected data-src "${b.src}"`);
    if (!fs.existsSync(at(b.src))) fail(`${b.id}: ${b.src} is referenced by ${srcName} but does not exist. Upload the full file (masechta-full.html renamed to masechta.html) instead.`);
    const bytes = fs.readFileSync(at(b.src));
    const content = gunzip(bytes, b.src);
    if (!path.basename(b.src).includes('.' + sha(content).slice(0, 10) + '.')) fail(`${b.src}: content does not match the hash in its name`);
    plan.push({ id: b.id, name: b.src, bytes, content, keepInline: !hasLoader || direct });
  } else plan.push({ id: b.id, empty: true });   // empty block without data — left as is
}

// ── 3. write .dat files (an existing file with the same content is kept as is, so its bytes and URL stay stable) ──
fs.mkdirSync(at(DATA), { recursive: true });
for (const p of plan) {
  if (p.empty) continue;
  if (fs.existsSync(at(p.name))) {
    const old = fs.readFileSync(at(p.name));
    let same = old.equals(p.bytes);
    if (!same) try { same = zlib.gunzipSync(old).equals(p.content); } catch (e) { /* broken file: rewrite it */ }
    if (same) { p.bytes = old; continue; }
  }
  if (!p.keepInline) fs.writeFileSync(at(p.name), p.bytes);
}

// ── 4. write the two html files ──
const byId = new Map(plan.map(p => [p.id, p]));
const smallOut = src.replace(BLOCK, (m, id) => {
  const p = byId.get(id); if (!p || p.empty) return m;
  return p.keepInline ? `<script type="text/plain" id="${id}">${p.bytes.toString('base64')}</script>`
                      : `<script type="text/plain" id="${id}" data-src="${p.name}"></script>`;
});
const fullOut = src.replace(BLOCK, (m, id) => {
  const p = byId.get(id); if (!p || p.empty) return m;
  return `<script type="text/plain" id="${id}">${p.bytes.toString('base64')}</script>`;
});
// the previous version's .dat files stay one more round: a browser (or proxy) that still holds the previous
// masechta.html for a few minutes keeps finding its data. They are in git history anyway, so this costs no repo size.
const datNow = [...new Set(plan.filter(p => !p.empty && !p.keepInline).map(p => path.basename(p.name)))].sort();
const datLast = state && Array.isArray(state.dat) ? state.dat : [];
const datPrev = JSON.stringify(datLast) === JSON.stringify(datNow) ? (state && state.datPrev || []) : datLast.filter(f => !datNow.includes(f));
fs.writeFileSync(at(SMALL), smallOut);
fs.writeFileSync(at(FULL), fullOut);
fs.writeFileSync(at(STATE), JSON.stringify({ note: 'written by tools/split-data.mjs', [SMALL]: sha(smallOut), [FULL]: sha(fullOut), dat: datNow, datPrev }, null, 1) + '\n');

// ── 5. delete .dat files that neither this version nor the previous one references ──
const keep = new Set([...datNow, ...datPrev]);
const removed = [];
for (const f of fs.readdirSync(at(DATA))) if (DAT.test(f) && !keep.has(f)) { fs.unlinkSync(at(`${DATA}/${f}`)); removed.push(f); }

// ── 6. verify by re-reading what was written ──
const s2 = fs.readFileSync(at(SMALL), 'utf8'), f2 = fs.readFileSync(at(FULL), 'utf8');
if (stripped(s2) !== code || stripped(f2) !== code) fail('verification: page code differs from the source');
for (const b of blocks(f2)) {
  const p = byId.get(b.id); if (!p || p.empty) continue;
  if (!zlib.gunzipSync(Buffer.from(b.b64, 'base64')).equals(p.content)) fail(`verification: ${FULL} block ${b.id} differs`);
}
for (const b of blocks(s2)) {
  const p = byId.get(b.id); if (!p || p.empty) continue;
  const got = b.src ? zlib.gunzipSync(fs.readFileSync(at(b.src))) : zlib.gunzipSync(Buffer.from(b.b64, 'base64'));
  if (!got.equals(p.content)) fail(`verification: ${SMALL} block ${b.id} differs`);
}

// ── 7. report ──
const rows = plan.filter(p => !p.empty).map(p => [p.id, p.keepInline ? '(inline)' : p.name, mb(p.bytes.length), mb(p.content.length)]);
console.log('\nblock      file                          gzip       content');
for (const r of rows) console.log(r[0].padEnd(10), r[1].padEnd(29), r[2].padStart(9), r[3].padStart(10));
console.log(`\n${SMALL}       ${mb(Buffer.byteLength(s2))}`);
const srcWasFull = found.every(b => b.b64 || !b.src);
console.log(`${FULL}  ${mb(Buffer.byteLength(f2))}${srcWasFull ? (f2 === src ? `  (identical to ${srcName} as uploaded)` : `  (differs from ${srcName} as uploaded only in re-encoded blocks)`) : ''}`);
console.log(`data/*.dat          ${mb(plan.filter(p => !p.empty && !p.keepInline).reduce((a, p) => a + p.bytes.length, 0))}`);
if (removed.length) console.log('removed: ' + removed.join(', '));
