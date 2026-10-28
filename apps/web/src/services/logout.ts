import { DomainError } from '@tio/core';
function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    const timeout = setTimeout(
      () => reject(new DomainError('close-tabs', 'Close other Tio tabs and retry.')),
      10000,
    );
    request.onsuccess = () => {
      clearTimeout(timeout);
      resolve();
    };
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error);
    };
  });
}

/** Only application-owned storage is removed; external repositories are never deleted. */
export async function clearHostStorage() {
  await Promise.all(
    ['tio-workspaces', 'tio-provider-recovery'].map((name) => deleteDatabase(name)),
  );
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) {
      if (key.startsWith('tio.') || key.startsWith('tio-')) storage.removeItem(key);
    }
  }
}

export function logoutCoordinator(prepare: () => Promise<void>) {
  const channel = new BroadcastChannel('tio-logout');
  let preparing: Promise<void> | undefined;
  const stop = () => (preparing ??= prepare());
  channel.onmessage = (event) => {
    if (event.data === 'prepare') void stop();
    if (event.data === 'complete') void stop().then(() => location.replace(location.pathname));
  };
  return {
    async logout() {
      channel.postMessage('prepare');
      await stop();
      await clearHostStorage();
      channel.postMessage('complete');
      location.replace(location.pathname);
    },
    close: () => channel.close(),
  };
}
