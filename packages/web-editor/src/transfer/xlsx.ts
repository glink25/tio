import { validateFieldDefinition, type Field } from '@tio/core';
import ExcelJS from 'exceljs';

import { inspectArchive } from './archive';
import { cellText, type TableData } from './table';
const metadataName = '__tio_metadata';
interface Metadata {
  format: 'tio-table';
  version: 1;
  sheets: { name: string; headers: string[]; fields: Field[] }[];
}
export async function writeXLSX(table: TableData): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const requestedName =
    table.name
      .replace(/[\\/*?:[\]]/g, '_')
      .replace(/^'+|'+$/g, '')
      .slice(0, 31) || 'Data';
  const name = requestedName.toLowerCase() === metadataName ? 'Data' : requestedName;
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(table.headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of table.rows) sheet.addRow(row);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const metadata = workbook.addWorksheet(metadataName, { state: 'veryHidden' });
  metadata.getCell('A1').value = 'tio-table';
  // Chunk JSON to respect the XLSX cell string length limit.
  const json = JSON.stringify({
    format: 'tio-table',
    version: 1,
    sheets: [{ name, headers: table.headers, fields: table.fields ?? [] }],
  } satisfies Metadata);
  for (let offset = 0; offset < json.length; offset += 30000)
    metadata.addRow([json.slice(offset, offset + 30000)]);
  const bytes = await workbook.xlsx.writeBuffer();
  return new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
export async function readXLSX(bytes: Uint8Array, name: string): Promise<TableData[]> {
  inspectArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const privateSheet = workbook.getWorksheet(metadataName);
  let metadata: Metadata | undefined;
  if (privateSheet?.getCell('A1').text === 'tio-table') {
    const chunks: string[] = [];
    privateSheet.eachRow((row, i) => {
      if (i > 1) chunks.push(row.getCell(1).text);
    });
    const parsed = JSON.parse(chunks.join('')) as Metadata;
    if (parsed.format !== 'tio-table' || parsed.version !== 1 || !Array.isArray(parsed.sheets))
      throw new Error('Invalid Tio workbook metadata');
    for (const sheet of parsed.sheets) {
      if (
        !Array.isArray(sheet.headers) ||
        !Array.isArray(sheet.fields) ||
        sheet.headers.length !== sheet.fields.length
      )
        throw new Error('Invalid Tio fields');
      for (const field of sheet.fields) {
        if (!field || typeof field.type !== 'string' || typeof field.name !== 'string')
          throw new Error('Invalid Tio field');
        validateFieldDefinition(field);
      }
    }
    metadata = parsed;
  }
  const tables: TableData[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet === privateSheet && metadata) continue;
    const rows: unknown[][] = [];
    sheet.eachRow((row) => {
      const cells: unknown[] = [];
      for (let col = 1; col <= sheet.columnCount; col++) {
        const cell = row.getCell(col);
        let value: unknown = cell.value;
        if (cell.type === ExcelJS.ValueType.Formula) value = cell.result ?? cell.text;
        if (value instanceof Date)
          value = { start: value.toISOString().replace(/T00:00:00\.000Z$/, '') };
        else if (value && typeof value === 'object') value = cell.text;
        cells.push(value ?? '');
      }
      rows.push(cells);
    });
    if (!rows.length) continue;
    const headers = rows.shift()!.map((v) => cellText(v));
    const schema = metadata?.sheets.find((s) => s.name === sheet.name);
    if (schema && JSON.stringify(headers) !== JSON.stringify(schema.headers))
      throw new Error('Tio workbook columns changed');
    tables.push({
      name:
        workbook.worksheets.filter((s) => s !== privateSheet).length === 1
          ? name
          : `${name} · ${sheet.name}`,
      headers,
      rows,
      fields: schema?.fields,
    });
  }
  if (!tables.length) throw new Error('Empty workbook');
  return tables;
}
