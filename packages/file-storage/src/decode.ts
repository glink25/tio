import { StorageError } from '@tio/storage';

/** Normalize content failures only; transport operations must stay outside this boundary. */
export function decodeStored<T>(decode: () => T): T {
  try {
    return decode();
  } catch (cause) {
    if (cause instanceof StorageError) throw cause;
    throw new StorageError('invalid', 'Invalid stored content', { cause });
  }
}

export function parseStored(bytes: Uint8Array): unknown {
  return decodeStored(() => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
