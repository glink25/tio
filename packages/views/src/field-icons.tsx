import type { SpriteMap } from '@glideapps/glide-data-grid';
import type { FieldType } from '@tio/core';

import { fieldIconPaths } from './field-icon-paths';

const paths: Record<FieldType | 'unknown', string> = fieldIconPaths;
const iconType = (type: string): FieldType | 'unknown' =>
  Object.hasOwn(paths, type) ? (type as FieldType | 'unknown') : 'unknown';

export function fieldIcon(type: string): string {
  return `field-${iconType(type)}`;
}

/** Both renderers use a 24px canvas and 2px round strokes, without background cutouts. */
export const fieldHeaderIcons: SpriteMap = Object.fromEntries(
  Object.entries(paths).map(([type, body]) => [
    fieldIcon(type),
    ({ fgColor }: { fgColor: string }) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${fgColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  ]),
);

export function FieldTypeIcon({ type }: { type: string }) {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: paths[iconType(type)] }}
    />
  );
}
