import { validateAssetSize } from '@tio/core';
export class MediaImageError extends Error {
  constructor(public code: 'format' | 'decode' | 'url') {
    super(code);
  }
}
export async function validateImageUrl(url: string) {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new MediaImageError('decode');
  }
  return url;
}
export async function validateImageFile(file: File, maxBytes: number) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))
    throw new MediaImageError('format');
  validateAssetSize(file.size, maxBytes);
  const url = URL.createObjectURL(file);
  try {
    await validateImageUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
