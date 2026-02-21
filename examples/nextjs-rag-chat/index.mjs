import { rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const target = 'my-kb-chat';
if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
}

const result = spawnSync(process.execPath, ['./node_modules/create-knolo-app/bin/index.mjs', target], {
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('\nScaffolded ./my-kb-chat');
console.log('Next commands:');
console.log('  cd my-kb-chat');
console.log('  npm install');
console.log('  npm run knolo:build');
console.log('  npm run dev');
