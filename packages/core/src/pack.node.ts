import { mountPackFromBuffer, toArrayBuffer } from './pack.runtime.js';
import type { MountOptions, Pack } from './pack.runtime.js';
export { hasSemantic } from './pack.runtime.js';
export type { MountOptions, PackMeta, Pack } from './pack.runtime.js';

export async function mountPack(opts: MountOptions): Promise<Pack> {
  const buf = await resolveToBuffer(opts.src);
  return mountPackFromBuffer(buf);
}

async function resolveToBuffer(src: MountOptions['src']): Promise<ArrayBuffer> {
  if (typeof src === 'string') {
    if (isLikelyLocalPath(src)) {
      const { readFile } = await import('node:fs/promises');
      const filePath = src.startsWith('file://')
        ? decodeURIComponent(new URL(src).pathname)
        : src;
      const data = await readFile(filePath);
      return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      );
    }
    const res = await fetch(src);
    return await res.arrayBuffer();
  }
  return toArrayBuffer(src);
}

function isLikelyLocalPath(value: string): boolean {
  if (value.startsWith('file://')) return true;
  if (
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('/') ||
    value.startsWith('~')
  )
    return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) return false;
  return true;
}
