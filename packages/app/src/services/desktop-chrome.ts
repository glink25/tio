export type DesktopChromeAction = 'sidebar' | 'new-window' | 'layout';

export interface DesktopChromeState {
  layout: 'overlay' | 'headerbar' | 'system';
  left: number;
  right: number;
  height: number;
  /** Vertical center of the system window controls, measured from the WebView top. */
  center?: number;
}

export interface DesktopChrome {
  state(): Promise<DesktopChromeState>;
  subscribe(listener: (action: DesktopChromeAction) => void): Promise<() => void>;
  title(title: string, sidebar?: string): Promise<void>;
}
