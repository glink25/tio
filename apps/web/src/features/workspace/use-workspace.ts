import { chooseFolder } from '@tio/adapter-local-folder';
import { AssetResolver } from '@tio/assets/browser';
import { id, visibility, editable, ConnectionAccessError, type TioObject } from '@tio/core';
import type { WorkspaceSession, Connection } from '@tio/core';
import { t, i18n, errorMessage } from '@tio/i18n';
import { exportZip, exportMarkdownZip, importZip } from '@tio/serialization';
import type { SyncSnapshot } from '@tio/sync';
import { toast } from '@tio/ui';
import { createMentionService } from '@tio/web-editor';
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

import {
  connectToken,
  finishGitHubLogin,
  credentials,
  loginGitHub,
} from '../../services/github-auth';
import { logoutCoordinator } from '../../services/logout';
import { readRoute, writeRoute } from '../../services/navigation';
import { WorkspaceServices } from '../../services/workspace-services';
import { statusModel } from './status';
const emptyStore = createStore(() => emptyWorkspaceState);
export function useWorkspace() {
  const [services] = useState(() => new WorkspaceServices());
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
  const [syncStatus, setSyncStatus] = useState<SyncSnapshot>({ phase: 'idle' });
  const [syncing, setSyncing] = useState(false);
  const syncRequest = useRef<Promise<void> | null>(null);
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
      await services.abandon();
      runtimeRef.current = null;
      setRuntime(null);
    });
    return () => coordinator.current?.close();
  }, [services]);
  const [githubOpen, setGithubOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activating = useRef(false);
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
      if (operation === 'delete') await services.deleteWorkspace(target);
      else await action.execute();
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
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
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
      history.replaceState({}, '', location.pathname + location.search);
    };
    services.onChange = () => {
      if (!disposed) void refreshSessions().catch((e) => reportError(e));
    };
    void (async () => {
      const loggedIn = await finishGitHubLogin();
      await services.initialize();
      const restoringAuthorization =
        loggedIn && services.connection?.id === `github-${credentials()?.userId}`;
      if (loggedIn && !restoringAuthorization) await services.connect('github');
      if (disposed) return;
      setConnection(services.connection);
      services.startSync(setSyncStatus);
      const active = await services.setting('active');
      setRecent(active);
      const available = await services.sessions();
      const route = readRoute();
      const selected =
        available.find((s) => s.workspaceId === route?.workspaceId) ??
        (!loggedIn || restoringAuthorization ? available.find((s) => s.id === active) : undefined);
      if (selected) {
        await activate(selected);
        await services.refreshRemote();
      } else {
        await services.refreshRemote(true);
        const discovered = await services.sessions();
        const linked = discovered.find((s) => s.workspaceId === route?.workspaceId);
        if (linked) await activate(linked);
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
      services.onChange = () => {};
      services.onWorkspaceClosed = () => {};
      void services.dispose().catch((e) => reportError(e));
    };
    // Bootstrap once per service lifetime; activation reads session state from refs.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);
  async function activate(s: WorkspaceSession, fromHistory = false) {
    if (activating.current) return;
    activating.current = true;
    setOpeningWorkspace(true);
    setBusy(true);
    try {
      const initial = !sessionRef.current;
      const next = await services.open(s);
      if (!next) return;
      runtimeRef.current = next;
      setRuntime(next);
      setSession(s);
      sessionRef.current = s;
      const route = readRoute();
      const target = fromHistory || route?.workspaceId === s.workspaceId ? route?.id : s.selectedId;
      const activeSession = { ...s, selectedId: target ?? '' };
      setSession(activeSession);
      sessionRef.current = activeSession;
      await services.saveSession(activeSession);
      setSelected(target ?? '');
      writeRoute(s.workspaceId, target ?? '', fromHistory || initial);
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
      if (previous) writeRoute(previous.workspaceId, previous.selectedId ?? '', true);
    } finally {
      activating.current = false;
      setOpeningWorkspace(false);
      setBusy(false);
    }
  }
  useEffect(() => {
    const pop = () => {
      const route = readRoute();
      if (!route || history.state?.tioOverlay) return;
      const currentSession = sessionRef.current;
      if (route.workspaceId !== currentSession?.workspaceId) {
        const next = sessions.find((item) => item.workspaceId === route.workspaceId);
        if (next) void activate(next, true);
      } else {
        const target = runtimeRef.current
          ?.snapshot()
          .find((item) => item.id === route.id && item.workspaceId === route.workspaceId);
        if (target && target.id !== currentSession?.selectedId) navigate(target, true);
      }
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      window.scrollTo(0, scrollPositions.current.get(`${session?.workspaceId}/${selected}`) ?? 0),
    );
    return () => cancelAnimationFrame(frame);
  }, [selected, session?.workspaceId]);
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

  function navigate(o: TioObject, fromHistory = false) {
    if (o.workspaceId !== sessionRef.current?.workspaceId) return;
    scrollPositions.current.set(
      `${sessionRef.current?.workspaceId}/${sessionRef.current?.selectedId}`,
      window.scrollY,
    );
    if (!fromHistory) writeRoute(o.workspaceId, o.id);
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
  async function loadSpaces() {
    setLoading(true);
    setLoadError('');
    try {
      await services.refreshRemote(true);
      await refreshSessions();
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  async function offline() {
    if (services.connection) {
      setCreating(true);
      return;
    }
    setLoading(true);
    try {
      await services.connect('device');
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
      const s =
        creation.current.session ??
        (await services.create(starterWorkspace(name, i18n.language === 'en' ? 'en' : 'zh')));
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
  async function github(token?: string) {
    try {
      setBusy(true);
      const expected =
        services.connection?.kind === 'github'
          ? Number(services.connection.id.replace('github-', ''))
          : undefined;
      if (!token) {
        await runtimeRef.current?.flush();
        await loginGitHub(expected);
        return;
      }
      await connectToken(token, expected);
      if (!services.connection) await services.connect('github');
      else if (services.connection.kind === 'github') await services.credentialsChanged();
      setConnection(services.connection);
      services.startSync(setSyncStatus);
      setGithubOpen(false);
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
      const { handle } = await chooseFolder();
      setBusy(true);
      await services.connect('folder', handle);
      setConnection(services.connection);
      services.startSync(setSyncStatus);
      await loadSpaces();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') reportError(e);
    } finally {
      setBusy(false);
    }
  }
  async function authorize() {
    if (services.connection?.kind === 'github' && credentials()?.mode !== 'app') {
      setGithubOpen(true);
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
      await coordinator.current!.logout();
    } catch (error) {
      setLogoutError(errorMessage(error));
    }
  }
  function addPage(parentId: string | null = null) {
    const o = newPage(session!.workspaceId);
    o.title = t('common.untitled');
    o.parentId = parentId;
    command((runtime) => {
      runtime.create([o]);
      setPreviewId(o.id);
      setSidebar(false);
    });
  }

  function addDatabase() {
    const items = newDatabase(session!.workspaceId);
    items[0].name = t('workspace.newDatabase');
    if (i18n.language === 'en') {
      items[0].fields![0].name = 'Name';
      items[0].fields![1].name = 'Status';
      items[0].fields![1].options![0].label = 'To do';
      items[0].fields![1].options![1].label = 'Done';
      items[1].name = 'Default view';
    }
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
            (id) => {
              void runtime
                .loadTarget(id)
                .then(() => {
                  if (runtimeRef.current !== runtime) return;
                  const target = runtime.snapshot().find((o) => o.id === id);
                  if (target) mentionCallbacks.current.navigate(target);
                })
                .catch((error) => mentionCallbacks.current.reportError(error));
            },
            () => services.mentionPeople(mentionWorkspaceId),
          )
        : undefined,
    [runtime, mentionWorkspaceId, services],
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
    if (!runtime || !session || openingWorkspace) return;
    const selectedObject = objects.find((o) => o.id === selected);
    if (previewId && objects.some((o) => o.id === previewId && !isVisible(o))) setPreviewId(null);
    if (!selectedObject || isVisible(selectedObject)) return;
    const next = navigationTree(nav)[0];
    if (next) navigate(next, true);
    else {
      setSelected('');
      setPreviewId(null);
      writeRoute(session.workspaceId, '', true);
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
    if (syncRequest.current) return syncRequest.current;
    if (syncStatus.phase === 'syncing') return Promise.resolve();
    setSyncing(true);
    const request = services
      .sync()
      .catch((error) => services.reportStatusError(error))
      .finally(() => {
        syncRequest.current = null;
        setSyncing(false);
      });
    syncRequest.current = request;
    return request;
  }
  return {
    hasReplicaSync: services.hasReplicaSync,
    manualSync:
      services.hasReplicaSync && (workspace ? workspace.manualSync === true : services.manualSync),
    canSetManualSync: !!workspace && editable(workspace) && !!runtime?.can(workspace),
    syncing: syncing || syncStatus.phase === 'syncing',
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
    github,
    githubOpen,
    setGithubOpen,
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
