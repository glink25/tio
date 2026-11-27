import type {
  AssetData,
  HostPreferences,
  ObjectPage,
  QueryPage,
  RepositoryCapabilities,
  SyncRepository,
  WorkspaceRepository,
  WorkspaceSession,
} from '@tio/core';
import type { GiteeEndpoint } from '@tio/provider-gitee';
import type { GitHubCache } from '@tio/provider-github';
import type { Credentials, GitProvider } from '@tio/provider-github/credentials';

import type { ConnectionBinding } from './services/connection-adapters';
import type { DesktopChrome } from './services/desktop-chrome';

export interface FolderGrant {
  kind: 'native-folder';
  id: string;
  name: string;
}
export type FolderHandle = FileSystemDirectoryHandle | FolderGrant;
export interface HostCatalog extends HostPreferences {
  read(key: string): Promise<any>;
  sessions(): Promise<WorkspaceSession[]>;
  saveSession(session: WorkspaceSession): Promise<void>;
  removeSession(id: string): Promise<void>;
  setting(key: string, ...value: [unknown?]): Promise<any>;
  close(): Promise<void>;
}
export interface ReplicaStorage extends WorkspaceRepository, SyncRepository {
  readonly instanceId: string;
  storageComplete: boolean;
  setComplete(): Promise<void>;
  isComplete(): boolean | Promise<boolean>;
  remoteAssets: boolean;
  storageCapabilities: RepositoryCapabilities;
  relations: NonNullable<WorkspaceRepository['relations']> & {
    invalidate(reason?: 'content' | 'access' | 'ready'): void;
  };
  queryRecords(query: import('@tio/core').RecordQuery): Promise<QueryPage>;
  queryObjects(query: import('@tio/core').ObjectQuery): Promise<ObjectPage>;
  scan(query: import('@tio/core').PageQuery): Promise<ObjectPage>;
  cacheAsset(id: string, data: AssetData): Promise<void>;
  batch(
    objects: import('@tio/core').TioObject[],
    assets?: Map<string, Blob>,
    origin?: string,
  ): Promise<void>;
  close(): void;
}
export interface HostUpdate {
  status: string;
  version?: string;
  pendingVersion?: string;
  diagnostics?: {
    channel: string;
    hostVersion: string;
    hostBuild: string;
    contractId: string;
    runtime: { productVersion: string; revision: number };
  };
}
export interface WorkspaceWindows {
  enabled: boolean;
  session?: string;
  restoreRecent: boolean;
  claim(session: string): Promise<boolean>;
  commit(session: string): Promise<void>;
  cancel(): Promise<void>;
  release(): Promise<void>;
  open(session?: string): Promise<void>;
  ownsSync(session?: string): boolean;
  confirmSyncOwner(session: string): Promise<boolean>;
  subscribeAssignments(listener: () => void): () => void;
  onClose(prepare: () => Promise<void>): Promise<() => void>;
  changeConnection<T>(work: () => Promise<T>, session?: string): Promise<T>;
}
export interface AppPlatform {
  assistantFetch: import('./services/assistant-fetch').AssistantFetch;
  mobile?: 'ios' | 'android';
  deviceLabel: 'welcome.device' | 'welcome.offline';
  catalog(): HostCatalog;
  deviceRepository(workspace: string, instance: string): WorkspaceRepository & { close(): void };
  deleteDevice(connection: string, workspace: string): Promise<void>;
  folder: {
    supported(): boolean;
    pick(): Promise<FolderHandle>;
    same(a: FolderHandle, b: FolderHandle): Promise<boolean> | boolean;
    binding(connection: import('@tio/core').Connection, handle?: FolderHandle): ConnectionBinding;
  };
  Replica: new (instance: string, workspace: string) => ReplicaStorage;
  git: {
    cache(namespace: string[]): GitHubCache;
    persistEndpoints(
      key: string,
      entries: [string, import('@tio/provider-github').GitHubEndpoint | GiteeEndpoint][],
    ): Promise<void>;
  };
  auth: {
    origin?: string;
    attempts(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    read(): Credentials | undefined;
    readFresh(): Promise<Credentials | undefined>;
    persist(value?: Credentials): Promise<void>;
    remember(value?: Credentials): void;
    lock<T>(work: () => Promise<T>): Promise<T>;
    redirectURI(provider: GitProvider): string;
    acceptsCallback(input: string, provider: GitProvider): boolean;
    open(url: string): Promise<void>;
    authenticate?(url: string): Promise<string | null>;
    callbacks?: {
      current(): Promise<string[]>;
      subscribe(listener: (urls: string[]) => void): Promise<() => void>;
    };
  };
  sync: {
    active(): boolean;
    subscribe(listener: () => void): () => void;
    lock<T>(name: string, session: string, work: () => Promise<T>): Promise<T>;
  };
  windows?: WorkspaceWindows;
  desktopChrome?: DesktopChrome;
  onStartupReady?(): void;
  update?: (action: string, version?: string) => Promise<HostUpdate>;
  clearStorage(): Promise<void>;
  afterReady?(): Promise<void>;
}
let current: AppPlatform | undefined;
export function configurePlatform(value: AppPlatform) {
  current = value;
}
export function platform(): AppPlatform {
  if (!current) throw new Error('Configure the application platform before mounting Tio');
  return current;
}
