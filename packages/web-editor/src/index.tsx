export { createMentionService } from './mentions';
export { runnerDocument as createAppSliceRuntimeDocument } from './app-slice/runner';
export type {
  AppSliceOptions,
  AppSlicePermission,
  AppSlicePermissionStore,
} from './app-slice/types';
import { HostError, type Domain, type AccessPolicy, type WorkspaceRepository } from '@tio/core';
import { EditorSchemaContext, defaultEditorSchema, type EditorSchema } from '@tio/editor-blocknote';
import { BridgeRepository, type HostContext, type Transport } from '@tio/host-protocol';
import { createLanguageInstance, I18nextProvider, type Language } from '@tio/i18n';
import {
  AssetPolicyContext,
  ThemeContext,
  PortalContext,
  Notifications,
  NotificationContext,
} from '@tio/ui';
import { ViewExtensionsContext, type ViewExtensions } from '@tio/views';
import { WorkspaceRuntime, type WorkspaceState } from '@tio/workspace';
import { useMemo, useState, useEffect, useId, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import type { AppSliceOptions } from './app-slice/types';
import type { EditorSurfaceProps, EditorTarget } from './controller';
import { EditorSurface as Surface } from './surface';

import './style.css';
export type { EditorTarget, EditorSurfaceProps } from './controller';
export interface Presentation {
  theme: 'dark' | 'light';
  locale: Language;
  readOnly: boolean;
}
function Environment({
  views,
  extensions,
  theme,
  locale,
  children,
}: {
  views?: ViewExtensions;
  extensions?: EditorSchema;
  theme: 'dark' | 'light';
  locale: Language;
  children: ReactNode;
}) {
  const notificationId = useId();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const language = useMemo(() => createLanguageInstance(locale), [locale]);
  return (
    <I18nextProvider i18n={language}>
      <ThemeContext.Provider value={theme}>
        <div
          ref={setContainer}
          className={`tio-editor ${theme === 'dark' ? 'dark' : ''}`}
          lang={locale}
          style={{ colorScheme: theme }}
        >
          <PortalContext.Provider value={container ?? undefined}>
            {container && (
              <NotificationContext.Provider value={notificationId}>
                <Notifications />
                <EditorSchemaContext.Provider value={extensions ?? { schema: defaultEditorSchema }}>
                  <ViewExtensionsContext.Provider value={views ?? {}}>
                    {children}
                  </ViewExtensionsContext.Provider>
                </EditorSchemaContext.Provider>
              </NotificationContext.Provider>
            )}
          </PortalContext.Provider>
        </div>
      </ThemeContext.Provider>
    </I18nextProvider>
  );
}
/** React integration used by the Web shell and by mountEditor. */
export function EditorSurface(props: EditorSurfaceProps & { presentation: Presentation }) {
  return (
    <Environment
      views={props.views}
      extensions={props.extensions}
      theme={props.presentation.theme}
      locale={props.presentation.locale}
    >
      <AssetPolicyContext.Provider value={props.runtime.attachmentPolicy}>
        <Surface {...props} readOnly={props.presentation.readOnly || props.readOnly} />
      </AssetPolicyContext.Provider>
    </Environment>
  );
}
function Ready({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frame);
  }, [onReady]);
  return children;
}
export interface EditorOptions {
  contentLinks?: EditorSurfaceProps['contentLinks'];
  onOpenGraph?: EditorSurfaceProps['onOpenGraph'];
  mentions?: import('@tio/core').MentionService;
  appSlice?: AppSliceOptions;
  domain?: Domain;
  views?: ViewExtensions;
  extensions?: EditorSchema;
  repository: WorkspaceRepository;
  access?: AccessPolicy;
  workspaceId: string;
  target: EditorTarget;
  presentation?: Partial<Presentation>;
  onNavigate?: (target: EditorTarget) => void;
  onReady?: () => void;
  onSaveState?: (state: WorkspaceState) => void;
  onError?: (error: unknown) => void;
}
export interface EditorHandle {
  open(target: EditorTarget): Promise<void>;
  setPresentation(presentation: Partial<Presentation>): void;
  flush(): Promise<void>;
  getSaveState(): WorkspaceState;
  retry(): Promise<void>;
  dispose(): Promise<void>;
}
/** Independent entry point: the host is the only persistence owner. */
export async function mountEditor(
  container: HTMLElement,
  options: EditorOptions,
): Promise<EditorHandle> {
  const runtime = await WorkspaceRuntime.open(options.repository, options.access, options.domain, {
    targetId: options.target.id,
  });
  const root = createRoot(container);
  let target = options.target;
  let presentation: Presentation = {
    theme: 'dark',
    locale: 'zh',
    readOnly: false,
    ...options.presentation,
  };
  let closed = false;
  let closing: Promise<void> | undefined;
  const assertOpen = () => {
    if (closed || closing) throw new HostError('closed');
  };
  const render = () =>
    root.render(
      <Ready onReady={options.onReady}>
        <EditorSurface
          contentLinks={options.contentLinks}
          onOpenGraph={options.onOpenGraph}
          mentions={options.mentions}
          appSlice={options.appSlice}
          views={options.views}
          extensions={options.extensions}
          runtime={runtime}
          workspaceId={options.workspaceId}
          target={target}
          presentation={presentation}
          onNavigate={(next) => options.onNavigate?.(next)}
          onError={options.onError}
        />
      </Ready>,
    );
  const unsubscribe = runtime.state.subscribe((state) => {
    options.onSaveState?.(state);
    if (state.error) options.onError?.(state.error);
  });
  render();
  return {
    async open(next) {
      assertOpen();
      await runtime.flush();
      assertOpen();
      target = { ...next, requestId: (target.requestId ?? 0) + 1 };
      render();
    },
    setPresentation(next) {
      assertOpen();
      presentation = { ...presentation, ...next };
      render();
    },
    async flush() {
      assertOpen();
      await runtime.flush();
    },
    getSaveState() {
      assertOpen();
      return runtime.state.getState();
    },
    async retry() {
      assertOpen();
      await runtime.retry();
    },
    async dispose() {
      if (closed) return;
      if (closing) return closing;
      closing = (async () => {
        try {
          await runtime.flush();
          closed = true;
          unsubscribe();
          root.unmount();
          runtime.dispose();
        } finally {
          closing = undefined;
        }
      })();
      return closing;
    },
  };
}
/** Native callers provide their trusted channel + binary transport; no browser database is opened. */
export async function mountBridgedEditor(
  container: HTMLElement,
  transport: Transport,
  context: HostContext,
  options: Omit<EditorOptions, 'repository'>,
): Promise<EditorHandle> {
  const repository = new BridgeRepository(transport, context);
  try {
    await repository.connect();
    const editor = await mountEditor(container, { ...options, repository });
    return {
      ...editor,
      async dispose() {
        await editor.dispose();
        repository.dispose();
      },
    };
  } catch (error) {
    repository.dispose();
    throw error;
  }
}
