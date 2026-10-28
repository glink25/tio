import { sessionAutomationCapabilities } from '@tio/automation';
import { object, type AutomationAction } from '@tio/core';
import { describe, expect, it } from 'vitest';

import {
  blankFlow,
  blankAction,
  compatible,
  flowIssues,
  variables,
  operators,
  comparisonField,
  toRule,
  editFlow,
} from '../../../apps/web/src/features/automation/model';
const database = object('database', 'w', {
  id: 'db',
  name: 'Tasks',
  fields: [
    { id: 'title', name: 'Name', type: 'title' },
    { id: 'count', name: 'Count', type: 'number' },
    { id: 'options', name: 'Tags', type: 'multiSelect', options: [{ id: 'one', label: 'One' }] },
  ],
});
const action = (id: string): AutomationAction => ({
  id,
  kind: 'record.create',
  databaseId: 'db',
  properties: { title: { kind: 'literal', value: 'Typed' } },
});
const make = () => ({
  ...blankFlow(),
  trigger: { kind: 'page.created' as const },
  actions: [action('first')],
});
describe('automation flow drafts', () => {
  it('does not choose triggers, databases or actions for a new flow', () => {
    expect(blankFlow().trigger).toBeUndefined();
    expect(blankFlow().actions).toEqual([]);
    expect(blankAction()).toMatchObject({ databaseId: '' });
    expect(blankAction().kind).toBeUndefined();
    expect(flowIssues(blankFlow(), [database], sessionAutomationCapabilities)).toHaveProperty(
      'trigger',
    );
  });
  it('serializes only complete rules and preserves unknown configuration', () => {
    const rule = toRule(make(), 'w', false);
    expect(rule.enabled).toBe(false);
    expect(rule.type).toBe('automation');
    rule.future = { opaque: true };
    const draft = editFlow(rule);
    draft.name = 'Renamed';
    expect(toRule(draft, 'w', true)).toMatchObject({ enabled: true, future: { opaque: true } });
    expect(() => toRule(blankFlow(), 'w', false)).toThrow();
  });
  it('does not offer before values for creation or after values for deletion', () => {
    const created = variables(make(), [database]);
    expect(created.some((v) => v.path.startsWith('before.'))).toBe(false);
    const deleted = variables({ ...make(), trigger: { kind: 'page.deleted' } }, [database]);
    expect(deleted.some((v) => v.path.startsWith('after.'))).toBe(false);
    expect(deleted.some((v) => v.path === 'before.id')).toBe(true);
  });
  it('marks references invalid after deleting or moving their source step', () => {
    const first = action('first');
    const next: AutomationAction = {
      id: 'second',
      kind: 'record.update',
      databaseId: 'db',
      target: { kind: 'record', id: { kind: 'reference', path: 'steps.first.ids' } },
      properties: { count: { kind: 'literal', value: 2 } },
    };
    const draft = { ...make(), actions: [first, next] };
    expect(flowIssues(draft, [database], sessionAutomationCapabilities)).toEqual({});
    expect(
      flowIssues({ ...draft, actions: [next, first] }, [database], sessionAutomationCapabilities),
    ).toHaveProperty('actions.second.target', 'automation.invalidReference');
    expect(
      flowIssues({ ...draft, actions: [next] }, [database], sessionAutomationCapabilities),
    ).toHaveProperty('actions.second.target');
  });
  it('checks property types, missing fields and invalid template variables before saving', () => {
    const first = {
      ...action('first'),
      properties: { count: { kind: 'literal' as const, value: 'unfinished number' } },
      body: { mode: 'append' as const, template: '{{before.id}}' },
    };
    const issues = flowIssues(
      { ...make(), actions: [first] },
      [database],
      sessionAutomationCapabilities,
    );
    expect(issues).toHaveProperty('actions.first.properties.count', 'automation.invalidInput');
    expect(issues).toHaveProperty('actions.first.body', 'automation.invalidReference');
    const missing = flowIssues(
      {
        ...make(),
        actions: [{ ...action('first'), properties: { removed: { kind: 'literal', value: '' } } }],
      },
      [database],
      sessionAutomationCapabilities,
    );
    expect(missing).toHaveProperty('actions.first.properties.removed', 'automation.missingField');
  });
  it('does not permit trigger targets from page events or another database', () => {
    const update: AutomationAction = {
      id: 'update',
      kind: 'record.delete',
      databaseId: 'db',
      target: { kind: 'trigger' },
    };
    expect(
      flowIssues({ ...make(), actions: [update] }, [database], sessionAutomationCapabilities),
    ).toHaveProperty('actions.update.target');
    expect(
      flowIssues(
        { ...make(), trigger: { kind: 'record.created', databaseId: 'db' }, actions: [update] },
        [database],
        sessionAutomationCapabilities,
      ),
    ).toEqual({});
  });
  it('filters scalar variables by value type and step results by database', () => {
    const vars = variables(
      {
        ...make(),
        trigger: { kind: 'record.created', databaseId: 'db' },
        actions: [action('first'), action('second')],
      },
      [database],
      1,
    );
    expect(
      compatible(
        vars.find((v) => v.path === 'trigger.properties.count')!,
        database.fields![0],
      ),
    ).toBe(false);
    const ids = vars.find((v) => v.path === 'steps.first.ids')!;
    expect(compatible(ids, database.fields![0])).toBe(false);
    expect(compatible(ids, database.fields![0], 'db')).toBe(true);
    expect(compatible(ids, database.fields![0], 'other')).toBe(false);
  });
  it('uses type-appropriate operators and scalar values for multi-value equality filters', () => {
    expect(operators(database.fields![1])).toContain('between');
    expect(operators({ id: 'done', name: 'Done', type: 'boolean' })).not.toContain('contains');
    const field = database.fields![2];
    expect(comparisonField(field, 'eq').type).toBe('select');
    const draft = {
      ...make(),
      trigger: { kind: 'record.created' as const, databaseId: 'db' },
      condition: {
        mode: 'all' as const,
        filters: [
          {
            fieldId: field.id,
            op: 'eq' as const,
            value: { kind: 'literal' as const, value: 'one' },
          },
        ],
      },
    };
    expect(flowIssues(draft, [database], sessionAutomationCapabilities)).toEqual({});
  });
  it('cannot enable unsupported rules', () => {
    expect(
      flowIssues(make(), [database], { ...sessionAutomationCapabilities, actions: [] }),
    ).toHaveProperty('actions.first', 'automation.unsupportedRule');
  });
  it.each([false, true])(
    'offers a dynamic trigger page for a mention property with multiple=%s and a scalar equality filter',
    (multiple) => {
      const mentionField = { id: 'post', name: 'post', type: 'mention', multiple };
      const pageMap = { ...database, fields: [...database.fields!, mentionField] };
      const vars = variables(make(), [pageMap]);
      const compatiblePages = vars.filter((v) => compatible(v, mentionField));
      expect(compatiblePages.find((v) => v.path.startsWith('trigger.'))?.path).toBe(
        multiple ? 'trigger.mentions' : 'trigger.mention',
      );
      expect(
        compatible(
          vars.find((v) => v.path === 'trigger.id')!,
          mentionField,
        ),
      ).toBe(false);
      const creation = {
        ...make(),
        actions: [
          {
            ...action('add'),
            properties: {
              post: {
                kind: 'reference' as const,
                path: multiple ? 'trigger.mentions' : 'trigger.mention',
              },
            },
          },
        ],
      };
      expect(flowIssues(creation, [pageMap], sessionAutomationCapabilities)).toEqual({});
      const deletion = {
        ...make(),
        trigger: { kind: 'page.deleted' as const, parentId: 'post' },
        actions: [
          {
            id: 'delete',
            kind: 'record.delete' as const,
            databaseId: pageMap.id,
            target: {
              kind: 'matching' as const,
              condition: {
                mode: 'all' as const,
                filters: [
                  {
                    fieldId: 'post',
                    op: 'eq' as const,
                    value: { kind: 'reference' as const, path: 'trigger.mention' },
                  },
                ],
              },
            },
          },
        ],
      };
      expect(flowIssues(deletion, [pageMap], sessionAutomationCapabilities)).toEqual({});
      const filterChoices = variables(deletion, [pageMap]).filter((v) =>
        compatible(v, comparisonField(mentionField, 'eq')),
      );
      expect(filterChoices.some((v) => v.path === 'trigger.mention')).toBe(true);
      expect(filterChoices.some((v) => v.path === 'trigger.mentions')).toBe(false);
      expect(filterChoices.some((v) => v.path.startsWith('after.'))).toBe(false);
      expect(
        variables({ ...make(), trigger: { kind: 'record.created', databaseId: pageMap.id } }, [
          pageMap,
        ]).some((v) => v.path === 'trigger.mention'),
      ).toBe(false);
    },
  );
});
