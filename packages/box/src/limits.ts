export const FILE_BYTE_CAP = 256 * 1024;
export const CHAT_FILE_BYTE_CAP = 8 * 1024 * 1024;
export const TURN_BYTE_CAP = 8 * 1024;
export const SESSION_BYTE_CAP = 64 * 1024;
export const SESSION_COUNT_CAP = 2000;
export const WINDOW_LINES = 80;

export const SECRET_PATTERN =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]+/u;

export function chatFileTooLarge(size: number): boolean {
  return size > CHAT_FILE_BYTE_CAP;
}

export function turnTooLarge(text: string): boolean {
  return Buffer.byteLength(text) > TURN_BYTE_CAP;
}
