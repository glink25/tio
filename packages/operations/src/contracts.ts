import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9_-]+$/);
const version = z.string().min(1).max(100);
const json = z.json();
const properties = z.record(z.string(), json);
const field = z.looseObject({
  id: identifier.optional(),
  name: z.string(),
  type: z.enum([
    'title',
    'text',
    'number',
    'boolean',
    'date',
    'select',
    'multiSelect',
    'relation',
    'mention',
    'formula',
    'rollup',
    'files',
    'status',
    'url',
    'email',
    'phone',
    'createdTime',
    'lastEditedTime',
  ]),
  options: z
    .array(
      z.looseObject({
        id: identifier,
        label: z.string(),
        color: z.string().optional(),
        group: z.enum(['todo', 'doing', 'done']).optional(),
      }),
    )
    .optional(),
  targetDatabaseId: identifier.optional(),
  multiple: z.boolean().optional(),
  formula: z.string().optional(),
});
const block = z.looseObject({
  id: identifier,
  type: z.string(),
  props: properties,
  content: json,
  children: z.array(json),
});
const blocks = z.array(block);
const target = { id: identifier, version };
const pageChanges = z.strictObject({
  title: z.string().optional(),
  icon: json.optional(),
  cover: json.optional(),
  appMode: z.boolean().optional(),
});
const filter = z.looseObject({
  fieldId: identifier,
  op: z.enum(['eq', 'contains', 'empty', 'notEmpty', 'gt', 'gte', 'lt', 'lte', 'between']),
  value: json.optional(),
  endValue: json.optional(),
});
const sort = z.looseObject({ fieldId: identifier, direction: z.enum(['asc', 'desc']) });
const viewChanges = z.strictObject({
  name: z.string().optional(),
  layout: z.enum(['table', 'board', 'list', 'gallery', 'calendar']).optional(),
  filters: z.array(filter).optional(),
  sorts: z.array(sort).optional(),
  visibleFieldIds: z.array(identifier).optional(),
  fieldOrder: z.array(identifier).optional(),
  columnWidths: properties.optional(),
  groupBy: identifier.nullable().optional(),
});
const automationValue = z.union([
  z.strictObject({ kind: z.literal('literal'), value: json }),
  z.strictObject({
    kind: z.literal('reference'),
    path: z
      .string()
      .describe(
        'trigger/before/after.id|title|body|mention|mentions|properties.<fieldId>, event.id|time, steps.<actionId>.ids',
      ),
  }),
]);
const condition = z.strictObject({
  mode: z.enum(['all', 'any']),
  filters: z.array(
    z.strictObject({
      fieldId: identifier,
      op: z.enum(['eq', 'contains', 'empty', 'notEmpty', 'gt', 'gte', 'lt', 'lte', 'between']),
      value: automationValue.optional(),
      endValue: automationValue.optional(),
    }),
  ),
});
const ruleChanges = z.strictObject({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  trigger: z
    .strictObject({
      kind: z.enum([
        'page.created',
        'page.deleted',
        'record.created',
        'record.properties',
        'record.body',
        'record.deleted',
        'record.entersCondition',
      ]),
      databaseId: identifier.optional(),
      parentId: identifier.nullable().optional(),
      fieldIds: z.array(identifier).optional(),
    })
    .optional(),
  condition: condition.nullable().optional(),
  actions: z
    .array(
      z.looseObject({
        id: identifier,
        kind: z.enum(['record.create', 'record.update', 'record.delete']),
        databaseId: identifier,
        target: z
          .union([
            z.strictObject({ kind: z.literal('trigger') }),
            z.strictObject({ kind: z.literal('record'), id: automationValue }),
            z.strictObject({ kind: z.literal('matching'), condition }),
          ])
          .optional(),
        properties: z.record(z.string(), automationValue).optional(),
        body: z
          .strictObject({ mode: z.enum(['append', 'replace']), template: z.string() })
          .optional(),
      }),
    )
    .optional(),
});
const operations = {
  'context.get': [
    false,
    'Read the current workspace and effective capabilities.',
    z.strictObject({}),
  ],
  'objects.list': [
    false,
    'List objects of one type, including deleted objects when requested. Page by nextCursor; IDs are stable.',
    z.strictObject({
      type: z.enum(['page', 'database', 'record', 'databaseView', 'automation']),
      databaseId: identifier.optional(),
      includeDeleted: z.boolean().optional(),
      cursor: identifier.optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
  ],
  'objects.get': [
    false,
    'Read an object, its full native content and opaque version. Use this version for subsequent updates/deletion.',
    z.strictObject({ id: identifier }),
  ],
  'objects.search': [
    false,
    'Search readable pages, databases and records.',
    z.strictObject({
      text: z.string(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
  ],
  'records.query': [
    false,
    'Query database records using native filters and sorts; returns objects and versions.',
    z.strictObject({
      databaseId: identifier,
      viewId: identifier.optional(),
      filters: z.array(filter).optional(),
      sorts: z.array(sort).optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
  ],
  'pages.create': [
    true,
    'Create a page with native blocks. Generate stable IDs for new blocks; read operation examples first.',
    z.strictObject({
      title: z.string(),
      parentId: identifier.nullable().optional(),
      blocks: blocks.default([]),
    }),
  ],
  'pages.update': [
    true,
    'Update page metadata without replacing unrelated data. Also accepts record metadata icon/cover.',
    z.strictObject({ ...target, changes: pageChanges }),
  ],
  'blocks.insert': [
    true,
    'Insert native blocks into a page/record; optionally within parentBlockId and beforeId. Preserves all existing content.',
    z.strictObject({
      ...target,
      blocks,
      parentBlockId: identifier.optional(),
      beforeId: identifier.optional(),
    }),
  ],
  'blocks.update': [
    true,
    'Patch a single native block. Props merge; content/children replace only when explicitly supplied. Preserve unknown content.',
    z.strictObject({
      ...target,
      blockId: identifier,
      changes: z.strictObject({
        type: z.string().optional(),
        props: properties.optional(),
        content: json.optional(),
        children: blocks.optional(),
      }),
    }),
  ],
  'blocks.remove': [
    true,
    'Remove one block subtree from a page or record.',
    z.strictObject({ ...target, blockId: identifier }),
  ],
  'objects.delete': [
    true,
    'Soft-delete a page, database, record, view or automation. Never permanently deletes a workspace.',
    z.strictObject(target),
  ],
  'objects.restore': [
    true,
    'Restore a soft-deleted object using its version.',
    z.strictObject(target),
  ],
  'databases.create': [
    true,
    'Create a database and default table view as one undoable operation. Field IDs are optional on create.',
    z.strictObject({
      name: z.string(),
      parentId: identifier.nullable().optional(),
      fields: z.array(field).optional(),
    }),
  ],
  'databases.update': [true, 'Rename a database.', z.strictObject({ ...target, name: z.string() })],
  'records.create': [
    true,
    'Create a record; property keys are field IDs. Derived/system fields are read-only.',
    z.strictObject({ databaseId: identifier, properties, blocks: blocks.default([]) }),
  ],
  'records.update': [
    true,
    'Merge properties into an existing record. Use block operations for its body.',
    z.strictObject({ ...target, properties }),
  ],
  'fields.create': [
    true,
    'Add a database field, with optional stable field ID.',
    z.strictObject({ ...target, field }),
  ],
  'fields.update': [
    true,
    'Modify a field definition without changing its type or cardinality.',
    z.strictObject({ ...target, fieldId: identifier, changes: properties }),
  ],
  'fields.delete': [
    true,
    'Remove a field definition. Existing stored values are retained by the data contract.',
    z.strictObject({ ...target, fieldId: identifier }),
  ],
  'views.create': [
    true,
    'Create a database view.',
    z.strictObject({ databaseId: identifier, changes: viewChanges }),
  ],
  'views.update': [
    true,
    'Modify a database view.',
    z.strictObject({ ...target, changes: viewChanges }),
  ],
  'automations.create': [
    true,
    'Create a complete rule; disabled by default. Use native trigger/condition/actions; consult automation schema.',
    ruleChanges.required({ name: true, trigger: true, actions: true }),
  ],
  'automations.update': [
    true,
    'Modify a rule or explicitly enable/disable it. Enabling does not replay past events.',
    z.strictObject({ ...target, changes: ruleChanges }),
  ],
  'automations.runs': [
    false,
    'Read provider automation capabilities and current run history. Main writes and derived runs have separate outcomes.',
    z.strictObject({}),
  ],
} as const;
export type OperationName = keyof typeof operations;
const objectReadSchema = {
  type: 'object',
  properties: {
    object: { type: 'object', required: ['id', 'workspaceId', 'type', 'schemaVersion'] },
    version: { type: 'string' },
  },
  required: ['object', 'version'],
};
function outputSchema(name: string, write: boolean): Record<string, unknown> {
  if (write)
    return {
      type: 'object',
      properties: {
        objects: { type: 'array', items: objectReadSchema },
        persistence: { const: 'confirmed' },
        remoteSync: { const: 'host-managed' },
      },
      required: ['objects', 'persistence', 'remoteSync'],
    };
  if (name === 'objects.get') return objectReadSchema;
  if (name === 'objects.list' || name === 'records.query')
    return {
      type: 'object',
      properties: {
        objects: { type: 'array', items: objectReadSchema },
        nextCursor: { type: ['string', 'null'] },
      },
      required: ['objects', 'nextCursor'],
    };
  if (name === 'context.get')
    return {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        workspace: objectReadSchema,
        writable: { type: 'boolean' },
        automation: { type: ['object', 'null'] },
      },
      required: ['sessionId', 'workspace', 'writable', 'automation'],
    };
  if (name === 'objects.search')
    return {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object' } },
        next: { type: 'string' },
        complete: { type: 'boolean' },
      },
      required: ['items', 'complete'],
    };
  return {
    type: 'object',
    properties: {
      capabilities: { type: ['object', 'null'] },
      runs: { type: 'array', items: { type: 'object' } },
    },
    required: ['capabilities', 'runs'],
  };
}
export const definitions = Object.entries(operations).map(
  ([name, [write, description, schema]]) => ({
    name,
    write,
    description,
    inputSchema: z.toJSONSchema(schema),
    outputSchema: outputSchema(name, write),
  }),
);
export function definition(name: string) {
  const value = definitions.find((d) => d.name === name);
  return value;
}
export function parseInput(name: OperationName, input: unknown) {
  return operations[name][2].parse(input) as Record<string, any>;
}
export const toolArguments = {
  operation: { type: 'string', enum: definitions.map((d) => d.name) },
  input: { type: 'object', additionalProperties: true },
};
export { z };
