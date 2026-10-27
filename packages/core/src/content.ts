import type { AccessPolicy, TioObject } from './index';
/** Object-level remote contract. Database backends never need file layout semantics. */
export interface WorkspaceContentPort {
  snapshot?(): Promise<ContentSnapshot>;
  authorize(): Promise<AccessPolicy>;
  list(): Promise<string[]>;
  read(id: string, options?: { fresh?: boolean }): Promise<TioObject | undefined>;
  write(object: TioObject): Promise<void>;
  readAsset(object: TioObject): Promise<Uint8Array | null>;
  writeAsset(object: TioObject, bytes: Uint8Array): Promise<void>;
}

export interface ContentSnapshot {
  content: WorkspaceContentPort;
  revision: string;
  publish(objects: TioObject[], assets: Map<string, Uint8Array>): Promise<boolean>;
}
