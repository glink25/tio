import type { TioObject } from './index';
import type { ReferenceOccurrence } from './references';

/** Derived data is never a command baseline or a serialized business object. */
export interface QueryEntry {
  projection: TioObject;
  revision: number;
  references: ReferenceOccurrence[];
}
export interface QueryPage {
  version: number;
  entries: QueryEntry[];
  next?: string;
  missing?: string[];
  denied?: string[];
}
export interface ProjectionQuery {
  ids?: string[];
  type?: string;
  databaseId?: string;
  after?: string;
  limit?: number;
}
export interface QueryIndexState {
  status: 'building' | 'ready' | 'error';
  error?: string;
}
/** Provider-owned metadata store. write() atomically applies all keys. */
export interface RepositoryStateStore {
  read<T>(key: string): Promise<T | undefined>;
  readMany<T>(keys: string[]): Promise<(T | undefined)[]>;
  entries<T>(prefix: string, after?: string, limit?: number): Promise<{ key: string; value: T }[]>;
  write(puts: { key: string; value: unknown }[], deletes?: string[]): Promise<void>;
}

/** Explicit allowlist prevents unknown or opaque payloads becoming a second body cache. */
export function queryProjection(object: TioObject): TioObject {
  const result: TioObject = {
    id: object.id,
    workspaceId: object.workspaceId,
    type: object.type,
    schemaVersion: object.schemaVersion,
  };
  for (const key of [
    'deleted',
    'title',
    'name',
    'icon',
    'cover',
    'parentId',
    'order',
    'appMode',
    'manualSync',
    'fields',
    'databaseId',
    'properties',
    'createdAt',
    'updatedAt',
    'layout',
    'visibleFieldIds',
    'fieldOrder',
    'columnWidths',
    'filters',
    'sorts',
    'groupBy',
    'filename',
    'mime',
    'byteSize',
    'assetPath',
  ])
    if (object[key] !== undefined) result[key] = structuredClone(object[key]);
  return result;
}
