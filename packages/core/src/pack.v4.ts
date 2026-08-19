import type { Pack, PackChunk } from './pack.runtime.js';
import type { BuildInputDoc } from './builder.js';
import { getTextDecoder, getTextEncoder } from './utils/utf8.js';
import { sha256Hex } from './utils/sha256.js';
import { validateClaimGraph } from './graph/claim_graph.js';
import { analyzerProfileDigest, resolveAnalyzerProfile } from './analyzer.js';

export const PACK_V4_MAGIC = 'KNLOV4\0\0';
const DIGEST_FIELD = 80;
const FIXED_HEADER = 32 + DIGEST_FIELD * 2;
const MAX_HEADER = 16 * 1024 * 1024;
const MAX_SECTION = 512 * 1024 * 1024;

type Section = { name: string; schema: number; encoding: 'json' | 'raw'; required: boolean; capabilities: string[]; bytes: Uint8Array };
type DirectoryEntry = Omit<Section, 'bytes'> & { offset: number; length: number; digest: string };

export type PackManifestV4 = {
  version: 4;
  sources: Array<{ id: string; digest: string; mediaType: string; namespace?: string; parserVersion: string; analyzerVersion: string; chunking: { strategy: string; version: string } }>;
};

export function serializePackV4(pack: Pack, docs: BuildInputDoc[]): Uint8Array {
  const enc = getTextEncoder();
  const manifest: PackManifestV4 = { version: 4, sources: docs.map((doc, i) => ({
    id: doc.id ?? `block-${i}`,
    digest: `sha256-${sha256Hex(enc.encode(doc.text))}`,
    mediaType: 'text/plain',
    ...(doc.namespace ? { namespace: doc.namespace } : {}),
    parserVersion: 'knolo-raw-v1', analyzerVersion: `${resolveAnalyzerProfile(pack.meta.analyzer?.id as any).id}@${analyzerProfileDigest(resolveAnalyzerProfile(pack.meta.analyzer?.id as any))}`,
    chunking: { strategy: 'document', version: '1' },
  })) };
  const sections: Section[] = [
    { name: 'metadata', schema: 1, encoding: 'json', required: true, capabilities: [], bytes: enc.encode(JSON.stringify({ ...pack.meta, version: 4, format: 'v4' })) },
    { name: 'lexicon', schema: 1, encoding: 'json', required: true, capabilities: [], bytes: enc.encode(JSON.stringify([...pack.lexicon.entries()])) },
    { name: 'postings', schema: 1, encoding: 'raw', required: true, capabilities: [], bytes: u32Bytes(pack.postings) },
    { name: 'chunks', schema: 1, encoding: 'json', required: true, capabilities: [], bytes: enc.encode(JSON.stringify(pack.blocks.map((text, i) => analyzeChunk(text, i, pack)))) },
    { name: 'manifest', schema: 1, encoding: 'json', required: true, capabilities: [], bytes: enc.encode(JSON.stringify(manifest)) },
  ];
  if (pack.semantic) {
    sections.push({ name: 'semantic', schema: 1, encoding: 'json', required: false, capabilities: ['semantic'], bytes: enc.encode(JSON.stringify({ ...pack.semantic, vecs: Array.from(pack.semantic.vecs), scales: pack.semantic.scales ? Array.from(pack.semantic.scales) : undefined })) });
  }
  if (pack.claimGraph) sections.push({ name: 'claims', schema: 1, encoding: 'json', required: false, capabilities: ['claims'], bytes: enc.encode(JSON.stringify(pack.claimGraph)) });

  const manifestDigest = `sha256-${sha256Hex(sections.find((s) => s.name === 'manifest')!.bytes)}`;
  let directory: DirectoryEntry[] = [];
  let headerLength = FIXED_HEADER;
  for (let attempt = 0; attempt < 4; attempt++) {
    let offset = headerLength;
    directory = sections.map((s) => { const entry = { name: s.name, schema: s.schema, encoding: s.encoding, required: s.required, capabilities: s.capabilities, offset, length: s.bytes.byteLength, digest: `sha256-${sha256Hex(s.bytes)}` }; offset += s.bytes.byteLength; return entry; });
    const dirBytes = enc.encode(JSON.stringify(directory));
    const next = FIXED_HEADER + enc.encode(JSON.stringify(manifest)).byteLength + dirBytes.byteLength;
    if (next === headerLength) break;
    headerLength = next;
  }
  const dirBytes = enc.encode(JSON.stringify(directory));
  const manifestBytes = enc.encode(JSON.stringify(manifest));
  const sectionBytes = sections.reduce((n, s) => n + s.bytes.byteLength, 0);
  const total = headerLength + sectionBytes;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) out[i] = PACK_V4_MAGIC.charCodeAt(i);
  dv.setUint16(8, 4, true); dv.setUint16(10, 0, true); dv.setUint32(12, headerLength, true);
  dv.setUint32(16, sections.length, true); dv.setUint32(20, manifestBytes.byteLength, true); dv.setUint32(24, dirBytes.byteLength, true); dv.setUint32(28, 0, true);
  let at = FIXED_HEADER; out.set(manifestBytes, at); at += manifestBytes.byteLength; out.set(dirBytes, at); at += dirBytes.byteLength;
  for (const section of sections) { out.set(section.bytes, at); at += section.bytes.byteLength; }
  const packDigest = `sha256-${sha256Hex(out.slice(headerLength))}`;
  writeAscii(out, 32, manifestDigest, DIGEST_FIELD);
  writeAscii(out, 32 + DIGEST_FIELD, packDigest, DIGEST_FIELD);
  return out;
}

export function isPackV4(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 8) return false;
  const bytes = new Uint8Array(buf, 0, 8);
  return String.fromCharCode(...bytes) === PACK_V4_MAGIC;
}

export function inspectPackV4(buf: ArrayBuffer): { format: 4; version: number; flags: number; sections: Array<{ name: string; schema: number; encoding: string; required: boolean; offset: number; length: number; digest: string }>; manifest: PackManifestV4; manifestDigest: string; packDigest: string } {
  if (!isPackV4(buf)) throw new Error('Not a v4 pack.');
  const dv = new DataView(buf); const dec = getTextDecoder();
  const headerLength = dv.getUint32(12, true), manifestLength = dv.getUint32(20, true), directoryLength = dv.getUint32(24, true);
  const manifest = JSON.parse(dec.decode(new Uint8Array(buf, FIXED_HEADER, manifestLength))) as PackManifestV4;
  const sections = JSON.parse(dec.decode(new Uint8Array(buf, FIXED_HEADER + manifestLength, directoryLength))) as DirectoryEntry[];
  return { format: 4, version: dv.getUint16(8, true), flags: dv.getUint16(10, true), sections, manifest, manifestDigest: readAscii(new Uint8Array(buf), 32, DIGEST_FIELD), packDigest: readAscii(new Uint8Array(buf), 32 + DIGEST_FIELD, DIGEST_FIELD) };
}

export function parsePackV4(buf: ArrayBuffer): Pack {
  const dv = new DataView(buf); const dec = getTextDecoder();
  if (dv.getUint16(8, true) !== 4) throw new Error('Unsupported pack format version.');
  const headerLength = dv.getUint32(12, true), sectionCount = dv.getUint32(16, true), manifestLength = dv.getUint32(20, true), directoryLength = dv.getUint32(24, true);
  if (headerLength < FIXED_HEADER || headerLength > MAX_HEADER || sectionCount < 1 || sectionCount > 1024 || manifestLength > headerLength || directoryLength > headerLength) throw new Error('Invalid v4 pack header.');
  const manifestStart = FIXED_HEADER, dirStart = manifestStart + manifestLength;
  if (dirStart + directoryLength !== headerLength || headerLength > buf.byteLength) throw new Error('Invalid v4 pack header length.');
  const manifestDigest = readAscii(new Uint8Array(buf), 32, DIGEST_FIELD);
  if (manifestDigest !== `sha256-${sha256Hex(new Uint8Array(buf, manifestStart, manifestLength))}`) throw new Error('v4 manifest digest mismatch.');
  let manifest: PackManifestV4; let directory: DirectoryEntry[];
  try { manifest = JSON.parse(dec.decode(new Uint8Array(buf, manifestStart, manifestLength))); directory = JSON.parse(dec.decode(new Uint8Array(buf, dirStart, directoryLength))); } catch { throw new Error('Invalid v4 pack manifest or section directory.'); }
  if (manifest.version !== 4 || !Array.isArray(directory) || directory.length !== sectionCount) throw new Error('Invalid v4 pack manifest or section directory.');
  const sections = new Map<string, Uint8Array>();
  const ranges: Array<{ start: number; end: number; name: string }> = [];
  for (const entry of directory) {
    if (!entry || typeof entry.name !== 'string' || entry.offset < headerLength || entry.length < 0 || entry.length > MAX_SECTION || entry.offset + entry.length > buf.byteLength || sections.has(entry.name)) throw new Error(`Invalid v4 section: ${String(entry?.name ?? '')}.`);
    const bytes = new Uint8Array(buf, entry.offset, entry.length);
    ranges.push({ start: entry.offset, end: entry.offset + entry.length, name: entry.name });
    if (entry.digest !== `sha256-${sha256Hex(bytes)}`) throw new Error(`v4 section digest mismatch: ${entry.name}.`);
    sections.set(entry.name, bytes);
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) if (ranges[i].start < ranges[i - 1].end) throw new Error(`Overlapping v4 sections: ${ranges[i - 1].name} and ${ranges[i].name}.`);
  const storedPackDigest = readAscii(new Uint8Array(buf), 32 + DIGEST_FIELD, DIGEST_FIELD);
  const sectionEnd = ranges.reduce((end, range) => Math.max(end, range.end), headerLength);
  if (storedPackDigest !== `sha256-${sha256Hex(new Uint8Array(buf, headerLength, sectionEnd - headerLength))}`) throw new Error('v4 pack digest mismatch.');
  for (const required of ['metadata','lexicon','postings','chunks','manifest']) if (!sections.has(required)) throw new Error(`Missing required v4 section: ${required}.`);
  const json = (name: string) => JSON.parse(dec.decode(sections.get(name)!));
  const meta = json('metadata'); const entries = json('lexicon'); const chunks = json('chunks');
  if (!meta || meta.version !== 4 || !Array.isArray(entries) || !Array.isArray(chunks)) throw new Error('Invalid v4 required section schema.');
  const postingsBytes = sections.get('postings')!; if (postingsBytes.byteLength % 4) throw new Error('Invalid v4 postings section length.');
  const postings = new Uint32Array(postingsBytes.byteLength / 4); const pdv = new DataView(postingsBytes.buffer, postingsBytes.byteOffset, postingsBytes.byteLength); for (let i=0;i<postings.length;i++) postings[i]=pdv.getUint32(i*4,true);
  const parsedChunks = chunks as PackChunk[]; const blocks = chunks.map((x: any) => String(x?.text ?? '')); const headings = chunks.map((x: any) => x?.heading ?? null); const docIds = chunks.map((x: any) => x?.docId ?? null); const namespaces = chunks.map((x: any) => x?.namespace ?? null); const blockTokenLens = chunks.map((x: any) => Number(x?.len ?? 0));
  if (blocks.length !== meta.stats?.blocks || entries.some((x: any) => !Array.isArray(x) || typeof x[0] !== 'string' || !Number.isInteger(x[1]) || x[1] < 1)) throw new Error('Invalid v4 chunk or lexicon schema.');
  let semantic: Pack['semantic'];
  if (sections.has('semantic')) {
    const value = json('semantic');
    if (value?.encoding !== 'int8_l2norm' || !Array.isArray(value.vecs) || !Number.isInteger(value.dims) || value.dims < 1) throw new Error('Invalid v4 semantic section schema.');
    semantic = { version: 1, modelId: String(value.modelId ?? ''), dims: value.dims, encoding: 'int8_l2norm', perVectorScale: Boolean(value.perVectorScale), vecs: Int8Array.from(value.vecs), scales: Array.isArray(value.scales) ? Uint16Array.from(value.scales) : undefined };
  }
  const claimGraph = sections.has('claims') ? (validateClaimGraph(json('claims')) ?? undefined) : undefined;
  meta.manifestDigest = manifestDigest; meta.packDigest = storedPackDigest;
  return { meta, lexicon: new Map(entries), postings, blocks, headings, docIds, namespaces, blockTokenLens, chunks: parsedChunks, semantic, claimGraph };
}

function u32Bytes(values: Uint32Array): Uint8Array { const out = new Uint8Array(values.length * 4); const dv = new DataView(out.buffer); for (let i=0;i<values.length;i++) dv.setUint32(i*4, values[i], true); return out; }
function writeAscii(out: Uint8Array, offset: number, value: string, length: number): void { const bytes = new TextEncoder().encode(value); if (bytes.length > length) throw new Error('Digest exceeds v4 header field.'); out.set(bytes, offset); }
function readAscii(out: Uint8Array, offset: number, length: number): string { return new TextDecoder().decode(out.slice(offset, offset + length)).replace(/\0+$/, ''); }

function analyzeChunk(text: string, id: number, pack: Pack): PackChunk {
  const lines = text.split(/\r?\n/);
  const codeSymbols = [...text.matchAll(/\b(?:class|interface|function|const|let|var|def|fn)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const paths = [...text.matchAll(/(?:^|[\s"'`])((?:\.\.?\/|[A-Za-z]:[\\/])[\w./\\-]+)/g)].map((m) => m[1]);
  const tableLines = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line));
  const tableHeaders = tableLines[0] ? tableLines[0].split('|').map((x) => x.trim()).filter(Boolean) : [];
  const kind: PackChunk['kind'] = codeSymbols.length || /```/.test(text) ? 'code' : tableLines.length > 1 ? 'table' : /^\s*#/.test(text) ? 'markdown' : 'document';
  return { id, text, displayText: text, fieldedText: [pack.headings?.[id] ?? '', text, ...codeSymbols, ...paths].filter(Boolean).join(' '), heading: pack.headings?.[id] ?? null, docId: pack.docIds?.[id] ?? null, namespace: pack.namespaces?.[id] ?? null, len: pack.blockTokenLens?.[id] ?? 0, span: { start: 0, end: text.length, lineStart: 1, lineEnd: lines.length }, kind, codeSymbols: [...new Set(codeSymbols)].sort(), paths: [...new Set(paths)].sort(), tableHeaders };
}
