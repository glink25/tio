import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { WorkspaceWindows } from '@tio/app/platform';
import { HostError } from '@tio/core';

type Context = {
  enabled: boolean;
  session: string | null;
  restoreRecent: boolean;
  desktop: boolean;
  generation: string;
};
type Assignments = { label: string; leader: string; sessions: Record<string, string> };
const request = <T>(action: string, args?: object) =>
  invoke<T>('window_host', { request: { action, ...args } }).catch((error: unknown) => {
    if (error === 'pending' || error === 'closed' || error === 'unsupported')
      throw new HostError(error);
    throw new HostError('unavailable');
  });

export async function createWindowHost() {
  const context = await request<Context>('context');
  let assignments = await request<Assignments>('assignments');
  let revision = 0;
  const observers = new Set<() => void>();
  const refreshAssignments = () => {
    const current = ++revision;
    void request<Assignments>('assignments')
      .then((next) => {
        if (current !== revision) return;
        assignments = next;
        for (const observer of observers) observer();
      })
      .catch(() => {});
  };
  await listen('tio-window-assignments', refreshAssignments);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAssignments();
  });
  refreshAssignments();
  const owns = (state: Assignments, session?: string) =>
    (session ? (state.sessions[session] ?? state.leader) : state.leader) === state.label;
  const windows: WorkspaceWindows = {
    enabled: context.enabled,
    session: context.session ?? undefined,
    restoreRecent: context.restoreRecent,
    claim: (session) => request('claim', { session }),
    commit: (session) => request('commit', { session }),
    cancel: () => request('cancel'),
    release: () => request('release'),
    open: (session) => request('open', { session }),
    ownsSync: (session) => owns(assignments, session),
    async confirmSyncOwner(session) {
      return owns(await request<Assignments>('assignments'), session);
    },
    subscribeAssignments(observer) {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    async onClose(prepare) {
      let closing = false;
      // Tauri's global listeners also receive events emitted to a specific window.
      const stop = await getCurrentWebviewWindow().listen('tio-window-close', async () => {
        if (closing) return;
        closing = true;
        let allowed = false;
        try {
          await prepare();
          allowed = true;
        } catch {
          // The workspace reports save failures and retains the active window.
        } finally {
          try {
            await request('close', { allowed });
          } finally {
            closing = false;
          }
        }
      });
      try {
        await request('listen');
        return stop;
      } catch (error) {
        stop();
        throw error;
      }
    },
    async changeConnection(work, session) {
      await request('beginChange', { session });
      try {
        const deadline = performance.now() + 10_000;
        while (!(await request<boolean>('changeStatus'))) {
          if (performance.now() >= deadline) throw new HostError('pending');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return await work();
      } finally {
        await request('endChange');
      }
    },
  };
  return {
    windows,
    desktop: context.desktop,
    label: assignments.label,
    generation: context.generation,
    takeMaintenance: () => request<boolean>('takeMaintenance'),
    canHandleCallback: (origin: string) => request<boolean>('callbackOwner', { origin }),
  };
}
