import { object, type Field } from '@tio/core';
import { inferColumn, convertValue, convertColumn, parseNumber } from '@tio/database/conversion';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import ExcelJS from 'exceljs';
import { describe, it, expect } from 'vitest';

import { readCSV, writeCSV } from '../../../packages/web-editor/src/transfer/csv';
import { exportTable, importTable } from '../../../packages/web-editor/src/transfer/table';
import { readXLSX, writeXLSX } from '../../../packages/web-editor/src/transfer/xlsx';

const field = (type: string): Field => ({ id: 'value', name: 'Value', type });
describe('table inference and conversion', () => {
  it('uses whole-column evidence and preserves identifiers and precision', () => {
    expect(inferColumn(['', '12', '-2.5', null])).toBe('number');
    expect(inferColumn([true, 'false', ''])).toBe('boolean');
    expect(inferColumn(['2026-10-28', '2026-10-29'])).toBe('date');
    for (const values of [
      ['0012', '0013'],
      ['9007199254740993'],
      ['2026-02-30'],
      ['1', 'true'],
      ['12', 'oops'],
      [],
    ])
      expect(inferColumn(values)).toBe('text');
    expect(parseNumber('12kg')).toBeNull();
    expect(parseNumber('Infinity')).toBeNull();
  });
  it('converts options by labels, booleans and strict dates; invalid values clear', () => {
    const source: Field = {
      ...field('multiSelect'),
      options: [
        { id: 'one', label: 'First' },
        { id: 'two', label: 'Second' },
      ],
    };
    const target = field('select');
    const value = convertValue(['one', 'two'], source, target);
    expect(target.options?.find((o) => o.id === value)?.label).toBe('First');
    expect(convertValue(false, field('boolean'), field('number'))).toBe(0);
    expect(convertValue(false, field('boolean'), field('boolean'))).toBe(false);
    expect(convertValue('1', field('text'), field('boolean'))).toBe(true);
    expect(convertValue('bad', field('text'), field('number'))).toBeNull();
    expect(convertValue(null, field('text'), field('formula'))).toBeUndefined();
    expect(convertValue(1e100, field('number'), field('number'))).toBe(1e100);
    expect(convertValue('2026-10-28', field('text'), field('date'))).toEqual({
      start: '2026-10-28',
    });
    expect(convertValue('2026-02-30', field('text'), field('date'))).toBeNull();
  });
  it('projects computed fields when converting to text', () => {
    const source = { ...field('formula'), formula: '2 + 3' };
    const db = object('database', 'w', { id: 'db', fields: [source] });
    const record = object('record', 'w', { databaseId: db.id, properties: {} });
    const result = convertColumn(db, source, field('text'), [db, record]);
    expect(result.changes[1].properties?.value).toBe('5');
  });
});
describe('CSV and XLSX transfer', () => {
  it('roundtrips BOM, commas, quotes, multiline and Unicode without metadata rows', async () => {
    const table = {
      name: '表',
      headers: ['Name', 'Value'],
      rows: [
        ['中文', 'a,"b"\nnext'],
        ['two', '0012'],
      ],
    };
    const csv = await writeCSV(table).text();
    expect(readCSV(csv, table.name)).toEqual(table);
    expect(readCSV('Name,Count\r\na,12\r\nb,13', 'Data').rows).toHaveLength(2);
    expect(() => readCSV('Name\n"unterminated', 'Bad')).toThrow();
  });
  it('exports machine-readable booleans, numeric values and dates to CSV for inference', async () => {
    const fields: Field[] = [
      { id: 'name', name: 'Name', type: 'title' },
      { id: 'flag', name: 'Flag', type: 'boolean' },
      { id: 'money', name: 'Money', type: 'number', numberFormat: 'currency', currency: 'CNY' },
      { id: 'day', name: 'Day', type: 'date' },
    ];
    const db = object('database', 'w', { id: 'db', fields });
    const row = object('record', 'w', {
      databaseId: db.id,
      properties: { name: 'a', flag: false, money: 12.5, day: { start: '2026-10-28' } },
    });
    const csv = await writeCSV(exportTable(db, [row], [db, row])).text();
    const imported = importTable(readCSV(csv, 'Data'), 'w', 'parent');
    expect(imported[0].fields!.map((f) => f.type)).toEqual(['title', 'boolean', 'number', 'date']);
    expect(imported[2].properties![imported[0].fields![1].id]).toBe(false);
  });
  it('restores independent XLSX field configuration and turns dependency fields into text', async () => {
    const fields: Field[] = [
      { id: 'title', name: 'Name', type: 'title' },
      { id: 'n', name: 'Number', type: 'number', numberFormat: 'currency', currency: 'CNY' },
      {
        id: 's',
        name: 'Tags',
        type: 'multiSelect',
        options: [{ id: 'old', label: 'x,y', color: 'blue' }],
      },
      { id: 'd', name: 'Date', type: 'date' },
      { id: 'f', name: 'Formula', type: 'formula', formula: '1 + 1' },
    ];
    const db = object('database', 'w', { id: 'db', name: '测试', fields });
    const record = object('record', 'w', {
      databaseId: db.id,
      properties: {
        title: 'row',
        n: 12.5,
        s: ['old'],
        d: { start: '2026-10-28', end: '2026-10-29', timeZone: 'Asia/Shanghai' },
      },
    });
    const table = exportTable(db, [record], [db, record], true);
    const blob = await writeXLSX(table);
    const tables = await readXLSX(new Uint8Array(await blob.arrayBuffer()), 'Imported');
    expect(tables).toHaveLength(1);
    const result = importTable(tables[0], 'other', 'parent');
    const importedFields = result[0].fields!;
    expect(importedFields.map((f) => f.type)).toEqual([
      'title',
      'number',
      'multiSelect',
      'date',
      'text',
    ]);
    expect(importedFields[1]).toMatchObject({ numberFormat: 'currency', currency: 'CNY' });
    expect(importedFields[2].options![0]).toMatchObject({ label: 'x,y', color: 'blue' });
    expect(importedFields[2].options![0].id).not.toBe('old');
    const properties = result[2].properties!;
    expect(properties[importedFields[1].id]).toBe(12.5);
    expect(properties[importedFields[3].id]).toEqual(record.properties!.d);
    expect(properties[importedFields[4].id]).toBe('2');
  });
  it('imports all nonempty XLSX sheets and uses cached formula values without execution', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Empty');
    const first = workbook.addWorksheet('First');
    first.addRows([
      ['Name', 'Count', 'Day'],
      ['a', 12, new Date('2026-10-28T00:00:00Z')],
    ]);
    const second = workbook.addWorksheet('Second');
    second.addRows([
      ['Name', 'Computed'],
      ['b', { formula: '1+1', result: 2 }],
    ]);
    const tables = await readXLSX(new Uint8Array(await workbook.xlsx.writeBuffer()), 'External');
    expect(tables).toHaveLength(2);
    const firstObjects = importTable(tables[0], 'w', 'parent');
    expect(firstObjects[0].fields!.map((f) => f.type)).toEqual(['title', 'number', 'date']);
    const secondObjects = importTable(tables[1], 'w', 'parent');
    expect(secondObjects[0].fields![1].type).toBe('number');
    expect(secondObjects[2].properties![secondObjects[0].fields![1].id]).toBe(2);
  });
  it('rejects recognized broken metadata rather than importing a misleading schema', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Data').addRows([['Name'], ['a']]);
    workbook
      .addWorksheet('__tio_metadata')
      .addRows([
        ['tio-table'],
        [JSON.stringify({ format: 'tio-table', version: 999, sheets: [] })],
      ]);
    await expect(
      readXLSX(new Uint8Array(await workbook.xlsx.writeBuffer()), 'Bad'),
    ).rejects.toThrow('metadata');
  });
  it('infers plain CSV/XLSX columns identically and keeps the title text', () => {
    const result = importTable(
      {
        name: 'Data',
        headers: ['Name', 'Number', 'Flag', 'Day', 'Code'],
        rows: [
          ['001', '12', 'true', '2026-10-28', '00123'],
          ['002', '13', 'false', '2026-10-29', '00124'],
        ],
      },
      'w',
      'parent',
    );
    expect(result[0].fields!.map((f) => f.type)).toEqual([
      'title',
      'number',
      'boolean',
      'date',
      'text',
    ]);
    expect(result[2].properties![result[0].fields![0].id]).toBe('001');
  });
});
describe('complete database conversion history', () => {
  it('converts every page and undoes and redoes schema and values together', async () => {
    const repository = new MemoryRepository();
    const db = object('database', 'w', {
      id: 'db',
      fields: [{ id: 'title', name: 'Name', type: 'title' }, field('text')],
    });
    const rows = Array.from({ length: 1005 }, (_, i) =>
      object('record', 'w', {
        id: `r_${String(i).padStart(4, '0')}`,
        databaseId: 'db',
        blocks: [],
        properties: { title: String(i), value: i === 1004 ? 'invalid' : String(i) },
      }),
    );
    await repository.commit({
      id: 'seed',
      assetIds: [],
      expectedVersion: 0,
      changes: [object('workspace', 'w', { id: 'w' }), db, ...rows],
    });
    const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
      targetId: 'db',
    });
    expect(await runtime.convertField('db', field('number'))).toBe(1);
    expect(runtime.snapshot().find((o) => o.id === 'r_1004')?.properties?.value).toBeNull();
    expect(runtime.snapshot().find((o) => o.id === 'r_1003')?.properties?.value).toBe(1003);
    runtime.undo();
    await runtime.flush();
    expect(runtime.snapshot().find((o) => o.id === 'db')?.fields?.[1].type).toBe('text');
    expect(runtime.snapshot().find((o) => o.id === 'r_1004')?.properties?.value).toBe('invalid');
    runtime.redo();
    await runtime.flush();
    expect(runtime.snapshot().find((o) => o.id === 'db')?.fields?.[1].type).toBe('number');
    await runtime.close();
  });
  it('does not partially convert a database when a record update is denied', async () => {
    const repository = new MemoryRepository();
    const db = object('database', 'w', { id: 'db', fields: [field('text')] });
    const rows = ['one', 'two'].map((id) =>
      object('record', 'w', { id, databaseId: 'db', properties: { value: '12' }, blocks: [] }),
    );
    await repository.commit({
      id: 'seed',
      expectedVersion: 0,
      assetIds: [],
      changes: [object('workspace', 'w', { id: 'w' }), db, ...rows],
    });
    const runtime = await WorkspaceRuntime.open(
      repository,
      {
        version: 'denied',
        allows: (resource, operation) => operation !== 'update' || resource.id !== 'two',
      },
      undefined,
      { targetId: 'db' },
    );
    await expect(runtime.convertField('db', field('number'))).rejects.toThrow();
    expect(
      (await repository.readSnapshot()).entries.find((e) => e.object.id === 'db')!.object.fields![0]
        .type,
    ).toBe('text');
    expect(runtime.snapshot().find((o) => o.id === 'one')!.properties!.value).toBe('12');
    await runtime.close();
  });
  it('rejects a concurrent insertion before committing a captured conversion', async () => {
    const repository = new MemoryRepository();
    const db = object('database', 'w', { id: 'db', fields: [field('text')] });
    const row = object('record', 'w', {
      id: 'one',
      databaseId: 'db',
      properties: { value: '12' },
      blocks: [],
    });
    await repository.commit({
      id: 'seed',
      expectedVersion: 0,
      assetIds: [],
      changes: [object('workspace', 'w', { id: 'w' }), db, row],
    });
    const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
      targetId: 'db',
    });
    const read = runtime.databaseSnapshot.bind(runtime);
    runtime.databaseSnapshot = async (databaseId) => {
      const result = await read(databaseId);
      await repository.commit({
        id: 'external',
        expectedVersion: result.version,
        assetIds: [],
        changes: [
          object('record', 'w', {
            id: 'late',
            databaseId: 'db',
            properties: { value: 'bad' },
            blocks: [],
          }),
        ],
      });
      return result;
    };
    await expect(runtime.convertField('db', field('number'))).rejects.toThrow();
    expect(
      (await repository.readSnapshot()).entries.find((e) => e.object.id === 'db')!.object.fields![0]
        .type,
    ).toBe('text');
    await runtime.close();
  });
});
