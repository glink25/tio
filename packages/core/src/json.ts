/** Validate the actual persistence boundary, not arbitrary editor/runtime objects. */
export function assertJson(value: unknown, depth = 0): void {
  if (depth > 128) throw new Error('JSON nesting exceeds 128 levels');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, depth + 1);
    return;
  }
  if (
    value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    for (const item of Object.values(value)) if (item !== undefined) assertJson(item, depth + 1);
    return;
  }
  throw new Error('Expected JSON data');
}
