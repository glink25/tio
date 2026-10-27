import type { TioObject } from './index';
export interface Connection {
  id: string;
  kind: 'device' | 'folder' | 'github';
  name: string;
}
export interface WorkspaceDescriptor {
  id: string;
  workspaceId: string;
  connectionId: string;
  name: string;
}
export interface WorkspacePreferences {
  selectedId?: string;
  favorites?: string[];
}
export type Lifecycle = 'opening' | 'ready' | 'flushing' | 'closing' | 'closed' | 'error';
export interface WorkspaceSession extends WorkspaceDescriptor, WorkspacePreferences {}
export interface WorkspaceCatalog {
  list(): Promise<WorkspaceDescriptor[]>;
}
export interface HostPreferences {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}
export type AccessOperation = 'read' | 'create' | 'update' | 'delete' | 'share';
export interface AccessResource {
  workspaceId: string;
  id: string;
  type: string;
  fieldId?: string;
}
export interface AccessPolicy {
  version: string;
  allows(resource: AccessResource, operation: AccessOperation): boolean;
}
export const fullAccess: AccessPolicy = { version: 'local', allows: () => true };
export function resourceOf(object: TioObject, fieldId?: string): AccessResource {
  return { workspaceId: object.workspaceId, id: object.id, type: object.type, fieldId };
}
export function assertAccess(
  policy: AccessPolicy,
  before: TioObject | undefined,
  after: TioObject,
) {
  const operation = !before ? 'create' : after.deleted && !before.deleted ? 'delete' : 'update';
  if (!policy.allows(resourceOf(after), operation)) throw new Error('permission');
  const keys = new Set([
    ...Object.keys(before?.properties ?? {}),
    ...Object.keys(after.properties ?? {}),
  ]);
  for (const fieldId of keys)
    if (
      JSON.stringify(before?.properties?.[fieldId]) !==
        JSON.stringify(after.properties?.[fieldId]) &&
      !policy.allows(resourceOf(after, fieldId), operation)
    )
      throw new Error('permission');
  for (const field of [...(before?.fields ?? []), ...(after.fields ?? [])]) {
    const a = before?.fields?.find((f) => f.id === field.id),
      b = after.fields?.find((f) => f.id === field.id);
    if (
      JSON.stringify(a) !== JSON.stringify(b) &&
      !policy.allows(resourceOf(after, field.id), !a ? 'create' : !b ? 'delete' : 'update')
    )
      throw new Error('permission');
  }
}

export function readableObject(policy: AccessPolicy, object: TioObject): TioObject | undefined {
  if (!policy.allows(resourceOf(object), 'read')) return undefined;
  return {
    ...object,
    ...(object.properties
      ? {
          properties: Object.fromEntries(
            Object.entries(object.properties).filter(([fieldId]) =>
              policy.allows(resourceOf(object, fieldId), 'read'),
            ),
          ),
        }
      : {}),
    ...(object.fields
      ? {
          fields: object.fields.filter((field) =>
            policy.allows(resourceOf(object, field.id), 'read'),
          ),
        }
      : {}),
  };
}

/** Preserve unreadable fields when an authorized editor submits a partial read projection. */
export function preservePrivateFields(
  policy: AccessPolicy,
  before: TioObject | undefined,
  after: TioObject,
): TioObject {
  if (!before) return after;
  const next = structuredClone(after);
  for (const [id, value] of Object.entries(before.properties ?? {})) {
    if (!policy.allows(resourceOf(before, id), 'read') && !(id in (after.properties ?? {})))
      next.properties = { ...next.properties, [id]: value };
  }
  for (const field of before.fields ?? []) {
    if (
      !policy.allows(resourceOf(before, field.id), 'read') &&
      !after.fields?.some((f) => f.id === field.id)
    )
      next.fields = [...(next.fields ?? []), field];
  }
  return next;
}
