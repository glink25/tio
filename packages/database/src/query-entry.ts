import { queryProjection, type QueryEntry, type TioObject } from '@tio/core';

import { extractReferences } from './content-index';
export function queryEntry(object: TioObject, revision: number): QueryEntry {
  return { projection: queryProjection(object), revision, references: extractReferences(object) };
}
