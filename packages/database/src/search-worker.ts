import { type TioObject } from '@tio/core';

import { searchHits } from './content-index';
/** The worker only receives permission-filtered provider projections. */
self.onmessage = (
  event: MessageEvent<{
    id: number;
    objects: TioObject[];
    navigation: TioObject[];
    text: string;
    type?: string;
  }>,
) => {
  const { id, objects, navigation, text, type } = event.data;
  const items = searchHits(objects, navigation, text, type);
  self.postMessage({ id, items });
};
