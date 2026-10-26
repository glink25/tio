import { createFieldRegistry } from './fields';
import { knownTypes, validateEnvelope, validateBuiltin, type TioObject } from './index';
export interface ObjectTypeDefinition {
  type: string;
  currentVersion: number;
  validate: (value: TioObject) => TioObject;
  merge?: (
    base: TioObject | undefined,
    local: TioObject,
    remote: TioObject,
  ) => { merged: TioObject; warnings: string[]; recovered: unknown[] };
}
export class ObjectRegistry {
  private types = new Map<string, ObjectTypeDefinition>();
  register(definition: ObjectTypeDefinition) {
    if (this.types.has(definition.type))
      throw new Error(`Type already registered: ${definition.type}`);
    this.types.set(definition.type, definition);
  }
  get(type: string) {
    return this.types.get(type);
  }
  supports(value: TioObject) {
    return this.types.get(value.type)?.currentVersion === value.schemaVersion;
  }
  decode(input: unknown): TioObject {
    const value = validateEnvelope(input);
    const definition = this.types.get(value.type);
    if (!definition) return value;
    if (value.schemaVersion !== definition.currentVersion)
      throw new Error(`Unsupported schema: ${value.type} v${value.schemaVersion}`);
    return definition.validate(value);
  }
}
export function createDefaultRegistry() {
  const registry = new ObjectRegistry();
  for (const type of knownTypes)
    registry.register({ type, currentVersion: 1, validate: validateBuiltin });
  return registry;
}

/** A host and its editor share this instance; separate hosts never share plugin state. */
export function createDomain() {
  return { objects: createDefaultRegistry(), fields: createFieldRegistry() };
}
export type Domain = ReturnType<typeof createDomain>;
