import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type {
  DesktopChrome,
  DesktopChromeAction,
  DesktopChromeState,
} from '@tio/app/services/desktop-chrome';

export function createDesktopChrome(): DesktopChrome {
  const window = getCurrentWebviewWindow();
  return {
    state: () => invoke<DesktopChromeState>('desktop_chrome_state'),
    async subscribe(listener) {
      const unlisten = await window.listen<DesktopChromeAction>('tio:desktop-chrome', (event) =>
        listener(event.payload),
      );
      try {
        const unresize = await window.onResized(() => listener('layout'));
        return () => {
          unlisten();
          unresize();
        };
      } catch (error) {
        unlisten();
        throw error;
      }
    },
    title: (title, sidebar) => invoke('desktop_chrome_title', { title, sidebar }),
  };
}
