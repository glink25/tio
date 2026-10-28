import {
  validAutomationPath,
  type AutomationValue,
  type TioObject,
  type Block,
  type CommittedMutation,
} from '@tio/core';

import { AutomationError } from './errors';
export interface EventContext {
  id: string;
  mutation: CommittedMutation;
  before?: TioObject;
  after: TioObject;
  steps: Map<string, string[]>;
}
export function bodyText(blocks: Block[] = []): string {
  const inline = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(inline).join('');
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      if (typeof item.text === 'string') return item.text;
      if (Array.isArray(item.rows)) return item.rows.map(inline).join('\n');
      if (Array.isArray(item.cells)) return item.cells.map(inline).join('\t');
      return item.content ? inline(item.content) : '';
    }
    return '';
  };
  return blocks
    .flatMap((block) => [
      inline(block.content),
      ...(block.children.length ? [bodyText(block.children)] : []),
    ])
    .join('\n');
}
export function reference(path: string, context: EventContext): unknown {
  if (!validAutomationPath(path)) throw new AutomationError('variable');
  if (path === 'event.id') return context.id;
  if (path === 'event.time') return context.mutation.timestamp;
  const [source, key, fieldId] = path.split('.');
  if (source === 'steps') {
    const ids = context.steps.get(key);
    if (!ids) throw new AutomationError('variable');
    return [...ids];
  }
  const object =
    source === 'before'
      ? context.before
      : source === 'after'
        ? context.after
        : context.after.deleted
          ? context.before
          : context.after;
  if (!object) throw new AutomationError('variable');
  if (key === 'mention' || key === 'mentions') {
    if (object.type !== 'page') throw new AutomationError('variable');
    const mention = { workspaceId: object.workspaceId, kind: 'page' as const, id: object.id };
    return key === 'mentions' ? [mention] : mention;
  }
  if (key === 'body') return bodyText(object.blocks);
  if (key === 'properties') {
    if (!object.properties || !Object.hasOwn(object.properties, fieldId))
      throw new AutomationError('variable');
    return structuredClone(object.properties[fieldId]);
  }
  if (key === 'title') {
    if (typeof object.title === 'string') return object.title;
    throw new AutomationError('variable');
  }
  return object.id;
}
export function resolve(value: AutomationValue, context: EventContext): unknown {
  return value.kind === 'literal' ? structuredClone(value.value) : reference(value.path, context);
}
export function renderTemplate(template: string, context: EventContext): string {
  const result = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_token, path: string) => {
    const value = reference(path.trim(), context);
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
  // Validate syntax before interpolation: user text can itself contain braces.
  if (template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '').match(/\{\{|\}\}/))
    throw new AutomationError('variable');
  return result;
}
