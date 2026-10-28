import { createDefaultRegistry, object, stampContent, type TioObject } from '@tio/core';
import { merge } from '@tio/merge';
import { executeCommand } from '@tio/workspace';
import { describe, expect, it } from 'vitest';

const old = '2020-01-01T00:00:00.000Z';
const now = '2030-01-01T00:00:00.000Z';
const later = '2031-01-01T00:00:00.000Z';
function objects() {
  const make = (type: string, id: string, props: Partial<TioObject>) =>
    object(type, 'w', { id, createdAt: old, updatedAt: old, ...props });
  return [
    make('workspace', 'w', { name: 'Space' }),
    make('page', 'page', { title: 'Page', blocks: [] }),
    make('database', 'db', { name: 'Database', fields: [] }),
    make('record', 'record', { databaseId: 'db', properties: {}, blocks: [] }),
    make('databaseView', 'view', {
      databaseId: 'db',
      layout: 'table',
      filters: [],
      sorts: [],
      visibleFieldIds: [],
    }),
    make('asset', 'asset', {
      filename: 'image.png',
      assetPath: 'assets/asset.png',
      mime: 'image/png',
      byteSize: 1,
    }),
  ];
}

describe('system timestamps on the current v1 contract', () => {
  it('requires UTC times on every built-in object while preserving opaque extensions', () => {
    const registry = createDefaultRegistry();
    for (const value of objects()) {
      expect(value.schemaVersion).toBe(1);
      expect(registry.decode(value)).toEqual(value);
      for (const key of ['createdAt', 'updatedAt']) {
        const invalid = { ...value };
        delete invalid[key];
        expect(() => registry.decode(invalid)).toThrow('system timestamps');
      }
      expect(() => registry.decode({ ...value, updatedAt: '2019-01-01T00:00:00Z' })).toThrow(
        'system timestamps',
      );
      expect(() => registry.decode({ ...value, createdAt: '2020-01-01T08:00:00+08:00' })).toThrow(
        'system timestamps',
      );
    }
    const extension = object('opaque', 'w', { payload: { future: true } });
    expect(extension.createdAt).toBeUndefined();
    expect(registry.decode(extension)).toEqual(extension);
  });
  it('ordinary creation uses the intent clock, import preserves original times and copies receive new times', () => {
    const source = objects();
    const created = executeCommand({ type: 'create', objects: source, timestamp: now }, []);
    for (const value of created) expect(value).toMatchObject({ createdAt: now, updatedAt: now });
    expect(executeCommand({ type: 'import', objects: source, timestamp: now }, [])).toEqual(source);
    const page = source.find((o) => o.type === 'page')!;
    expect(
      executeCommand(
        { type: 'create', objects: [{ ...page, id: 'copy' }], timestamp: later },
        source,
      ).find((o) => o.id === 'copy'),
    ).toMatchObject({ createdAt: later, updatedAt: later });
  });
  it('content updates affect only the edited object and cannot directly rewrite system metadata', () => {
    const baseline = objects();
    for (const id of ['w', 'page', 'db', 'record', 'view', 'asset']) {
      const changed = executeCommand(
        { type: 'patch', id, changes: { icon: 'star' }, timestamp: now },
        baseline,
      );
      expect(changed.find((o) => o.id === id)).toMatchObject({ createdAt: old, updatedAt: now });
      for (const value of changed.filter((o) => o.id !== id)) expect(value.updatedAt).toBe(old);
      expect(() =>
        executeCommand(
          { type: 'patch', id, changes: { updatedAt: later }, timestamp: now },
          baseline,
        ),
      ).toThrow('read-only');
      const current = baseline.find((o) => o.id === id)!;
      expect(() =>
        executeCommand(
          {
            type: 'checked',
            expected: [current],
            changes: [{ ...current, createdAt: later, updatedAt: later }],
            timestamp: now,
          },
          baseline,
        ),
      ).toThrow('read-only');
    }
  });
  it('does not stamp no-ops, navigation, deletion, recovery or view configuration', () => {
    const baseline = objects();
    expect(
      executeCommand(
        { type: 'patch', id: 'page', changes: { title: 'Page' }, timestamp: now },
        baseline,
      ),
    ).toEqual(baseline);
    const moved = executeCommand(
      { type: 'move', id: 'page', parentId: null, order: 100, timestamp: now },
      baseline,
    );
    expect(moved.find((o) => o.id === 'page')!.updatedAt).toBe(old);
    const deleted = executeCommand(
      { type: 'patch', id: 'page', changes: { deleted: true }, timestamp: now },
      baseline,
    );
    const restored = executeCommand({ type: 'undelete', id: 'page', timestamp: later }, deleted);
    expect(restored.find((o) => o.id === 'page')!.updatedAt).toBe(old);
    const view = executeCommand(
      {
        type: 'patch',
        id: 'view',
        changes: { columnWidths: { title: 140 }, visibleFieldIds: ['title'] },
        timestamp: now,
      },
      baseline,
    );
    expect(view.find((o) => o.id === 'view')!.updatedAt).toBe(old);
  });
  it('replays deterministically and treats content undo as a new edit without rewinding creation', () => {
    const baseline = objects();
    const intent = {
      type: 'patch' as const,
      id: 'page',
      changes: { title: 'New' },
      timestamp: now,
    };
    const edited = executeCommand(intent, baseline);
    expect(executeCommand(intent, baseline)).toEqual(edited);
    const undone = executeCommand(
      { type: 'restore', before: baseline, after: edited, timestamp: later },
      edited,
    );
    expect(undone.find((o) => o.id === 'page')).toMatchObject({
      title: 'Page',
      createdAt: old,
      updatedAt: later,
    });
    const moved = executeCommand(
      { type: 'move', id: 'page', parentId: null, order: 100, timestamp: now },
      baseline,
    );
    const undoMove = executeCommand(
      { type: 'restore', before: baseline, after: moved, timestamp: later },
      moved,
    );
    expect(undoMove.find((o) => o.id === 'page')!.updatedAt).toBe(old);
    const page = edited.find((o) => o.id === 'page')!;
    expect(stampContent(page, { ...page, title: 'Clock skew' }, old).updatedAt).toBe(now);
  });
  it('merges timestamp metadata without conflict warnings or receiver wall-clock changes', () => {
    const base = objects().find((o) => o.id === 'page')!;
    const local = { ...base, title: 'Local', updatedAt: now };
    const remote = { ...base, icon: 'remote', updatedAt: later };
    const result = merge(base, local, remote);
    expect(result.merged).toMatchObject({
      title: 'Local',
      icon: 'remote',
      createdAt: old,
      updatedAt: later,
    });
    expect(result.warnings).toEqual([]);
    const independent = merge(undefined, { ...local, createdAt: now }, remote);
    expect(independent.merged).toMatchObject({ createdAt: old, updatedAt: later });
    expect(independent.warnings.some((warning) => /createdAt|updatedAt/.test(warning))).toBe(false);
  });
});
