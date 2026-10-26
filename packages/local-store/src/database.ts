import { openDB } from 'idb';
export const openHostDatabase = (name: string) =>
  openDB(name, 1, {
    upgrade(db) {
      const objects = db.createObjectStore('objects');
      objects.createIndex('version', ['instanceId', 'version']);
      objects.createIndex('database', ['instanceId', 'object.databaseId', 'object.id']);
      objects.createIndex('type', ['instanceId', 'object.type', 'object.id']);
      db.createObjectStore('assets');
      db.createObjectStore('sessions');
      db.createObjectStore('recovery', { autoIncrement: true }).createIndex(
        'instance',
        'instanceId',
      );
      db.createObjectStore('settings');
    },
  });
