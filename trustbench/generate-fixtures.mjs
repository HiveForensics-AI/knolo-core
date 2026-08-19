import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPack, mountPack } from '../packages/core/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packs = path.join(root, 'conformance/packs');
await mkdir(path.join(packs, 'corrupted'), { recursive: true });
const docs = [
  { id: 'intro.md', namespace: 'docs.alpha', heading: 'Alpha Intro', text: 'alpha beta' },
  { id: 'runtime.md', namespace: 'docs.beta', heading: 'Beta Runtime', text: 'beta gamma runtime' },
  { id: 'other.md', namespace: 'docs.alpha', heading: 'Alpha Reference', text: 'alpha beta' },
];
const v3 = await buildPack(docs, { format: 3 });
const v4 = await buildPack(docs);
await writeFile(path.join(packs, 'standard-v3.knolo'), v3);
await writeFile(path.join(packs, 'verified-v4.knolo'), v4);
await writeFile(path.join(packs, 'minimal-v1.knolo'), await buildLegacyV1());
await writeFile(path.join(packs, 'corrupted/truncated.knolo'), v4.slice(0, Math.max(1, v4.length - 7)));
const digestCorrupt = Uint8Array.from(v4);
digestCorrupt[digestCorrupt.length - 1] ^= 0xff;
await writeFile(path.join(packs, 'corrupted/section-digest.knolo'), digestCorrupt);

async function buildLegacyV1() {
  const enc = new TextEncoder();
  const meta = enc.encode(JSON.stringify({ version: 1, stats: { docs: 1, blocks: 1, terms: 0 } }));
  const lex = enc.encode('[]'); const blocks = enc.encode(JSON.stringify(['legacy fixture']));
  const out = new Uint8Array(4 + meta.length + 4 + lex.length + 4 + 4 + blocks.length);
  const dv = new DataView(out.buffer); let at = 0;
  dv.setUint32(at, meta.length, true); at += 4; out.set(meta, at); at += meta.length;
  dv.setUint32(at, lex.length, true); at += 4; out.set(lex, at); at += lex.length;
  dv.setUint32(at, 0, true); at += 4; dv.setUint32(at, blocks.length, true); at += 4; out.set(blocks, at);
  return out;
}
