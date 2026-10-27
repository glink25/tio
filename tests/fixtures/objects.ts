import { object, textBlock } from '@tio/core';

export const basePage = () =>
  object('page', 'base_1', {
    id: 'page_1',
    title: 'Test',
    parentId: null,
    blocks: [textBlock('hello world')],
  });
