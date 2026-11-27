import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeFileDurablySync } from '../dist/durable_write.node.js';

function withDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knolo-durable-write-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Reproduces the Windows handle rules on any host: a flush needs a writable
// file handle, and a directory handle can never be flushed.
function withWindowsHandles(run) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const { openSync, fsyncSync } = fs;
  const readOnly = new Set();
  const flushed = [];
  fs.openSync = (file, flags, mode) => {
    const fd = openSync(file, flags, mode);
    if (flags === 'r') readOnly.add(fd);
    else readOnly.delete(fd);
    return fd;
  };
  fs.fsyncSync = (fd) => {
    if (readOnly.has(fd))
      throw Object.assign(new Error('EPERM: fsync'), { code: 'EPERM' });
    fsyncSync(fd);
    flushed.push(fd);
  };
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  syncBuiltinESMExports();
  try {
    run(flushed);
  } finally {
    Object.assign(fs, { openSync, fsyncSync });
    Object.defineProperty(process, 'platform', platform);
    syncBuiltinESMExports();
  }
}

test('durable writes create parent directories and replace existing bytes', () => {
  withDir((dir) => {
    const file = path.join(dir, 'nested', 'state.bin');
    writeFileDurablySync(file, Uint8Array.from([1, 2, 3]));
    writeFileDurablySync(file, Uint8Array.from([4]));
    assert.deepEqual([...fs.readFileSync(file)], [4]);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.bin']);
  });
});

test('durable writes flush through a writable handle under Windows rules', () => {
  withDir((dir) => {
    withWindowsHandles((flushed) => {
      const file = path.join(dir, 'state.bin');
      writeFileDurablySync(file, Uint8Array.from([7]));
      assert.deepEqual([...fs.readFileSync(file)], [7]);
      assert.equal(flushed.length, 1);
    });
  });
});

test('a failed durable write keeps the target and removes the temp file', () => {
  withDir((dir) => {
    const target = path.join(dir, 'occupied');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep'), 'kept');
    assert.throws(() => writeFileDurablySync(target, Uint8Array.from([1])));
    assert.deepEqual(fs.readdirSync(dir), ['occupied']);
    assert.equal(fs.readFileSync(path.join(target, 'keep'), 'utf8'), 'kept');
  });
});
