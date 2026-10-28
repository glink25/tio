export const builtinIconNames = [
  'file',
  'book',
  'notebook',
  'folder',
  'star',
  'heart',
  'flag',
  'bookmark',
  'lightbulb',
  'target',
  'rocket',
  'coffee',
  'leaf',
  'sun',
  'moon',
  'cloud',
  'code',
  'terminal',
  'globe',
  'home',
  'calendar',
  'check',
  'music',
  'camera',
] as const;
export type BuiltinIconName = (typeof builtinIconNames)[number];
export const coverPresetIds = [
  'red',
  'amber',
  'blue',
  'cream',
  'green',
  'gray',
  'dawn',
  'ocean',
  'sunset',
  'forest',
  'lavender',
  'sand',
] as const;
export type CoverPresetId = (typeof coverPresetIds)[number];
export interface ImageCredit {
  name: string;
  url: string;
}
export type DocumentIcon =
  | string
  | { type: 'builtin'; name: BuiltinIconName }
  | { type: 'image'; url: string };
export type DocumentCover =
  | { type: 'preset'; id: CoverPresetId }
  | { type: 'image'; url: string; positionY: number; credit?: ImageCredit };
export function isMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^asset:[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
    );
  } catch {
    return false;
  }
}
export function validDocumentIcon(value: unknown): boolean {
  if (typeof value === 'string') return true;
  if (!value || typeof value !== 'object') return false;
  const icon = value as Record<string, unknown>;
  return icon.type === 'image'
    ? isMediaUrl(icon.url)
    : icon.type === 'builtin' && builtinIconNames.some((name) => name === icon.name);
}
export function validDocumentCover(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const cover = value as Record<string, unknown>;
  if (cover.type === 'preset') return coverPresetIds.some((id) => id === cover.id);
  if (
    cover.type !== 'image' ||
    !isMediaUrl(cover.url) ||
    typeof cover.positionY !== 'number' ||
    !Number.isFinite(cover.positionY) ||
    cover.positionY < 0 ||
    cover.positionY > 1
  )
    return false;
  if (cover.credit !== undefined) {
    if (!cover.credit || typeof cover.credit !== 'object') return false;
    const credit = cover.credit as Record<string, unknown>;
    if (
      typeof credit.name !== 'string' ||
      typeof credit.url !== 'string' ||
      !/^https?:\/\//.test(credit.url) ||
      !isMediaUrl(credit.url)
    )
      return false;
  }
  return true;
}
