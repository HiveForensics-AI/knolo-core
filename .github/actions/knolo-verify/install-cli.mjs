/**
 * Install an exact @knolo/cli version for the composite action.
 * Ranges, tags, and shell metacharacters are rejected before npm runs.
 */
import { execFileSync } from 'node:child_process';

const version = process.env.KNOLO_CLI_VERSION ?? '';
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(
    'cli-version must be an exact version such as 6.2.0. Ranges and latest are rejected.'
  );
  process.exit(1);
}

execFileSync(
  'npm',
  ['install', '--global', `@knolo/cli@${version}`, '--ignore-scripts'],
  { stdio: 'inherit' }
);
