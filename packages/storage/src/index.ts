export interface FileStorageProvider {
  canWrite?(): Promise<boolean>;
  list(prefix: string): Promise<{ path: string; fingerprint?: string }[]>;
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
}
export class StorageError extends Error {
  constructor(
    public code: 'permission' | 'missing' | 'invalid' | 'io',
    message: string,
  ) {
    super(message);
  }
}
export function segments(path: string): string[] {
  const s = path.split('/');
  if (!path || s.some((x) => !x || x === '.' || x === '..' || x.includes('\\') || x.includes('\0')))
    throw new StorageError('invalid', '非法路径');
  return s;
}
