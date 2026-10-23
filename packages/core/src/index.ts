import { ObjectRegistry } from './registry';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type FieldType =
  | 'title'
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiSelect'
  | 'relation'
  | 'formula'
  | 'rollup';
export interface Field {
  id: string;
  name: string;
  type: FieldType | (string & {});
  options?: { id: string; label: string }[];
  targetDatabaseId?: string;
  multiple?: boolean;
  [key: string]: unknown;
}
export interface Block {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: unknown;
  children: Block[];
  [key: string]: unknown;
}
export interface Filter {
  fieldId: string;
  op: 'contains' | 'eq' | 'notEmpty';
  value?: unknown;
}
export interface Sort {
  fieldId: string;
  direction: 'asc' | 'desc';
}
/** Persisted business objects have no backend or editor runtime fields. Unknown keys survive. */
export interface TioObject {
  id: string;
  workspaceId: string;
  type: string;
  schemaVersion: number;
  deleted?: boolean;
  title?: string;
  name?: string;
  icon?: string;
  parentId?: string | null;
  order?: number;
  blocks?: Block[];
  fields?: Field[];
  databaseId?: string;
  properties?: Record<string, unknown>;
  layout?: 'table' | 'board';
  visibleFieldIds?: string[];
  fieldOrder?: string[];
  columnWidths?: Record<string, number>;
  filters?: Filter[];
  sorts?: Sort[];
  groupBy?: string;
  filename?: string;
  mime?: string;
  byteSize?: number;
  assetPath?: string;
  [key: string]: unknown;
}
export const id = (prefix = 'obj') => `${prefix}_${crypto.randomUUID()}`;
export const knownTypes = new Set([
  'workspace',
  'page',
  'database',
  'record',
  'databaseView',
  'asset',
]);
export function object(
  type: string,
  workspaceId: string,
  props: Partial<TioObject> = {},
): TioObject {
  return { id: id(type), workspaceId, type, schemaVersion: 1, ...props };
}
const plain = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
export function validate(input: unknown): TioObject {
  if (
    !plain(input) ||
    typeof input.id !== 'string' ||
    !input.id ||
    typeof input.workspaceId !== 'string' ||
    typeof input.type !== 'string' ||
    !Number.isInteger(input.schemaVersion) ||
    (input.schemaVersion as number) < 1
  )
    throw new Error('无效的业务对象');
  for (const key of ['id', 'workspaceId'])
    if (!/^[a-zA-Z0-9_-]+$/.test(input[key] as string)) throw new Error('非法对象标识');
  if (
    input.databaseId !== undefined &&
    (typeof input.databaseId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input.databaseId))
  )
    throw new Error('非法数据库标识');
  if (!registry().supports(input as unknown as TioObject)) return input as unknown as TioObject;
  if (input.deleted !== undefined && typeof input.deleted !== 'boolean')
    throw new Error('非法删除状态');
  if (input.type === 'workspace' && input.id !== input.workspaceId)
    throw new Error('Workspace 身份不匹配');
  if (
    ['page', 'database'].includes(input.type) &&
    input.parentId !== null &&
    input.parentId !== undefined &&
    typeof input.parentId !== 'string'
  )
    throw new Error('非法父级');
  if (['page', 'record'].includes(input.type)) validateBlocks(input.blocks);
  if (['record', 'databaseView'].includes(input.type) && typeof input.databaseId !== 'string')
    throw new Error('缺少数据库引用');
  if (input.type === 'record' && !plain(input.properties)) throw new Error('非法记录字段');
  if (input.type === 'database') {
    if (!Array.isArray(input.fields)) throw new Error('缺少字段定义');
    const ids = new Set();
    for (const f of input.fields) {
      if (
        !plain(f) ||
        typeof f.id !== 'string' ||
        typeof f.name !== 'string' ||
        typeof f.type !== 'string' ||
        ids.has(f.id)
      )
        throw new Error('非法或重复字段');
      ids.add(f.id);
      if (
        f.options !== undefined &&
        (!Array.isArray(f.options) ||
          !f.options.every(
            (x) => plain(x) && typeof x.id === 'string' && typeof x.label === 'string',
          ) ||
          new Set(f.options.map((x) => (x as any).id)).size !== f.options.length)
      )
        throw new Error('非法选项');
    }
  }
  if (input.type === 'databaseView') {
    if (
      input.fieldOrder !== undefined &&
      (!Array.isArray(input.fieldOrder) ||
        !input.fieldOrder.every((x) => typeof x === 'string') ||
        new Set(input.fieldOrder).size !== input.fieldOrder.length)
    )
      throw new Error('非法视图');
    if (
      input.columnWidths !== undefined &&
      (!plain(input.columnWidths) ||
        !Object.values(input.columnWidths).every(
          (width) =>
            typeof width === 'number' && Number.isFinite(width) && width >= 80 && width <= 2000,
        ))
    )
      throw new Error('非法视图');
    if (
      !Array.isArray(input.filters) ||
      !Array.isArray(input.sorts) ||
      !Array.isArray(input.visibleFieldIds) ||
      !input.visibleFieldIds.every((x) => typeof x === 'string')
    )
      throw new Error('非法视图');
    if (
      !input.filters.every(
        (f) =>
          plain(f) &&
          typeof f.fieldId === 'string' &&
          ['contains', 'eq', 'notEmpty'].includes(String(f.op)),
      ) ||
      !input.sorts.every(
        (s) =>
          plain(s) &&
          typeof s.fieldId === 'string' &&
          ['asc', 'desc'].includes(String(s.direction)),
      )
    )
      throw new Error('非法查询条件');
  }
  for (const key of ['title', 'name', 'icon'])
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new Error('非法名称');
  if (
    input.type === 'asset' &&
    (typeof input.assetPath !== 'string' ||
      !/^assets\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(input.assetPath) ||
      typeof input.byteSize !== 'number' ||
      typeof input.mime !== 'string')
  )
    throw new Error('非法附件元数据');
  return input as unknown as TioObject;
}
function validateBlocks(value: unknown, ids = new Set<string>()) {
  if (!Array.isArray(value)) throw new Error('非法正文');
  for (const b of value) {
    if (
      !plain(b) ||
      typeof b.id !== 'string' ||
      typeof b.type !== 'string' ||
      !plain(b.props) ||
      ids.has(b.id)
    )
      throw new Error('非法或重复 Block');
    ids.add(b.id);
    validateBlocks(b.children, ids);
  }
}
export const editable = (o: TioObject) => supportedFormat(o) && !o.deleted;
export function textBlock(text: string, type = 'paragraph'): Block {
  return {
    id: id('block'),
    type,
    props: {},
    content: [{ type: 'text', text, styles: {} }],
    children: [],
  };
}
export function titleOf(o: TioObject) {
  return o.title || o.name || '未命名';
}
export function plainText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(plainText).join(' ');
  if (plain(value)) {
    if (value.type === 'text' && typeof value.text === 'string') return value.text;
    return ['content', 'children', 'blocks', 'properties']
      .map((k) => plainText(value[k]))
      .join(' ');
  }
  return '';
}
/** Deterministic parent repair; deleted parents retain ownership for hidden subtrees. */
export function repairTree(objects: TioObject[]): TioObject[] {
  const map = new Map(objects.map((o) => [o.id, structuredClone(o)]));
  for (const o of [...map.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!['page', 'database'].includes(o.type)) continue;
    let p = o.parentId;
    const seen = new Set([o.id]);
    while (p) {
      const parent = map.get(p);
      if (seen.has(p) || !parent || !['page', 'database'].includes(parent.type)) {
        o.parentId = null;
        break;
      }
      seen.add(p);
      p = parent.parentId;
    }
  }
  return [...map.values()];
}
export function visible(o: TioObject, objects: TioObject[]): boolean {
  if (o.type === 'record') {
    const db = objects.find((x) => x.id === o.databaseId);
    if (!db || !visible(db, objects)) return false;
  }
  const map = new Map(objects.map((x) => [x.id, x]));
  let x: TioObject | undefined = o;
  const seen = new Set();
  while (x) {
    if (x.deleted || seen.has(x.id)) return false;
    seen.add(x.id);
    x = x.parentId ? map.get(x.parentId) : undefined;
  }
  return true;
}

/** Safe representation for unknown field values; never renders [object Object]. */
export function valueText(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return value == null ? '' : (JSON.stringify(value) ?? '');
  }
}
export { ObjectRegistry, createDefaultRegistry, type ObjectTypeDefinition } from './registry';
let sharedRegistry: ObjectRegistry | undefined;
export function registry() {
  if (!sharedRegistry) {
    sharedRegistry = new ObjectRegistry();
    for (const type of knownTypes) sharedRegistry.register({ type, currentVersion: 1, validate });
  }
  return sharedRegistry;
}
export const supportedFormat = (o: TioObject) => registry().supports(o);
export * from './repository';
export { applyCommit } from './commit';
export * from './host';
export * from './connection';
