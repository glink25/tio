import { openDB } from 'idb';
export const openHostDatabase = (name: string) =>
  openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore('objects');
      db.createObjectStore('assets');
      db.createObjectStore('sessions');
      db.createObjectStore('recovery', { autoIncrement: true });
      db.createObjectStore('settings');
    },
  });
