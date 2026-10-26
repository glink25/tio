import type { Field } from './index';

export interface FieldDefinition {
  type: string;
  validate(value: unknown, field: Field): boolean;
  derived?: boolean;
}
export class FieldRegistry {
  private definitions = new Map<string, FieldDefinition>();
  register(definition: FieldDefinition) {
    if (this.definitions.has(definition.type))
      throw new Error(`Field already registered: ${definition.type}`);
    this.definitions.set(definition.type, definition);
    return this;
  }
  get(type: string) {
    return this.definitions.get(type);
  }
  validate(field: Field, value: unknown) {
    if (value == null) return;
    const definition = this.get(field.type);
    if (definition && (definition.derived || !definition.validate(value, field)))
      throw new Error(`Invalid ${field.type} value: ${field.id}`);
  }
}
const strings = (value: unknown) =>
  Array.isArray(value) &&
  value.every((item) => typeof item === 'string') &&
  new Set(value).size === value.length;
export function createFieldRegistry() {
  const registry = new FieldRegistry();
  for (const type of ['title', 'text', 'select'])
    registry.register({ type, validate: (value) => typeof value === 'string' });
  registry.register({
    type: 'number',
    validate: (value) => typeof value === 'number' && Number.isFinite(value),
  });
  registry.register({ type: 'boolean', validate: (value) => typeof value === 'boolean' });
  registry.register({ type: 'multiSelect', validate: strings });
  registry.register({
    type: 'relation',
    validate: (value, field) =>
      field.multiple === false ? typeof value === 'string' : strings(value),
  });
  registry.register({
    type: 'date',
    validate: (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const date = (value as { date?: unknown }).date;
      return (
        typeof date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        Number.isFinite(Date.parse(date)) &&
        new Date(date).toISOString().slice(0, 10) === date
      );
    },
  });
  for (const type of ['formula', 'rollup'])
    registry.register({ type, derived: true, validate: () => false });
  return registry;
}
export const validateValue = (field: Field, value: unknown) =>
  createFieldRegistry().validate(field, value);
