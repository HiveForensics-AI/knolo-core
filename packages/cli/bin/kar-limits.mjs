import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Matches the CEG Source byte limit. JSON and YAML reads use this cap. */
export const KAR_CLI_MAX_TEXT_BYTES = 32 * 1024 * 1024;

/** Knowledge Image reads. Larger than source text, still bounded. */
export const KAR_CLI_MAX_IMAGE_BYTES = 512 * 1024 * 1024;

export function resolveUserPath(file) {
  return path.resolve(process.cwd(), file);
}

/**
 * Read a user-supplied CLI path after checking it is a regular file under the cap.
 * The caller chooses the path. This does not sandbox `..`. It refuses oversized inputs.
 */
export function readBounded(file, maxBytes) {
  const resolved = resolveUserPath(file);
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new Error(`KAR_INPUT_NOT_A_FILE: ${file}`);
  if (stat.size > maxBytes) {
    throw new Error(
      `KAR_INPUT_TOO_LARGE: ${file} is ${stat.size} bytes; limit is ${maxBytes}.`
    );
  }
  return readFileSync(resolved);
}

export function readBoundedText(file, maxBytes = KAR_CLI_MAX_TEXT_BYTES) {
  return new TextDecoder().decode(readBounded(file, maxBytes));
}

export function readBoundedJson(file, maxBytes = KAR_CLI_MAX_TEXT_BYTES) {
  return JSON.parse(readBoundedText(file, maxBytes));
}
