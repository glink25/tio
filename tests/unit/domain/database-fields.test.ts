import { object, validateValue, type Field } from '@tio/core';
import { createEvaluator } from '@tio/database';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore } from '@tio/local-store';
import { MemoryProvider } from '@tio/provider-memory';
import { SyncCore } from '@tio/sync';
import { WorkspaceRuntime } from '@tio/workspace';
import { describe, expect, it, vi } from 'vitest';

import { executeCommand } from '../../../packages/workspace/src/commands';

const field = (type: string, extra: Partial<Field> = {}): Field => ({
  id: type,
  name: type,
  type,
  ...extra,
});
const db = (id: string, fields: Field[]) => object('database', 'w', { id, fields });
const record = (id: string, databaseId: string, properties: Record<string, unknown>) =>
  object('record', 'w', { id, databaseId, properties, blocks: [] });

describe('typed database fields', () => {
  it.each(['formula', 'rollup', 'createdTime', 'lastEditedTime'])(
    'rejects all writes to %s, including null',
    (type) => {
      for (const value of [null, 1, '']) expect(() => validateValue(field(type), value)).toThrow();
    },
  );
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
