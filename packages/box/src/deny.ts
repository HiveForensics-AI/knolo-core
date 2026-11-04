import path from 'node:path';

const DENY_SEGMENTS = new Set([
  '.aws',
  '.git',
  '.gnupg',
  '.knolo',
  '.ssh',
  '__pycache__',
  'coverage',
  'credentials',
  'dist',
  'downloads',
  'logs',
  'node_modules',
]);

const DENY_BASENAMES = new Set([
  'auth.json',
  'config.toml',
  'id_ed25519',
  'id_rsa',
  'memory.md',
  'system_prompt.txt',
  'tool_definitions.json',
  'updates.jsonl',
]);

export function isDeniedPath(filePath: string): boolean {
  const parts = filePath.split(/[\\/]+/u).filter((part) => part.length > 0);
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (DENY_SEGMENTS.has(lower)) return true;
    if (DENY_BASENAMES.has(lower)) return true;
    if (lower === '.env' || lower.startsWith('.env.')) return true;
    if (lower.endsWith('.pem') || lower.endsWith('.key')) return true;
    if (
      lower.endsWith('.sqlite') ||
      lower.endsWith('.sqlite-wal') ||
      lower.endsWith('.sqlite-shm')
    ) {
      return true;
    }
    if (lower.startsWith('rewind_points') || lower.startsWith('usage.json')) {
      return true;
    }
  }
  return false;
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}
