export interface FileStorageProvider {
  readonly attachmentPolicy: { readonly maxFileBytes: number; readonly maxImageBytes: number };
  snapshot?(): Promise<FileSnapshot>;
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
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
export function segments(path: string): string[] {
  const s = path.split('/');
  if (!path || s.some((x) => !x || x === '.' || x === '..' || x.includes('\\') || x.includes('\0')))
    throw new StorageError('invalid', '非法路径');
  return s;
}

/** Stable read snapshot with explicit atomic publication; ordinary writes remain durable. */
export interface FileSnapshot {
  revision: string;
  files: FileStorageProvider;
  publish(changes: Map<string, Uint8Array | null>): Promise<boolean>;
}
