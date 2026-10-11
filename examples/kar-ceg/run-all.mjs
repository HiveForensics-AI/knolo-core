import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const name of ['manual', 'claim-import', 'json-import']) {
  const result = spawnSync(process.execPath, [path.join(here, name, 'run.mjs')], { encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }
}
