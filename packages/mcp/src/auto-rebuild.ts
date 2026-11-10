import { spawn } from 'node:child_process';

export function runConfiguredRebuild(spec: {
  command: string;
  args: readonly string[];
}): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const child = spawn(spec.command, [...spec.args], { stdio: 'ignore' });
    child.once('error', finish);
    child.once('close', finish);
  });
}
