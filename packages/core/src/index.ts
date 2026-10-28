import {
  validDocumentIcon,
  validDocumentCover,
  type DocumentIcon,
  type DocumentCover,
} from './media';
export * from './media';
export * from './app-mode';
export * from './automation';
import { validateAutomation } from './automation';
export * from './diagnostics';
import { validateFieldDefinition } from './fields';
import { assertJson } from './json';
import { contentMentions } from './mentions';
import { createDefaultRegistry } from './registry';
export { assertJson } from './json';
export * from './fields';
export * from './timestamps';
import { validateTimestamps } from './timestamps';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export * from './mentions';
export type FieldType =
  | 'title'
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiSelect'
  | 'relation'
  | 'mention'
  | 'formula'
  | 'rollup'
  | 'files'
  | 'status'
  | 'url'
  | 'email'
  | 'phone'
  | 'createdTime'
  | 'lastEditedTime';
export interface DateValue {
  start: string;
  end?: string;
  timeZone?: string;
}
export type RollupOperation =
  | 'values'
  | 'unique'
  | 'count'
  | 'countNotEmpty'
  | 'sum'
  | 'average'
  | 'min'
  | 'max'
  | 'earliest'
  | 'latest';
export interface Field {
  id: string;
  name: string;
  type: FieldType | (string & {});
  options?: { id: string; label: string; color?: string; group?: 'todo' | 'doing' | 'done' }[];
  numberFormat?: 'number' | 'percent' | 'currency';
  currency?: string;
  formula?: string;
  rollup?: { relationFieldId: string; targetFieldId: string; operation: RollupOperation };
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
  op: 'contains' | 'eq' | 'notEmpty' | 'empty' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';
  endValue?: unknown;
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
  icon?: DocumentIcon;
  cover?: DocumentCover | null;
  parentId?: string | null;
  order?: number;
  blocks?: Block[];
  appMode?: boolean;
  manualSync?: boolean;
  fields?: Field[];
  databaseId?: string;
  properties?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  layout?: string;
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
  'automation',
]);
export function object(
  type: string,
  workspaceId: string,
  props: Partial<TioObject> = {},
): TioObject {
  const timestamp = new Date().toISOString();
  return {
    id: id(type),
    workspaceId,
    type,
    schemaVersion: 1,
    ...(knownTypes.has(type) ? { createdAt: timestamp, updatedAt: timestamp } : {}),
    ...props,
  };
}
const plain = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
export function validateEnvelope(input: unknown): TioObject {
  assertJson(input);
  if (input && typeof input === 'object' && '$storage' in input)
    throw new Error('Reserved storage envelope');
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
  return input as unknown as TioObject;
}
export function validate(input: unknown): TioObject {
  return createDefaultRegistry().decode(input);
}
export function validateBuiltin(object: TioObject): TioObject {
  validateTimestamps(object);
  if (object.type === 'automation') validateAutomation(object);
  const input = object as unknown as Record<string, unknown> & { type: string };
  if (input.deleted !== undefined && typeof input.deleted !== 'boolean')
    throw new Error('非法删除状态');
  if (input.type === 'workspace' && input.id !== input.workspaceId)
    throw new Error('Workspace 身份不匹配');
  if (
    input.type === 'workspace' &&
    input.manualSync !== undefined &&
    typeof input.manualSync !== 'boolean'
  )
    throw new Error('Invalid manual sync setting');
  if (
    ['page', 'database'].includes(input.type) &&
    input.parentId !== null &&
    input.parentId !== undefined &&
    typeof input.parentId !== 'string'
  )
    throw new Error('非法父级');
  if (input.type === 'page' && input.appMode !== undefined && typeof input.appMode !== 'boolean')
    throw new Error('Invalid app mode');
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
      validateFieldDefinition(f as unknown as Field);
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
          ['contains', 'eq', 'notEmpty', 'empty', 'gt', 'gte', 'lt', 'lte', 'between'].includes(
            String(f.op),
          ),
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
  for (const key of ['title', 'name'])
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new Error('非法名称');
  if (input.icon !== undefined && !validDocumentIcon(input.icon)) throw new Error('非法图标');
  if (input.cover !== undefined && !validDocumentCover(input.cover)) throw new Error('非法封面');
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
    if (b.type === 'appSlice') {
      const p = b.props;
      if (
        typeof p.html !== 'string' ||
        p.html.length > 512_000 ||
        typeof p.title !== 'string' ||
        p.title.length > 200 ||
        p.runtimeVersion !== 1 ||
        typeof p.height !== 'number' ||
        !Number.isFinite(p.height) ||
        p.height < 160 ||
        p.height > 1200 ||
        typeof p.autoHeight !== 'boolean' ||
        !Array.isArray(b.children) ||
        b.children.length
      )
        throw new Error('Invalid App Slice');
    }
    contentMentions(b.content);
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
/** Code is a literal stream: adjacent text runs must not introduce spaces. */
export function codeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(codeText).join('');
  if (plain(value) && value.type === 'text' && typeof value.text === 'string') return value.text;
  return '';
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
/** Resolve only proven cycles; absent parents may belong to an incomplete remote scan. */
export function repairTree(objects: TioObject[]): TioObject[] {
  const byId = new Map(
    objects.filter((o) => ['page', 'database'].includes(o.type)).map((o) => [o.id, o]),
  );
  const visited = new Set<string>();
  const detached = new Set<string>();
  for (const object of byId.values()) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: TioObject | undefined = object;
    while (current && !visited.has(current.id)) {
      const position = positions.get(current.id);
      if (position !== undefined) {
        detached.add(path.slice(position).sort()[0]);
        break;
      }
      positions.set(current.id, path.length);
      path.push(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    for (const id of path) visited.add(id);
  }
  return objects.map((o) => (detached.has(o.id) ? { ...o, parentId: null } : o));
}
/** Build once per immutable projection; resolve each ancestry chain only once. */
export function visibility(objects: TioObject[]): (object: TioObject) => boolean {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const resolved = new Map<string, boolean>();
  return (object) => {
    const chain: string[] = [];
    const visiting = new Set<string>();
    let current: TioObject | undefined = object;
    let result = true;
    while (current) {
      const cached = resolved.get(current.id);
      if (cached !== undefined) {
        result = cached;
        break;
      }
      if (current.deleted || visiting.has(current.id)) {
        result = false;
        break;
      }
      visiting.add(current.id);
      chain.push(current.id);
      const parent = current.type === 'record' ? current.databaseId : current.parentId;
      if (!parent) break;
      current = byId.get(parent);
      if (!current) {
        result = false;
        break;
      }
    }
    for (const id of chain) resolved.set(id, result);
    return result;
  };
}
export function visible(object: TioObject, objects: TioObject[]): boolean {
  return visibility(objects)(object);
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
export {
  ObjectRegistry,
  createDefaultRegistry,
  createDomain,
  type Domain,
  type ObjectTypeDefinition,
} from './registry';
export const supportedFormat = (o: TioObject) => createDefaultRegistry().supports(o);
export * from './repository';
export { applyCommit } from './commit';
export * from './host';
export * from './connection';

export * from './content';
