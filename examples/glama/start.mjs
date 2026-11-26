import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const pins = JSON.parse(await readFile(path.join(here, 'pins.json'), 'utf8'));
const auditDir = '/tmp/knolo-audit';
await mkdir(auditDir, { recursive: true });
const configPath = path.join(auditDir, 'knolo-mcp.json');
const config = {
  agentId: 'mcp',
  auditDir,
  mounts: [
    {
      id: 'glama-demo',
      path: path.join(here, 'demo.v5'),
      sha256: pins.sha256,
      stateRoot: pins.stateRoot,
      policyPath: path.join(here, 'policy.json'),
      agents: ['mcp'],
      principal: 'mcp:reader',
    },
  ],
};
await writeFile(configPath, `${JSON.stringify(config)}\n`);
const bin = path.join(repoRoot, 'packages/mcp/bin/knolo-mcp.mjs');
const child = spawn(process.execPath, [bin, '--config', configPath], {
  cwd: repoRoot,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
