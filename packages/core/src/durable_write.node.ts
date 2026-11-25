import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * Replace a file through a flushed temporary file in the same directory.
 *
 * The temporary file is opened for writing because Windows rejects a flush on
 * a read-only handle with EPERM.
 */
export function writeFileDurablySync(
  filePath: string,
  bytes: Uint8Array
): void {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(tempPath, bytes);
    flush(tempPath, 'r+');
    renameSync(tempPath, filePath);
    // Windows cannot flush a directory handle opened by Node. Elsewhere the
    // flush makes the rename durable, so its failure is still reported.
    if (process.platform !== 'win32') flush(dir, 'r');
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function flush(path: string, flags: 'r' | 'r+'): void {
  const fd = openSync(path, flags);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
