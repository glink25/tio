import { validDatePart } from './fields';
import { knownTypes, type TioObject } from './index';

export interface SystemTimestamps {
  createdAt: string;
  updatedAt: string;
}
export function isSystemTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    validDatePart(value)
  );
}
export function validateTimestamps(
  object: TioObject,
): asserts object is TioObject & SystemTimestamps {
  if (
    !isSystemTime(object.createdAt) ||
    !isSystemTime(object.updatedAt) ||
    Date.parse(object.updatedAt) < Date.parse(object.createdAt)
  )
    throw new Error('Invalid system timestamps');
}
const navigation = new Set(['createdAt', 'updatedAt', 'parentId', 'order', 'deleted']);
const view = new Set([
  'layout',
  'visibleFieldIds',
  'fieldOrder',
  'columnWidths',
  'filters',
  'sorts',
  'groupBy',
]);
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]),
    );
  return value;
}
export function sameContent(a: TioObject, b: TioObject): boolean {
  const content = (object: TioObject) =>
    normalize(
      Object.fromEntries(
        Object.entries(object).filter(
          ([key]) =>
            !navigation.has(key) &&
            !(object.type === 'page' && key === 'appMode') &&
            !(object.type === 'databaseView' && view.has(key)),
        ),
      ),
    );
  return JSON.stringify(content(a)) === JSON.stringify(content(b));
}
/** One deterministic clock per intent, independent of persistence and transport. */
export function stampContent(
  previous: TioObject | undefined,
  next: TioObject,
  timestamp: string,
): TioObject {
  if (!knownTypes.has(next.type)) return next;
  if (!isSystemTime(timestamp)) throw new Error('Invalid command timestamp');
  if (!previous) return { ...next, createdAt: timestamp, updatedAt: timestamp };
  validateTimestamps(previous);
  return {
    ...next,
    createdAt: previous.createdAt,
    updatedAt:
      sameContent(previous, next) || Date.parse(timestamp) <= Date.parse(previous.updatedAt)
        ? previous.updatedAt
        : timestamp,
  };
}
