import { chooseFolder } from '@tio/adapter-local-folder';
import { id, visibility, editable, type TioObject } from '@tio/core';
import type { WorkspaceSession, Connection } from '@tio/core';
import { t, i18n, errorMessage } from '@tio/i18n';
import { exportZip, exportMarkdownZip, importZip } from '@tio/serialization';
import { toast } from '@tio/ui';
import {
  sampleWorkspace,
  newPage,
  newDatabase,
  WorkspaceRuntime,
  emptyWorkspaceState,
} from '@tio/workspace';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { readRoute, writeRoute } from '../../services/navigation';
import { WorkspaceServices } from '../../services/workspace-services';
const emptyStore = createStore(() => emptyWorkspaceState);
export function useWorkspace() {
  const [services] = useState(() => new WorkspaceServices());
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null);
  const runtimeRef = useRef<WorkspaceRuntime | null>(null);
  const state = useStore(runtime?.state ?? emptyStore);
  const objects = state.objects;
  const saveStatus =
    state.status === 'error'
      ? '本地保存失败'
      : state.status === 'saving'
        ? '正在保存本地'
        : '已保存本地';
  const [connection, setConnection] = useState<Connection | null>(null);
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [selected, setSelected] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
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
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
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
  const refreshSessions = async () => setSessions(await services.sessions());
  useEffect(() => {
    let disposed = false;
    services.onChange = () => {
      if (!disposed) void refreshSessions().catch((e) => setError(errorMessage(e)));
    };
    void services
      .initialize()
      .then(async () => {
        setConnection(services.connection);
        services.startSync(setSyncStatus);
        await refreshSessions();
        const active = await services.setting('active');
        const available = await services.sessions();
        const route = readRoute();
        const selected =
          available.find((s) => s.workspaceId === route?.workspaceId) ??
          available.find((s) => s.id === active);
        if (selected) await activate(selected);
        if (!disposed) await services.refreshRemote();
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      disposed = true;
      services.onChange = () => {};
      void services.dispose().catch((e) => setError(errorMessage(e)));
    };
    // Bootstrap once per service lifetime; activation reads session state from refs.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);
  useEffect(() => {
    if (state.error) setError(errorMessage(state.error));
  }, [state.error]);
  async function activate(s: WorkspaceSession, fromHistory = false) {
    if (activating.current) return;
    activating.current = true;
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
      setSyncStatus('');
      setError('');
      await services.setting('active', s.id);
      await refreshSessions();
      services.startSync(setSyncStatus);
    } catch (error) {
      setError(errorMessage(error));
      const previous = sessionRef.current;
      if (previous) writeRoute(previous.workspaceId, previous.selectedId ?? '', true);
    } finally {
      activating.current = false;
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
      setError(errorMessage(error));
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
      void services.saveSession(next).catch((e) => setError(errorMessage(e)));
    }
  }
  async function offline() {
    setBusy(true);
    try {
      if (!services.connection) {
        await services.connect('device');
        setConnection(services.connection);
        await refreshSessions();
        return;
      }
      const s = await services.create(sampleWorkspace(i18n.language === 'en' ? 'en' : 'zh'));
      setConnection(services.connection);
      await refreshSessions();
      await activate(s);
    } catch (e) {
      setError(errorMessage(e));
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
      await refreshSessions();
      await services.refreshRemote();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function authorize() {
    await services.authorize();
  }
  async function logout() {
    try {
      await services.disconnect();
      setConnection(null);
      runtimeRef.current = null;
      setRuntime(null);
      setSession(null);
      await services.setting('active', null);
      await refreshSessions();
    } catch (error) {
      setError(errorMessage(error));
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
        runtime.snapshot(),
        async (id) => (await runtime.readAsset(id))?.bytes,
      );
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workspace?.name ?? session!.name}.${reading ? 'markdown' : 'tio'}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function importFile(file: File) {
    try {
      const data = await importZip(new Uint8Array(await file.arrayBuffer()));
      const workspaceId = id('workspace');
      const rekeySlices = (blocks: import('@tio/core').Block[]): import('@tio/core').Block[] =>
        blocks.map((block) => ({
          ...block,
          ...(block.type === 'webSlice' ? { id: id('block') } : {}),
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
      );
      setConnection(services.connection);
      await refreshSessions();
      await activate(s);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const isVisible = visibility(objects);
  const current = selected
    ? objects.find((o) => o.id === selected && isVisible(o))
    : (objects.find((o) => o.type === 'page' && isVisible(o)) ??
      objects.find((o) => o.type === 'database' && isVisible(o)));
  const workspace = objects.find((o) => o.type === 'workspace');
  const nav = objects.filter((o) => ['page', 'database'].includes(o.type) && isVisible(o));
  function favorite(o: TioObject) {
    const s = {
      ...session!,
      favorites: session!.favorites?.includes(o.id)
        ? session!.favorites!.filter((id) => id !== o.id)
        : [...(session!.favorites ?? []), o.id],
    };
    setSession(s);
    sessionRef.current = s;
    void services.saveSession(s).catch((e) => setError(errorMessage(e)));
  }

  const movePage = (source: string, parent: string | null, order?: number) =>
    command((runtime) => runtime.move(source, parent, order));
  function renameWorkspace(name: string) {
    if (!workspace || !name.trim()) return;
    patch(workspace, { name: name.trim() });
    setSessions((previous) =>
      previous.map((item) => (item.id === session?.id ? { ...item, name: name.trim() } : item)),
    );
    setRenaming(false);
  }

  const issues = services.issues;
  const syncNow = async () => {
    try {
      if (syncStatus === 'reauthorization-required' && services.canReauthorize) await authorize();
      else await services.sync();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const discardDraft = async (id: string) => {
    try {
      await services.discard(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const restoreFile = async (id: string) => {
    try {
      await services.restore(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const retrySave = async () => {
    try {
      await runtimeRef.current?.retry();
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return {
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
    retrySave,
    renaming,
    setRenaming,
    renameWorkspace,
    session,
    sessions,
    objects,
    selected,
    saveStatus,
    syncStatus,
    error,
    busy,
    menu,
    sidebar,
    query,
    searching,
    issuesOpen,
    importRef,
    current,
    workspace,
    nav,
    moveTarget,
    issues,
    setError,
    setMenu,
    setSidebar,
    setQuery,
    setSearching,
    setIssuesOpen,
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
    syncNow,
    restoreFile,
    discardDraft,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
