import type { AccessPolicy, TioObject } from './index';
/** Object-level remote contract. Database backends never need file layout semantics. */
export interface WorkspaceContentPort {
  authorize(): Promise<AccessPolicy>;
  list(): Promise<string[]>;
  read(id: string, options?: { fresh?: boolean }): Promise<TioObject | undefined>;
  write(object: TioObject): Promise<void>;
  readAsset(object: TioObject): Promise<Uint8Array | null>;
  writeAsset(object: TioObject, bytes: Uint8Array): Promise<void>;
}
