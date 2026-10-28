import {
  canToggleAppMode,
  firstAppSlice,
  isAppMode,
  object,
  stampContent,
  textBlock,
  validate,
  type Block,
} from '@tio/core';
import { decode, encode } from '@tio/serialization';
import { expect, it } from 'vitest';

const app = (id: string): Block => ({
  id,
  type: 'appSlice',
  props: { title: id, html: '<p>App</p>', runtimeVersion: 1, height: 320, autoHeight: true },
  content: [],
  children: [],
});
it('finds the first app in document order including nested blocks, without following references', () => {
  const nested = { ...textBlock('Section'), children: [app('nested')] };
  expect(firstAppSlice([nested, app('second')])?.id).toBe('nested');
  expect(firstAppSlice([textBlock('No app')])).toBeUndefined();
  expect(canToggleAppMode(object('page', 'w', { blocks: [nested] }))).toBe(true);
  expect(canToggleAppMode(object('page', 'w', { blocks: [] }))).toBe(false);
  expect(canToggleAppMode(object('page', 'w', { blocks: [], appMode: true }))).toBe(true);
  expect(isAppMode(object('record', 'w', { appMode: true }))).toBe(false);
});
it('roundtrips the page preference and opaque data, validates its type, and preserves content time', () => {
  const page = object('page', 'w', { blocks: [app('one')], extra: { opaque: true } });
  const enabled = stampContent(page, { ...page, appMode: true }, '2099-01-01T00:00:00.000Z');
  expect(enabled.updatedAt).toBe(page.updatedAt);
  expect(decode(encode(enabled))).toEqual(enabled);
  expect(() => validate({ ...page, appMode: 'true' })).toThrow('Invalid app mode');
});
