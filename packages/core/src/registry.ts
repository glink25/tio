import { knownTypes, validate, type TioObject } from './index';
export interface ObjectTypeDefinition {
  type: string;
  currentVersion: number;
  validate: (value: TioObject) => TioObject;
  /** A migration at key N transforms version N into N + 1, preserving unknown fields. */
  migrations?: Record<number, (value: TioObject) => TioObject>;
}
export class ObjectRegistry {
  private types = new Map<string, ObjectTypeDefinition>();
  register(definition: ObjectTypeDefinition) {
    if (this.types.has(definition.type))
      throw new Error(`Type already registered: ${definition.type}`);
    this.types.set(definition.type, definition);
  }
  supports(value: TioObject) {
    return this.types.get(value.type)?.currentVersion === value.schemaVersion;
  }
  decode(input: unknown): TioObject {
    let value = validate(input);
    const definition = this.types.get(value.type);
    if (!definition || value.schemaVersion > definition.currentVersion) return value;
    const original = { id: value.id, workspaceId: value.workspaceId, type: value.type };
    while (value.schemaVersion < definition.currentVersion) {
      const version = value.schemaVersion;
      const migrate = definition.migrations?.[version];
      if (!migrate) throw new Error(`Missing migration: ${value.type} v${version}`);
      const next = migrate(structuredClone(value));
      if (
        next.schemaVersion !== version + 1 ||
        next.id !== original.id ||
        next.workspaceId !== original.workspaceId ||
        next.type !== original.type
      )
        throw new Error('Migration changed identity or skipped a version');
      value = validate(next);
    }
    return definition.validate(value);
  }
}
export function createDefaultRegistry() {
  const registry = new ObjectRegistry();
  for (const type of knownTypes) registry.register({ type, currentVersion: 1, validate });
  return registry;
}
