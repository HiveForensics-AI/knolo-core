import { spawn, type ChildProcess } from 'node:child_process';

export const DEFAULT_REBUILD_TIMEOUT_MS = 60_000;
export const MAX_REBUILD_TIMEOUT_MS = 600_000;

export type RebuildSpec = {
  command: string;
  args: readonly string[];
  timeoutMs?: number;
};

const WINDOWS = process.platform === 'win32';

// Resolves on exit, on a spawn error, and on timeout. It never rejects, so
// the caller always refreshes from whatever files are installed and the pin
// checks decide what is served. A command that runs past its timeout is
// killed, so a hung hook cannot block every later tool call.
export function runConfiguredRebuild(spec: RebuildSpec): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    // On POSIX the hook leads its own process group, so a timeout also kills
    // the processes it started (npm run, npx) and none of them can write the
    // image after the call has moved on.
    const child = spawn(spec.command, [...spec.args], {
      stdio: 'ignore',
      detached: !WINDOWS,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      killTree(child);
      finish();
    }, spec.timeoutMs ?? DEFAULT_REBUILD_TIMEOUT_MS);
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    }
    child.once('error', finish);
    child.once('close', finish);
  });
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (WINDOWS) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    }).once('error', () => child.kill('SIGKILL'));
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}
