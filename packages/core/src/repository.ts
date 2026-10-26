import type { TioObject } from './index';
export interface WorkspaceEvent {
  version: number;
  commitId: string;
  origin: string;
  changedIds: string[];
}
export interface WorkspaceEntry {
  object: TioObject;
  revision: number;
}
export interface WorkspaceSnapshot {
  version: number;
  entries: WorkspaceEntry[];
  missing?: string[];
  denied?: string[];
}
export type WorkspaceMutation = (objects: TioObject[]) => TioObject[];
export interface AssetData {
  name: string;
  mime: string;
  bytes: Uint8Array;
}
export interface CommitRequest {
  id: string;
  clientId?: string;
  sequence?: number;
  origin?: string;
  recovery?: unknown[];
  expectedVersion: number;
  changes: TioObject[];
  assetIds: string[];
}
export type CommitResult =
  | { status: 'committed'; version: number; entries: WorkspaceEntry[] }
  | { status: 'conflict'; version: number }
  | { status: 'compacted'; version: number };
export class HostError extends Error {
  constructor(
    public code:
      | 'conflict'
      | 'invalid'
      | 'unavailable'
      | 'timeout'
      | 'closed'
      | 'unsupported'
      | 'permission'
      | 'pending',
    message = code as string,
  ) {
    super(message);
  }
}
/** The sole persistence boundary. All requests are data, never JS closures. */
export interface AssetStore {
  stageAsset(id: string, asset: AssetData): Promise<void>;
  readAsset(id: string): Promise<AssetData | undefined>;
  releaseAsset(id: string): Promise<void>;
}
export interface ObjectQuery {
  /** Choose one index; cursor ordering is stable object ID order, not display order. */
  scope: { type: string } | { databaseId: string };
  after?: string;
  limit: number;
}
export interface ObjectPage extends WorkspaceSnapshot {
  next?: string;
}
export interface WorkspaceRepository extends AssetStore {
  queryObjects?(query: ObjectQuery): Promise<ObjectPage>;
  /** Explicit full traversal, reserved for export and providers which scan locally. */
  readSnapshot(): Promise<WorkspaceSnapshot>;
  storageCapabilities?: RepositoryCapabilities;
  queryNavigation?(query: PageQuery): Promise<NavigationPage>;
  queryRecords?(query: RecordQuery): Promise<ObjectPage>;
  search?(query: SearchQuery): Promise<SearchPage>;
  scan?(query: PageQuery): Promise<ObjectPage>;
  readObjects?(ids: string[]): Promise<WorkspaceSnapshot>;
  readChanges?(since: number): Promise<WorkspaceSnapshot>;
  acknowledgeCommits?(clientId: string, sequence: number): Promise<void>;
  commit(request: CommitRequest): Promise<CommitResult>;
  getCommitResult(id: string): Promise<CommitResult | undefined>;
  subscribeChanges(listener: (event: WorkspaceEvent) => void): () => void;
  stageAsset(id: string, asset: AssetData): Promise<void>;
  readAsset(id: string): Promise<AssetData | undefined>;
  releaseAsset(id: string): Promise<void>;
}
export interface SyncEntry extends WorkspaceEntry {
  sync: Record<string, { base: TioObject; revision: number }>;
}
export interface SyncStateStore {
  acknowledge(id: string, endpoint: string, base: TioObject, revision: number): Promise<void>;
  clearBaseline(id: string, endpoint: string): Promise<void>;
  recover(value: unknown): Promise<void>;
}
export interface SyncRepository extends SyncStateStore {
  entries(): Promise<SyncEntry[]>;
  all(): Promise<TioObject[]>;
  get(id: string): Promise<SyncEntry | undefined>;
  reconcile(value: TioObject, revision: number, recovery?: unknown[]): Promise<number | null>;
  acknowledge(id: string, endpoint: string, base: TioObject, revision: number): Promise<void>;
  clearBaseline(id: string, endpoint: string): Promise<void>;
  readAsset(id: string): Promise<AssetData | undefined>;
  stageAsset(id: string, asset: AssetData): Promise<void>;
  recover(value: unknown): Promise<void>;
}

/** Capabilities describe guarantees, never implementation-specific storage kinds. */
export interface RepositoryCapabilities {
  persistence: 'atomic' | 'recoverable';
  offline: boolean;
  prefetch: 'none' | 'all';
}
export interface PageQuery {
  after?: string;
  limit: number;
}
export interface NavigationPage {
  version: number;
  items: TioObject[];
  next?: string;
  complete: boolean;
}
export interface RecordQuery extends PageQuery {
  text?: string;
  databaseId: string;
  view?: TioObject;
}
export interface SearchQuery extends PageQuery {
  text: string;
  type?: string;
}
export interface SearchPage {
  version: number;
  items: TioObject[];
  next?: string;
  complete: boolean;
  scanned: number;
}
/** Navigation summaries are never valid command baselines. */
export function navigationObject(object: TioObject): TioObject {
  const { blocks: _blocks, properties: _properties, ...metadata } = object;
  return metadata as TioObject;
}
