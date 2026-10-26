import { isDateValue, object, validateValue, validate, type Field } from '@tio/core';
import {
  compileFormula,
  formulaSource,
  createEvaluator,
  dateAdd,
  dateBetween,
  displayValue,
  evaluateFormula,
  parseFormula,
  queryRecords,
  zonedDateTime,
} from '@tio/database';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore } from '@tio/local-store';
import { MemoryProvider } from '@tio/provider-memory';
import { SyncCore } from '@tio/sync';
import { WorkspaceRuntime } from '@tio/workspace';
import { describe, expect, it, vi } from 'vitest';

import { executeCommand } from '../packages/workspace/src/commands';

const field = (type: string, extra: Partial<Field> = {}): Field => ({
  id: type,
  name: type,
  type,
  ...extra,
});
const db = (id: string, fields: Field[]) => object('database', 'w', { id, fields });
const record = (id: string, databaseId: string, properties: Record<string, unknown>) =>
  object('record', 'w', { id, databaseId, properties, blocks: [] });
const run = (source: string) =>
  evaluateFormula(parseFormula(source), () => null, new Date('2026-10-26T12:00:00Z'));

describe('typed database fields', () => {
  it('validates dates, time zones, intervals and rejects the replaced date shape', () => {
    for (const value of [
      { start: '2026-02-28' },
      {
        start: '2026-10-26T08:00:00+08:00',
        end: '2026-10-26T09:00:00+08:00',
        timeZone: 'Asia/Shanghai',
      },
    ])
      expect(() => validateValue(field('date'), value)).not.toThrow();
    for (const value of [
      { date: '2026-10-26' },
      { start: '2026-02-30' },
      { start: '2026-10-26', end: '2026-10-25' },
      { start: '2026-10-26', timeZone: 'Unknown/Zone' },
      { start: '2026-10-26', end: '2026-10-27T00:00:00Z' },
    ])
      expect(() => validateValue(field('date'), value)).toThrow();
  });
  it('validates option membership, attachment references and contact formats', () => {
    expect(() => validateValue(field('files'), ['asset:file'])).not.toThrow();
    expect(() => validateValue(field('files'), ['https://example.com/a'])).toThrow();
    expect(() => validateValue(field('files'), ['asset:file', 'asset:file'])).toThrow();
    expect(() => validateValue(field('url'), 'javascript:alert(1)')).toThrow();
    expect(() => validateValue(field('email'), 'bad')).toThrow();
    expect(() => validateValue(field('phone'), '+86 (123) 456-789')).not.toThrow();
    expect(() =>
      validateValue(field('status', { options: [{ id: 'done', label: 'Done' }] }), 'missing'),
    ).toThrow();
    expect(() => validate({ ...db('d', [field('number', { currency: 'bad' })]) })).toThrow();
  });
  it.each(['formula', 'rollup', 'createdTime', 'lastEditedTime'])(
    'rejects all writes to %s, including null',
    (type) => {
      for (const value of [null, 1, '']) expect(() => validateValue(field(type), value)).toThrow();
    },
  );
  it('converts wall times, rejects DST gaps and preserves calendar semantics', () => {
    expect(zonedDateTime('2026-10-26T09:00', 'Asia/Shanghai')).toBe('2026-10-26T09:00:00+08:00');
    expect(() => zonedDateTime('2026-03-08T02:30', 'America/New_York')).toThrow();
    expect(dateAdd({ start: '2026-01-31' }, 1, 'months')).toEqual({ start: '2026-02-28' });
    expect(dateAdd({ start: '2024-02-29' }, 1, 'years')).toEqual({ start: '2025-02-28' });
    expect(
      dateAdd({ start: '2026-03-07T09:00:00-05:00', timeZone: 'America/New_York' }, 1, 'days')
        .start,
    ).toBe('2026-03-08T09:00:00-04:00');
    expect(dateBetween({ start: '2026-03-01' }, { start: '2026-02-01' }, 'months')).toBe(1);
    expect(
      dateBetween(
        { start: '2026-03-08T09:00:00-04:00', timeZone: 'America/New_York' },
        { start: '2026-03-07T09:00:00-05:00', timeZone: 'America/New_York' },
        'days',
      ),
    ).toBe(1);
  });
});
describe('restricted formulas', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['if(2 > 1 and true, "yes", "no")', 'yes'],
    ['if(false, 1 / 0, 4)', 4],
    ['empty(null) || empty("")', true],
    ['toNumber("12.5") + abs(-2)', 14.5],
    ['round(2.6) + floor(2.6) + ceil(2.1)', 8],
    ['min(4, 2) + max(1, 3)', 5],
    ['concat(lower("HI"), upper("there"))', 'hiTHERE'],
    ['length(replace("abc", "b", "xx"))', 4],
    ['contains("hello", "ell")', true],
    ['format(12)', '12'],
    ['formatDate(dateAdd(today(), 2, "days"), "YYYY-MM-DD")', '2026-10-28'],
    ['dateBetween(dateAdd(today(), 1, "weeks"), today(), "days")', 7],
  ])('%s', (expression, expected) => expect(run(expression)).toEqual(expected));
  it('rejects invalid syntax, types, argument counts, unsafe expressions and zero division', () => {
    for (const expression of [
      '1 / 0',
      '1 + "x"',
      'if(1, 2, 3)',
      'abs()',
      'window.alert(1)',
      'constructor()',
      '1; 2',
      'unknown(1)',
      '('.repeat(101) + '1' + ')'.repeat(101),
    ])
      expect(() => run(expression)).toThrow();
    expect(isDateValue(run('dateStart(now())'))).toBe(true);
    expect(isDateValue(run('dateEnd(now())'))).toBe(true);
  });
  it('binds IDs, preserves renames, rejects ambiguous and missing references', () => {
    const fields = [field('number', { id: 'amount', name: 'Cost' })];
    const source = compileFormula('prop("Cost") * 2', fields);
    expect(source).toContain('prop("amount")');
    fields[0].name = 'Renamed';
    expect(compileFormula(source, fields)).toBe(source);
    expect(formulaSource(source, fields)).toContain('prop("Renamed")');
    expect(() => compileFormula('prop("Cost")', fields)).toThrow('Missing');
    expect(() =>
      compileFormula('prop("Same")', [
        field('text', { id: 'a', name: 'Same' }),
        field('text', { id: 'b', name: 'Same' }),
      ]),
    ).toThrow('Ambiguous');
  });
});
describe('shared derived values and queries', () => {
  function fixture() {
    const projects = db('projects', [
      field('relation', { id: 'tasks', targetDatabaseId: 'tasks' }),
      field('rollup', {
        id: 'total',
        rollup: { relationFieldId: 'tasks', targetFieldId: 'cost', operation: 'sum' },
      }),
      field('formula', { id: 'double', formula: 'prop("total") * 2' }),
    ]);
    const tasks = db('tasks', [field('number', { id: 'cost' }), field('date', { id: 'due' })]);
    return {
      projects,
      tasks,
      rows: [
        record('p1', 'projects', { tasks: ['a', 'b', 'missing', 'deleted'] }),
        record('p2', 'projects', { tasks: ['b'] }),
      ],
      children: [
        record('a', 'tasks', { cost: 4, due: { start: '2026-10-26' } }),
        record('b', 'tasks', { cost: 6, due: { start: '2026-10-27' } }),
        { ...record('deleted', 'tasks', { cost: 100 }), deleted: true },
      ],
    };
  }
  it('calculates formula → rollup → relation, ignores deleted references and invalidates by snapshot', () => {
    const { projects, tasks, rows, children } = fixture();
    const objects = [projects, tasks, ...rows, ...children];
    expect(createEvaluator(objects).read(rows[0], projects.fields![2])).toEqual({ value: 20 });
    const next = objects.map((o) =>
      o.id === 'a' ? { ...o, properties: { ...o.properties, cost: 10 } } : o,
    );
    expect(createEvaluator(next).read(rows[0], projects.fields![2])).toEqual({ value: 32 });
    expect(rows[0].properties).not.toHaveProperty('double');
  });
  it.each([
    ['values', 'cost', [4, 6]],
    ['unique', 'cost', [4, 6]],
    ['count', 'cost', 2],
    ['countNotEmpty', 'cost', 2],
    ['average', 'cost', 5],
    ['min', 'cost', 4],
    ['max', 'cost', 6],
    ['earliest', 'due', { start: '2026-10-26' }],
    ['latest', 'due', { start: '2026-10-27' }],
  ] as const)('aggregates %s', (operation, targetFieldId, value) => {
    const { projects, tasks, rows, children } = fixture();
    const target = field('rollup', {
      rollup: { relationFieldId: 'tasks', targetFieldId, operation },
    });
    expect(createEvaluator([projects, tasks, ...rows, ...children]).read(rows[0], target)).toEqual({
      value,
    });
  });
  it('reports cycles, missing properties and incompatible aggregates without crashing queries', () => {
    const fields = [
      field('formula', { id: 'a', formula: 'prop("b")' }),
      field('formula', { id: 'b', formula: 'prop("a")' }),
    ];
    const schema = db('d', fields),
      row = record('r', 'd', {});
    expect(createEvaluator([schema, row]).read(row, fields[0]).error).toMatch(/Circular/);
    expect(
      createEvaluator([schema, row]).read(row, field('formula', { formula: 'prop("missing")' }))
        .error,
    ).toMatch(/Missing/);
  });
  it('sorts and filters numeric derived values and date instants with stable empty ordering', () => {
    const { projects, tasks, rows, children } = fixture();
    const objects = [projects, tasks, ...rows, ...children];
    const view = object('databaseView', 'w', {
      sorts: [{ fieldId: 'double', direction: 'desc' }],
      filters: [{ fieldId: 'double', op: 'between', value: 15, endValue: 25 }],
    });
    expect(queryRecords(objects, projects, view).map((r) => r.id)).toEqual(['p1']);
    expect(queryRecords(objects, projects, { ...view, filters: [] }).map((r) => r.id)).toEqual([
      'p1',
      'p2',
    ]);
    const dates = db('d', [field('date')]);
    expect(
      queryRecords(
        [dates, record('a', 'd', { date: { start: '2026-10-26T08:00:00+08:00' } })],
        dates,
        {
          ...view,
          filters: [{ fieldId: 'date', op: 'eq', value: { start: '2026-10-26T00:00:00Z' } }],
        },
      ),
    ).toHaveLength(1);
  });
  it('formats files, dates and numeric styles', () => {
    expect(displayValue(0.25, field('number', { numberFormat: 'percent' }), [], 'en')).toBe('25%');
    expect(
      displayValue(12, field('number', { numberFormat: 'currency', currency: 'USD' }), [], 'en'),
    ).toBe('$12.00');
    expect(displayValue({ start: '2026-10-26', end: '2026-10-27' }, field('date'))).toContain('→');
  });
});
describe('write paths, timestamps and attachment persistence', () => {
  it('stamps each intent deterministically, rejects generic derived writes, and updates on undo', () => {
    const schema = db('d', [field('number'), field('formula'), field('createdTime')]);
    const create = {
      type: 'create' as const,
      timestamp: '2026-10-26T00:00:00Z',
      objects: [record('r', 'd', { number: 1 })],
    };
    const initial = executeCommand(create, [schema]);
    const change = {
      type: 'cell' as const,
      timestamp: '2026-10-26T01:00:00Z',
      id: 'r',
      fieldId: 'number',
      value: 2,
    };
    const next = executeCommand(change, initial);
    expect(executeCommand(change, initial)).toEqual(next);
    expect(next[1]).toMatchObject({ createdAt: create.timestamp, updatedAt: change.timestamp });
    expect(() =>
      executeCommand({ type: 'patch', id: 'r', changes: { properties: { formula: null } } }, next),
    ).toThrow('Read-only');
    expect(() =>
      executeCommand(
        {
          type: 'checked',
          expected: [next[1]],
          changes: [{ ...next[1], properties: { createdTime: null } }],
        },
        next,
      ),
    ).toThrow('Read-only');
    const undo = executeCommand(
      { type: 'restore', before: initial, after: next, timestamp: '2026-10-26T02:00:00Z' },
      next,
    );
    expect(undo[1]).toMatchObject({
      properties: { number: 1 },
      createdAt: create.timestamp,
      updatedAt: '2026-10-26T02:00:00Z',
    });
  });
  it('validates live same-workspace relation and asset targets', () => {
    const schema = db('d', [field('files'), field('relation', { targetDatabaseId: 'target' })]);
    const row = record('r', 'd', {}),
      target = db('target', []),
      linked = record('linked', 'target', {});
    const state = [schema, row, target, linked];
    expect(() =>
      executeCommand({ type: 'cell', id: 'r', fieldId: 'relation', value: ['linked'] }, state),
    ).not.toThrow();
    expect(() =>
      executeCommand({ type: 'cell', id: 'r', fieldId: 'relation', value: ['wrong'] }, state),
    ).toThrow();
    expect(() =>
      executeCommand({ type: 'cell', id: 'r', fieldId: 'files', value: ['asset:missing'] }, state),
    ).toThrow();
  });
  it('retries failed asset persistence and reads files after a full sync into a fresh cache', async () => {
    const store = new LocalStore('fields', crypto.randomUUID()),
      fresh = new LocalStore('fields-fresh', crypto.randomUUID());
    const schema = db('d', [field('files')]),
      row = record('r', 'd', {});
    await store.batch([schema, row]);
    const runtime = await WorkspaceRuntime.open(store);
    try {
      const failure = vi.spyOn(store, 'stageAsset').mockRejectedValueOnce(new Error('disk full'));
      const ref = runtime.upload('w', {
        name: 'test.txt',
        mime: 'text/plain',
        bytes: new TextEncoder().encode('attachment payload'),
      });
      await expect(runtime.flush()).rejects.toThrow('disk full');
      await runtime.retry();
      failure.mockRestore();
      runtime.cell('r', 'files', [ref]);
      await runtime.flush();
      const remote = new FileWorkspaceContent(new MemoryProvider(), 'w');
      await new SyncCore(store, remote, 'e', 'w').run();
      await new SyncCore(fresh, remote, 'e', 'w').run();
      const reopened = await WorkspaceRuntime.open(fresh, undefined, undefined, { targetId: 'r' });
      try {
        expect(reopened.snapshot().find((o) => o.id === 'r')?.properties?.files).toEqual([ref]);
        expect(new TextDecoder().decode((await reopened.readAsset(ref.slice(6)))?.bytes)).toBe(
          'attachment payload',
        );
        reopened.cell('r', 'files', []);
        await reopened.flush();
        expect(await reopened.readAsset(ref.slice(6))).toBeDefined();
      } finally {
        await reopened.close();
      }
    } finally {
      runtime.dispose(true);
      store.close();
      fresh.close();
    }
  });
});
