import Papa from 'papaparse';

import type { TableData } from './table';
export function readCSV(text: string, name: string): TableData {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (result.errors.some((e) => e.code !== 'UndetectableDelimiter')) throw new Error('Invalid CSV');
  const [headers, ...rows] = result.data;
  if (!headers?.length) throw new Error('Empty CSV');
  return { name, headers, rows };
}
export function writeCSV(table: TableData): Blob {
  return new Blob(
    ['\uFEFF', Papa.unparse({ fields: table.headers, data: table.rows }, { newline: '\r\n' })],
    { type: 'text/csv;charset=utf-8' },
  );
}
