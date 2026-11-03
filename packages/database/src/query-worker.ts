import { queryRecords } from './index';
self.onmessage = (event) => {
  const { id, objects, database, view, text } = event.data;
  try {
    const ids = queryRecords(objects, database, view)
      .filter(
        (o) =>
          !text ||
          JSON.stringify(o.properties).toLocaleLowerCase().includes(text.toLocaleLowerCase()),
      )
      .map((o) => o.id);
    self.postMessage({ id, ids });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
