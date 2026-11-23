import { platform } from '../platform';
export const clearHostStorage = () => platform().clearStorage();

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
