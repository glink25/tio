import { visibility, type TioObject } from '@tio/core';
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
  const visible = visibility([...navigation, ...objects]);
  const query = text.toLocaleLowerCase();
  const items = objects.filter(
    (o) =>
      visible(o) &&
      ['page', 'database', 'record'].includes(o.type) &&
      (!type || type === 'all' || o.type === type) &&
      JSON.stringify([o.title, o.name, o.properties, o.blocks]).toLocaleLowerCase().includes(query),
  );
  self.postMessage({ id, items });
};
