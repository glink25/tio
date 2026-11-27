import { AssetResolver } from '@tio/assets/browser';
import { isContentTarget, type ContentAnchor, type ContentTarget } from '@tio/core';
import {
  id,
  visibility,
  editable,
  ConnectionAccessError,
  HostError,
  type TioObject,
} from '@tio/core';
import type { WorkspaceSession, Connection } from '@tio/core';
import { t, errorMessage } from '@tio/i18n';
import { gitConnection, gitConnectionId, type GitProvider } from '@tio/provider-github/credentials';
import { exportZip, exportMarkdownZip, importZip } from '@tio/serialization';
import type { SyncSnapshot } from '@tio/sync';
import { toast } from '@tio/ui';
import { createMentionService } from '@tio/web-editor/mentions';
import { navigationTree } from '@tio/workspace';
import {
  starterWorkspace,
  newPage,
  newDatabase,
  WorkspaceRuntime,
  emptyWorkspaceState,
} from '@tio/workspace';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { platform } from '../../platform';
import { pickFolder } from '../../services/folder-access';
import {
  connectToken,
  finishGitLogin,
  nativeCallback,
  credentials,
  loginGit,
} from '../../services/github-auth';
import { logoutCoordinator } from '../../services/logout';
import { contentUrl, createContentRouter, readRoute } from '../../services/navigation';
import { WorkspaceServices } from '../../services/workspace-services';
import { statusModel } from './status';
const emptyStore = createStore(() => emptyWorkspaceState);
export function useWorkspace() {
  const [services] = useState(() => new WorkspaceServices());
  const host = platform();
  const windows = host.windows;
  const [router] = useState(() => createContentRouter(!!host.mobile));
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null);
  const runtimeRef = useRef<WorkspaceRuntime | null>(null);
  const mediaResolver = useMemo(() => (runtime ? new AssetResolver(runtime) : null), [runtime]);
  useEffect(() => () => mediaResolver?.dispose(), [mediaResolver]);
  const resolveMedia = useCallback(
    async (ref: string) => mediaResolver?.resolve(ref) ?? '',
    [mediaResolver],
  );
  const state = useStore(runtime?.state ?? emptyStore);
  const objects = state.objects;
  const saveStatus = state.status;
  const [connection, setConnection] = useState<Connection | null>(null);
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [selected, setSelected] = useState('');
  const [graph, setGraph] = useState(false);
  const [locationTarget, setLocationTarget] = useState<{
    anchor?: ContentAnchor;
    requestId: number;
  }>({ requestId: 0 });
  const [syncStatus, setSyncStatus] = useState<SyncSnapshot>({ phase: 'idle' });
  const [syncingSession, setSyncingSession] = useState<string>();
  const syncRequest = useRef<{ id: string; work: Promise<void> } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const creation = useRef<{ running: boolean; session?: WorkspaceSession }>({ running: false });
  useEffect(() => {
    if (!creating) creation.current = { running: false };
  }, [creating]);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [recent, setRecent] = useState<string>();
  const coordinator = useRef<ReturnType<typeof logoutCoordinator> | null>(null);
  useEffect(() => {
    coordinator.current = logoutCoordinator(async () => {
      setLoggingOut(true);
      setLogoutOpen(true);
      if (windows) await runtimeRef.current?.flush();
      await services.abandon();
      runtimeRef.current = null;
      setRuntime(null);
    });
    return () => coordinator.current?.close();
  }, [services, windows]);
  const [tokenProvider, setTokenProvider] = useState<GitProvider>();
  const [menu, setMenu] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activating = useRef(false);
  const documentScroll = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const [sidebar, setSidebar] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [workspaceAction, setWorkspaceAction] = useState<{
    session: WorkspaceSession;
    operation: 'delete' | 'share';
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const actionRunning = useRef(false);
  function requestWorkspaceAction(target: WorkspaceSession, operation: 'delete' | 'share') {
    if (operation === 'share' && target.id !== sessionRef.current?.id) return;
    if (!services.workspaceActions(target)[operation]) return;
    setActionError('');
    setWorkspaceAction({
      session:
        target.id === sessionRef.current?.id
          ? { ...target, name: workspace?.name ?? target.name }
          : target,
      operation,
    });
  }
  async function executeWorkspaceAction() {
    if (!workspaceAction || actionRunning.current) return;
    const { session: target, operation } = workspaceAction;
    const action = services.workspaceActions(target)[operation];
    if (!action) return;
    if (action.kind === 'external') {
      window.open(action.url, '_blank', 'noopener,noreferrer');
      setWorkspaceAction(null);
      return;
    }
    actionRunning.current = true;
    setActionBusy(true);
    setActionError('');
    try {
      if (operation === 'delete') {
        const remove = () => services.deleteWorkspace(target);
        if (windows) await windows.changeConnection(remove, target.id);
        else await remove();
      } else await action.execute();
      setWorkspaceAction(null);
      await refreshSessions();
    } catch (error) {
      services.reportStatusError(error);
      setActionError(errorMessage(error));
    } finally {
      actionRunning.current = false;
      setActionBusy(false);
    }
  }
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (runtimeRef.current?.state.getState().pending) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const saveWhenHidden = () => {
      const active = runtimeRef.current;
      if (document.hidden && active?.state.getState().pending) {
        void active.flush().catch((error) => services.reportStatusError(error));
      }
    };
    window.addEventListener('beforeunload', warn);
    if (windows) document.addEventListener('visibilitychange', saveWhenHidden);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('visibilitychange', saveWhenHidden);
    };
  }, [services, windows]);
  function reportError(error: unknown) {
    if (runtimeRef.current?.state.getState().error === error) return;
    if (sessionRef.current && error instanceof ConnectionAccessError) {
      services.reportStatusError(error);
      return;
    }
    setError(errorMessage(error));
  }
  const refreshSessions = async () => setSessions(await services.sessions());
  useEffect(() => {
    let disposed = false;
    let stopCallbacks: (() => void) | undefined;
    let stopClose: (() => void) | undefined;
    const stopAssignments = windows?.subscribeAssignments(() => services.refreshSyncAssignments());
    router.start();
    services.onWorkspaceClosed = (id) => {
      if (sessionRef.current?.id !== id) return;
      runtimeRef.current = null;
      sessionRef.current = null;
      setRuntime(null);
      setSession(null);
      setSelected('');
      setRecent(undefined);
      setSettingsOpen(false);
      setAutomationOpen(false);
      setPreviewId(null);
      setSyncStatus({ phase: 'idle' });
      void windows?.release().catch(reportError);
      router.clear();
    };
    services.onChange = () => {
      if (!disposed) void refreshSessions().catch((e) => reportError(e));
    };
    void (async () => {
      if (windows) {
        stopClose = await windows.onClose(async () => {
          if (!window.dispatchEvent(new Event('tio:before-window-close', { cancelable: true })))
            throw new HostError('pending');
          try {
            if (activating.current) throw new HostError('pending');
            await runtimeRef.current?.flush();
            await services.dispose();
          } catch (error) {
            reportError(error);
            throw error;
          }
        });
        if (disposed) {
          stopClose();
          return;
        }
      }
      let launchURL: string | undefined;
      const callbacks = platform().auth.callbacks;
      if (callbacks) {
        let exchanging = false;
        stopCallbacks = await callbacks.subscribe(async (urls) => {
          const callback = urls.find(nativeCallback);
          if (disposed || exchanging || !callback) return;
          exchanging = true;
          try {
            const provider = await finishGitLogin(callback);
            if (provider) {
              const account = credentials();
              if (
                account &&
                services.connection?.id === gitConnectionId(account.provider, account.userId)
              )
                await services.credentialsChanged();
              else await connect(provider);
              setConnection(services.connection);
              services.startSync(setSyncStatus);
              await loadSpaces();
            }
          } catch (error) {
            reportError(error);
          } finally {
            exchanging = false;
          }
        });
        if (disposed) {
          stopCallbacks();
          return;
        }
        launchURL = (await callbacks.current()).find(nativeCallback);
      }
      const loggedIn = await finishGitLogin(launchURL);
      await services.initialize();
      const account = credentials();
      const restoringAuthorization =
        loggedIn &&
        account &&
        services.connection?.id === gitConnectionId(account.provider, account.userId);
      if (loggedIn && !restoringAuthorization) await connect(loggedIn);
      if (disposed) return;
      setConnection(services.connection);
      services.startSync(setSyncStatus);
      const active = await services.setting('active');
      setRecent(active);
      const available = await services.sessions();
      if (!disposed) setSessions(available);
      const route = router.read();
      const mayRestoreRecent = !windows || windows.restoreRecent;
      const selected = windows?.session
        ? available.find((s) => s.id === windows.session)
        : (available.find((s) => s.workspaceId === route?.workspaceId) ??
          (mayRestoreRecent && (!loggedIn || restoringAuthorization)
            ? available.find((s) => s.id === active)
            : undefined));
      if (windows?.session && !selected) await windows.release();
      if (selected) {
        await activate(selected);
        void services.refreshRemote().catch((error) => {
          if (!disposed) reportError(error);
        });
      } else {
        const connection = services.connection;
        const discover = async () => {
          await services.refreshRemote(true);
          if (disposed || connection !== services.connection) return;
          const discovered = await services.sessions();
          const linked = discovered.find((s) => s.workspaceId === route?.workspaceId);
          if (linked && !sessionRef.current && router.read()?.workspaceId === route?.workspaceId)
            await activate(linked);
          if (!disposed) setSessions(discovered);
        };
        if (connection?.kind === 'folder') {
          void discover().catch((error) => {
            if (!disposed && connection === services.connection) setLoadError(errorMessage(error));
          });
        } else {
          await discover();
        }
      }
      if (!disposed) await refreshSessions();
    })()
      .catch((e) => {
        if (!disposed) setLoadError(errorMessage(e));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      stopCallbacks?.();
      stopClose?.();
      stopAssignments?.();
      services.onChange = () => {};
      services.onWorkspaceClosed = () => {};
      void services.dispose().catch((e) => reportError(e));
    };
    // Bootstrap once per service lifetime; activation reads session state from refs.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);
  async function activate(s: WorkspaceSession, fromHistory = false) {
    if (activating.current) return;
    if (sessionRef.current?.id === s.id && !fromHistory) return true;
    activating.current = true;
    setOpeningWorkspace(true);
    setBusy(true);
    try {
      const initial = !sessionRef.current;
      if (windows && !(await windows.claim(s.id))) {
        const previous = sessionRef.current;
        if (previous && fromHistory)
          router.write(previous.workspaceId, previous.selectedId ?? '', true);
        return;
      }
      const next = await services.open(s);
      if (!next) return;
      await windows?.commit(s.id);
      runtimeRef.current = next;
      setRuntime(next);
      setSession(s);
      sessionRef.current = s;
      const route = router.read();
      const target = fromHistory || route?.workspaceId === s.workspaceId ? route?.id : s.selectedId;
      const activeSession = { ...s, selectedId: target ?? '' };
      setSession(activeSession);
      sessionRef.current = activeSession;
      await services.saveSession(activeSession);
      setSelected(target ?? '');
      const routed = route?.workspaceId === s.workspaceId;
      setGraph(!!(routed && route.graph));
      setLocationTarget((v) => ({
        anchor: routed ? route.anchor : undefined,
        requestId: v.requestId + 1,
      }));
      router.write(
        s.workspaceId,
        target ?? '',
        fromHistory || initial,
        routed ? route.anchor : undefined,
        !!(routed && route.graph),
      );
      setPreviewId(null);
      try {
        const pref = JSON.parse(localStorage.getItem('tio.sidebar.' + s.workspaceId) ?? '{}');
        setSidebarWidth(Math.min(400, Math.max(220, pref.width ?? 260)));
        setSidebarCollapsed(!!pref.collapsed);
      } catch {
        /* defaults */
      }
      setMenu(false);
      setSidebar(false);
      setSyncStatus({ phase: 'idle' });
      setError('');
      await services.setting('active', s.id);
      setRecent(s.id);
      await refreshSessions();
      services.startSync(setSyncStatus);
      return true;
    } catch (error) {
      reportError(error);
      const previous = sessionRef.current;
      if (previous) router.write(previous.workspaceId, previous.selectedId ?? '', true);
    } finally {
      if (windows) await windows.cancel().catch(reportError);
      activating.current = false;
      setOpeningWorkspace(false);
      setBusy(false);
    }
  }
  useEffect(() => {
    return router.subscribe((route) => {
      const currentSession = sessionRef.current;
      if (route.workspaceId !== currentSession?.workspaceId) {
        const next = sessions.find((item) => item.workspaceId === route.workspaceId);
        if (next) void activate(next, true);
      } else {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        if (host.desktopChrome && currentSession && documentScroll.current?.clientHeight)
          scrollPositions.current.set(
            `${currentSession.workspaceId}/${currentSession.selectedId}`,
            documentScroll.current.scrollTop,
          );
        setGraph(route.graph);
        setSelected(route.id);
        setLocationTarget((v) => ({ anchor: route.anchor, requestId: v.requestId + 1 }));
        const requestedRoute = router.current();
        void runtime
          .loadTarget(route.id)
          .then(() => {
            if (runtimeRef.current !== runtime || router.current() !== requestedRoute) return;
            const target = runtime.snapshot().find((o) => o.id === route.id);
            if (target) navigate(target, true, route.anchor, route.graph);
          })
          .catch(reportError);
      }
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [router, sessions]);
  const desktopDocumentReady = !!host.desktopChrome && state.loads[selected] === 'ready';
  const desktopAnchor = !!host.desktopChrome && locationTarget.anchor;
  useEffect(() => {
    const y = scrollPositions.current.get(`${session?.workspaceId}/${selected}`) ?? 0;
    if (!host.desktopChrome) {
      const frame = requestAnimationFrame(() => window.scrollTo(0, y));
      return () => cancelAnimationFrame(frame);
    }
    const pane = documentScroll.current;
    if (graph || !pane || desktopAnchor) return;

    pane.scrollTop = desktopDocumentReady ? y : 0;
    const body = pane.querySelector('main');
    if (!desktopDocumentReady || !body || pane.scrollTop >= y - 1) return;

    // Block layout can finish after the document has been loaded.
    const observer = new ResizeObserver(() => {
      pane.scrollTop = y;
      if (pane.scrollTop >= y - 1) observer.disconnect();
    });
    observer.observe(body);
    const stop = () => observer.disconnect();
    const timeout = setTimeout(stop, 500);
    pane.addEventListener('wheel', stop, { once: true, passive: true });
    pane.addEventListener('pointerdown', stop, { once: true });
    pane.addEventListener('keydown', stop, { once: true });
    return () => {
      stop();
      clearTimeout(timeout);
      pane.removeEventListener('wheel', stop);
      pane.removeEventListener('pointerdown', stop);
      pane.removeEventListener('keydown', stop);
    };
  }, [
    selected,
    session?.workspaceId,
    graph,
    host.desktopChrome,
    desktopDocumentReady,
    desktopAnchor,
  ]);
  function resizeSidebar(width: number) {
    const next = Math.min(400, Math.max(220, width));
    setSidebarWidth(next);
    try {
      localStorage.setItem(
        'tio.sidebar.' + sessionRef.current?.workspaceId,
        JSON.stringify({ width: next, collapsed: sidebarCollapsed }),
      );
    } catch {
      /* optional */
    }
  }
  function collapseSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(
        'tio.sidebar.' + sessionRef.current?.workspaceId,
        JSON.stringify({ width: sidebarWidth, collapsed: next }),
      );
    } catch {
      /* optional */
    }
  }
  function restoreObject(id: string) {
    command((runtime) => runtime.restoreObject(id));
  }
  function deleteObject(o: TioObject) {
    patch(o, { deleted: true }, true);
    toast(t('ui.deleted'), {
      action: { label: t('common.undo'), onClick: () => restoreObject(o.id) },
    });
  }
  function command(action: (runtime: WorkspaceRuntime) => void) {
    try {
      if (runtimeRef.current) action(runtimeRef.current);
    } catch (error) {
      reportError(error);
    }
  }
  function patch(target: TioObject, changes: Partial<TioObject>, remember = false) {
    if (editable(target)) command((runtime) => runtime.patch(target.id, changes, remember));
  }

  function navigate(
    o: Pick<TioObject, 'id' | 'workspaceId'>,
    fromHistory = false,
    anchor?: ContentAnchor,
    showGraph = false,
  ) {
    if (o.workspaceId !== sessionRef.current?.workspaceId) return;
    if (!graph && !fromHistory)
      scrollPositions.current.set(
        `${sessionRef.current?.workspaceId}/${sessionRef.current?.selectedId}`,
        host.desktopChrome ? (documentScroll.current?.scrollTop ?? 0) : window.scrollY,
      );
    if (!fromHistory) router.write(o.workspaceId, o.id, false, anchor, showGraph);
    setGraph(showGraph);
    setLocationTarget((v) => ({ anchor, requestId: v.requestId + 1 }));
    setPreviewId(null);
    setSelected(o.id);
    setSidebar(false);
    setSearching(false);
    const s = sessionRef.current;
    if (s) {
      const next = { ...s, selectedId: o.id };
      sessionRef.current = next;
      setSession(next);
      void services.saveSession(next).catch((e) => reportError(e));
    }
  }
  async function navigateTarget(target: { id: string; anchor?: ContentAnchor }) {
    const active = runtimeRef.current;
    if (!active) return;
    try {
      await active.loadTarget(target.id);
      if (runtimeRef.current !== active) return;
      const object = active.snapshot().find((o) => o.id === target.id);
      if (object) navigate(object, false, target.anchor);
      else
        navigate(
          { id: target.id, workspaceId: sessionRef.current!.workspaceId },
          false,
          target.anchor,
        );
    } catch (error) {
      reportError(error);
    }
  }
  async function openGraph(id: string) {
    const active = runtimeRef.current;
    if (!active) return;
    try {
      await active.flush();
      if (runtimeRef.current !== active) return;
      scrollPositions.current.set(
        `${sessionRef.current?.workspaceId}/${sessionRef.current?.selectedId}`,
        host.desktopChrome ? (documentScroll.current?.scrollTop ?? 0) : window.scrollY,
      );
      setGraph(true);
      setSelected(id);
      setPreviewId(null);
      setSidebar(false);
      router.write(sessionRef.current!.workspaceId, id, false, undefined, true);
    } catch (error) {
      reportError(error);
    }
  }
  const contentLinks = {
    create: contentUrl,
    accepts(text: string) {
      try {
        const url = new URL(text);
        const route = readRoute(url.hash);
        return (
          url.origin === location.origin &&
          url.pathname === location.pathname &&
          !!route &&
          !route.graph &&
          route.workspaceId === sessionRef.current?.workspaceId
        );
      } catch {
        return false;
      }
    },
    async parse(text: string): Promise<ContentTarget | undefined> {
      const active = runtimeRef.current;
      if (!active) return;
      const url = new URL(text);
      if (url.origin !== location.origin || url.pathname !== location.pathname) return;
      const route = readRoute(url.hash);
      if (!route || route.graph || route.workspaceId !== sessionRef.current?.workspaceId) return;
      const metadata = await active.mentionMetadata([route.id]);
      if (runtimeRef.current !== active) return;
      const object = metadata.entries.find((e) => e.object.id === route.id)?.object;
      if (
        !object ||
        object.deleted ||
        !active.can(object, 'read') ||
        !['page', 'database', 'record'].includes(object.type)
      )
        return;
      const target = {
        workspaceId: route.workspaceId,
        id: route.id,
        kind: object.type as ContentTarget['kind'],
        anchor: route.anchor,
      };
      return isContentTarget(target) ? target : undefined;
    },
  };
  async function loadSpaces() {
    setLoading(true);
    setLoadError('');
    try {
      await refreshSessions();
      await services.refreshRemote(true);
      await refreshSessions();
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  function connect(...args: Parameters<WorkspaceServices['connect']>) {
    const work = () => services.connect(...args);
    return windows ? windows.changeConnection(work) : work();
  }
  async function openInNewWindow(session?: WorkspaceSession) {
    if (!windows?.enabled) return;
    try {
      await windows.open(session?.id);
    } catch (error) {
      reportError(error);
    }
  }
  useEffect(() => {
    if (!windows?.enabled || !host.desktopChrome) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void host.desktopChrome
      .subscribe((action) => {
        if (action === 'new-window') void openInNewWindow();
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(reportError);
    function shortcut(event: KeyboardEvent) {
      if (
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.altKey ||
        event.isComposing ||
        event.code !== 'KeyN'
      )
        return;
      event.preventDefault();
      if (!event.repeat) void openInNewWindow();
    }
    window.addEventListener('keydown', shortcut);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener('keydown', shortcut);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [host, windows]);
  async function offline() {
    if (services.connection) {
      setCreating(true);
      return;
    }
    setLoading(true);
    try {
      await connect('device');
      setConnection(services.connection);
      await loadSpaces();
    } catch (e) {
      setLoadError(errorMessage(e));
      setLoading(false);
    }
  }
  async function createWorkspace(name: string) {
    if (!name.trim() || creation.current.running) return;
    creation.current.running = true;
    setBusy(true);
    setError('');
    try {
      const s = creation.current.session ?? (await services.create(starterWorkspace(name, t)));
      creation.current.session = s;
      await refreshSessions();
      if (await activate(s)) setCreating(false);
    } catch (e) {
      reportError(e);
    } finally {
      creation.current.running = false;
      setBusy(false);
    }
  }
  async function signInGit(provider: GitProvider, token?: string) {
    try {
      setBusy(true);
      const current = gitConnection(services.connection?.id);
      const expected = current?.provider === provider ? current.userId : undefined;
      if (token === undefined) {
        await runtimeRef.current?.flush();
        if ((await loginGit(provider, expected)) !== 'success') return;
      } else {
        await connectToken(provider, token, expected);
      }
      if (!services.connection || (token === undefined && services.connection.kind !== provider))
        await connect(provider);
      else if (services.connection.kind === provider) await services.credentialsChanged();
      setConnection(services.connection);
      services.startSync(setSyncStatus);
      setTokenProvider(undefined);
      await loadSpaces();
    } catch (e) {
      if (sessionRef.current) services.reportStatusError(e);
      else reportError(e);
    } finally {
      setBusy(false);
    }
  }
  async function folder() {
    try {
      const handle = await pickFolder();
      setBusy(true);
      await connect('folder', handle);
      setConnection(services.connection);
      services.startSync(setSyncStatus);
      setBusy(false);
      await loadSpaces();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') reportError(e);
    } finally {
      setBusy(false);
    }
  }
  async function authorize() {
    const git = gitConnection(services.connection?.id);
    if (git && (!platform().auth.origin || credentials()?.mode !== 'app')) {
      setTokenProvider(git.provider);
      return;
    }
    await services.authorize();
    if (!runtimeRef.current && services.access?.code === 'available') {
      const active = await services.setting('active');
      const available = await services.sessions();
      const saved = available.find((s) => s.id === active);
      if (saved) await activate(saved);
    }
  }
  async function logout() {
    setLogoutError('');
    setLoggingOut(true);
    try {
      if (windows) await windows.changeConnection(() => coordinator.current!.logout());
      else await coordinator.current!.logout();
    } catch (error) {
      setLogoutError(errorMessage(error));
    }
  }
  function addPage(parentId: string | null = null) {
    const o = newPage(session!.workspaceId, parentId, t);
    command((runtime) => {
      runtime.create([o]);
      setPreviewId(o.id);
      setSidebar(false);
    });
  }

  function addDatabase() {
    const items = newDatabase(session!.workspaceId, null, t);
    command((runtime) => {
      runtime.create(items);
      navigate(items[0]);
    });
  }
  async function download(reading = false) {
    try {
      const runtime = runtimeRef.current!;
      await runtime.flush();
      const bytes = await (reading ? exportMarkdownZip : exportZip)(
        await runtime.exportObjects(),
        async (id) => (await runtime.readAsset(id))?.bytes,
      );
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workspace?.name ?? session!.name}.${reading ? 'markdown' : 'tio'}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      reportError(e);
    }
  }
  async function importFile(file: File) {
    try {
      const data = await importZip(new Uint8Array(await file.arrayBuffer()));
      const workspaceId = id('workspace');
      const rekeySlices = (blocks: import('@tio/core').Block[]): import('@tio/core').Block[] =>
        blocks.map((block) => ({
          ...block,
          ...(block.type === 'appSlice' ? { id: id('block') } : {}),
          children: rekeySlices(block.children),
        }));
      const s = await services.create(
        data.objects.map((o) => ({
          ...o,
          workspaceId,
          ...(o.blocks ? { blocks: rekeySlices(o.blocks) } : {}),
          ...(o.type === 'workspace' ? { id: workspaceId } : {}),
        })),
        new Map(
          [...data.assets].map(([id, bytes]) => [
            id,
            {
              name: '',
              mime: data.objects.find((o) => o.id === id)?.mime ?? 'application/octet-stream',
              bytes,
            },
          ]),
        ),
        true,
      );
      setConnection(services.connection);
      await refreshSessions();
      await activate(s);
    } catch (e) {
      reportError(e);
    }
  }
  const mentionCallbacks = useRef({ navigate, reportError });
  mentionCallbacks.current = { navigate, reportError };
  const mentionWorkspaceId = session?.workspaceId;
  const mentions = useMemo(
    () =>
      runtime && mentionWorkspaceId
        ? createMentionService(
            runtime,
            mentionWorkspaceId,
            (id, anchor) => {
              void runtime
                .loadTarget(id)
                .then(() => {
                  if (runtimeRef.current !== runtime) return;
                  const target = runtime.snapshot().find((o) => o.id === id);
                  if (target) mentionCallbacks.current.navigate(target, false, anchor);
                })
                .catch((error) => mentionCallbacks.current.reportError(error));
            },
            connection?.kind === 'github' || connection?.kind === 'gitee'
              ? () => services.mentionPeople(mentionWorkspaceId)
              : undefined,
            connection?.kind === 'gitee' ? 'gitee-user' : 'github-user',
          )
        : undefined,
    [runtime, mentionWorkspaceId, services, connection?.kind],
  );
  const isVisible = visibility(objects);
  const current = selected
    ? objects.find((o) => o.id === selected && isVisible(o))
    : (objects.find((o) => o.type === 'page' && isVisible(o)) ??
      objects.find((o) => o.type === 'database' && isVisible(o)));
  const workspace = objects.find((o) => o.type === 'workspace');
  const nav = objects.filter(
    (o) => ['page', 'database'].includes(o.type) && isVisible(o) && runtime?.can(o, 'read'),
  );
  useEffect(() => {
    if (
      !openingWorkspace &&
      !selected &&
      current &&
      (!services.contentReady || !state.navigationComplete)
    )
      navigate(current, true);
    // Lock the first discovered page so later arrivals do not change the current document.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [openingWorkspace, selected, current?.id]);
  useEffect(() => {
    if (!runtime || !session || openingWorkspace) return;
    const selectedObject = objects.find((o) => o.id === selected);
    if (previewId && objects.some((o) => o.id === previewId && !isVisible(o))) setPreviewId(null);
    if (
      (!services.contentReady || !state.navigationComplete) &&
      (!selectedObject || !isVisible(selectedObject))
    )
      return;
    if (!selected || (selectedObject && isVisible(selectedObject))) return;
    const next = navigationTree(nav)[0];
    if (next) navigate(next, true);
    else {
      setSelected('');
      setPreviewId(null);
      router.write(session.workspaceId, '', true);
      const nextSession = { ...sessionRef.current!, selectedId: '' };
      sessionRef.current = nextSession;
      setSession(nextSession);
      void services.saveSession(nextSession).catch(reportError);
    }
    // Selection repair follows deletion and external visibility changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, selected, previewId, runtime, openingWorkspace]);
  function favorite(o: TioObject) {
    const s = {
      ...session!,
      favorites: session!.favorites?.includes(o.id)
        ? session!.favorites!.filter((id) => id !== o.id)
        : [...(session!.favorites ?? []), o.id],
    };
    setSession(s);
    sessionRef.current = s;
    void services.saveSession(s).catch((e) => reportError(e));
  }

  const movePage = (source: string, parent: string | null, order?: number) =>
    command((runtime) => runtime.move(source, parent, order));
  const placePage = (source: string, parent: string | null, beforeId: string | null) =>
    command((runtime) => runtime.place(source, parent, beforeId));
  function renameWorkspace(name: string) {
    if (!workspace || !name.trim()) return;
    patch(workspace, { name: name.trim() });
    setSessions((previous) =>
      previous.map((item) => (item.id === session?.id ? { ...item, name: name.trim() } : item)),
    );
    setRenaming(false);
  }

  const issues = services.issues;
  const status = statusModel(
    saveStatus,
    syncStatus,
    services.hasReplicaSync,
    issues.length > 0,
    services.statusError,
  );
  const restoreAuthorization = async () => {
    try {
      await authorize();
    } catch (error) {
      services.reportStatusError(error);
    }
  };
  function syncWorkspace() {
    const id = sessionRef.current?.id ?? '';
    if (syncRequest.current?.id === id) return syncRequest.current.work;
    if (syncStatus.phase === 'syncing') return Promise.resolve();
    setSyncingSession(id);
    const work = services
      .sync()
      .catch((error) => {
        if ((sessionRef.current?.id ?? '') === id) services.reportStatusError(error);
      })
      .finally(() => {
        if (syncRequest.current?.work !== work) return;
        syncRequest.current = null;
        setSyncingSession(undefined);
      });
    syncRequest.current = { id, work };
    return work;
  }
  return {
    graph,
    documentScroll,
    locationTarget,
    navigateTarget,
    openGraph,
    contentLinks,
    hasReplicaSync: services.hasReplicaSync,
    manualSync:
      services.hasReplicaSync && (workspace ? workspace.manualSync === true : services.manualSync),
    canSetManualSync: !!workspace && editable(workspace) && !!runtime?.can(workspace),
    syncing: syncingSession === (session?.id ?? '') || syncStatus.phase === 'syncing',
    syncWorkspace,
    workspaceAction,
    actionBusy,
    actionError,
    workspaceActions: (target: WorkspaceSession) => services.workspaceActions(target),
    requestWorkspaceAction,
    closeWorkspaceAction: () => {
      if (!actionRunning.current) setWorkspaceAction(null);
    },
    executeWorkspaceAction,
    status,
    contentReady: services.contentReady,
    navigationReady: state.navigationComplete,
    queryIndexError:
      state.queryIndexState.status === 'error'
        ? (state.queryIndexState.error ?? t('workspace.prepareFailed'))
        : undefined,
    retryInitialization: syncWorkspace,
    restoreAuthorization,
    canReauthorize: services.canReauthorize,
    statusError: services.statusError,
    identity: services.identity,
    loading,
    openingWorkspace,
    loadError,
    loadSpaces,
    recent,
    creating,
    setCreating,
    createWorkspace,
    logoutOpen,
    setLogoutOpen,
    loggingOut,
    logoutError,
    signInGit,
    tokenProvider,
    setTokenProvider,
    automationOpen,
    setAutomationOpen,
    settingsOpen,
    setSettingsOpen,
    trashOpen,
    setTrashOpen,
    renameId,
    setRenameId,
    previewId,
    setPreviewId,
    sidebarWidth,
    resizeSidebar,
    sidebarCollapsed,
    collapseSidebar,
    deleteObject,
    restoreObject,
    connection,
    supportsSync: services.supportsSync,
    runtime,
    resolveMedia,
    renaming,
    setRenaming,
    renameWorkspace,
    session,
    sessions,
    objects,
    selected,
    saveStatus,
    saveError: state.error,
    syncStatus,
    error,
    busy,
    menu,
    sidebar,
    query,
    searching,
    importRef,
    current,
    workspace,
    nav,
    mentions,
    moveTarget,
    issues,
    setError,
    setMenu,
    setSidebar,
    setQuery,
    setSearching,
    setMoveTarget,
    activate,
    canOpenWindow: windows?.enabled ?? false,
    openInNewWindow,
    offline,
    folder,
    authorize,
    logout,
    addPage,
    addDatabase,
    patch,
    navigate,
    download,
    importFile,
    favorite,
    movePage,
    placePage,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
