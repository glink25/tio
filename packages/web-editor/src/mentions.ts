import {
  mentionKey,
  type MentionReference,
  type MentionResolution,
  type MentionService,
} from '@tio/core';
import type { EditorSession } from '@tio/workspace';

/** Metadata requests from a render are batched; no target bodies enter the runtime cache. */
export function createMentionService(
  runtime: EditorSession,
  workspaceId: string,
  navigate: (id: string) => void,
): MentionService {
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | undefined;
  let delay: ReturnType<typeof setTimeout> | undefined;
  let maximum: ReturnType<typeof setTimeout> | undefined;
  const clearTimers = () => {
    clearTimeout(delay);
    clearTimeout(maximum);
    delay = maximum = undefined;
  };
  const notify = () => {
    clearTimers();
    if (inflight.size) refreshAfterRead = true;
    for (const listener of listeners) listener();
  };
  const signature = () => {
    const state = runtime.state.getState();
    return JSON.stringify([
      state.version,
      state.status,
      state.objects
        .filter((o) => ['page', 'database'].includes(o.type))
        .map((o) => [o.id, o.title, o.name, o.deleted, runtime.can(o, 'read')]),
    ]);
  };
  const inflight = new Map<string, Promise<MentionResolution>>();
  let refreshAfterRead = false;
  let pending: {
    reference: MentionReference;
    resolve(value: MentionResolution): void;
    reject(error: unknown): void;
  }[] = [];
  let scheduled = false;
  const flush = async () => {
    const batch = pending;
    pending = [];
    scheduled = false;
    try {
      const ids = [
        ...new Set(
          batch.filter((x) => x.reference.workspaceId === workspaceId).map((x) => x.reference.id),
        ),
      ];
      const snapshots = [];
      for (let i = 0; i < ids.length; i += 1000)
        snapshots.push(await runtime.mentionMetadata(ids.slice(i, i + 1000)));
      const entries = snapshots.flatMap((s) => s.entries),
        denied = new Set(snapshots.flatMap((s) => s.denied ?? []));
      for (const item of batch) {
        const ref = item.reference;
        const object = entries.find((e) => e.object.id === ref.id)?.object;
        const result: MentionResolution =
          ref.workspaceId !== workspaceId || denied.has(ref.id)
            ? { reference: ref, status: 'denied' }
            : !object || object.type !== ref.kind || object.workspaceId !== workspaceId
              ? { reference: ref, status: 'missing' }
              : object.deleted
                ? { reference: ref, status: 'deleted' }
                : !runtime.can(object, 'read')
                  ? { reference: ref, status: 'denied' }
                  : {
                      reference: ref,
                      status: 'ready',
                      title: object.title || object.name || 'Untitled',
                    };
        item.resolve(result);
      }
    } catch (error) {
      batch.forEach((item) => item.reject(error));
    }
  };
  return {
    async query(text, after) {
      const page = await runtime.mentionCandidates(text, after);
      return {
        items: page.items
          .filter(
            (o) =>
              o.workspaceId === workspaceId &&
              !o.deleted &&
              ['page', 'database'].includes(o.type) &&
              runtime.can(o, 'read'),
          )
          .map((o) => ({
            reference: { workspaceId, kind: o.type as 'page' | 'database', id: o.id },
            title: o.title || o.name || 'Untitled',
          })),
        next: page.next,
      };
    },
    resolve(references) {
      return Promise.all(
        references.map((reference) => {
          const known = runtime.state.getState().objects.find((o) => o.id === reference.id);
          if (reference.workspaceId !== workspaceId || (known && !runtime.can(known, 'read')))
            return Promise.resolve<MentionResolution>({ reference, status: 'denied' });
          const key = mentionKey(reference);
          const existing = inflight.get(key);
          if (existing) return existing;
          const promise = new Promise<MentionResolution>((resolve, reject) => {
            pending.push({ reference, resolve, reject });
            if (!scheduled) {
              scheduled = true;
              queueMicrotask(() => {
                void flush();
              });
            }
          }).finally(() => {
            inflight.delete(key);
            if (!inflight.size && refreshAfterRead) {
              refreshAfterRead = false;
              queueMicrotask(() => {
                if (listeners.size) notify();
              });
            }
          });
          inflight.set(key, promise);
          return promise;
        }),
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      if (!unsubscribe) {
        let previous = signature();
        const deniedSignature = () =>
          JSON.stringify(
            runtime.state
              .getState()
              .objects.filter(
                (o) => ['page', 'database'].includes(o.type) && !runtime.can(o, 'read'),
              )
              .map((o) => o.id)
              .sort(),
          );
        let previousDenied = deniedSignature();
        unsubscribe = runtime.state.subscribe(() => {
          const next = signature();
          if (next === previous) return;
          previous = next;
          // Revoked access must not wait for the title refresh debounce.
          const denied = deniedSignature();
          const accessChanged = denied !== previousDenied;
          previousDenied = denied;
          if (accessChanged) notify();
          else {
            clearTimeout(delay);
            delay = setTimeout(notify, 1000);
            maximum ??= setTimeout(notify, 5000);
          }
        });
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          unsubscribe?.();
          unsubscribe = undefined;
          clearTimers();
          refreshAfterRead = false;
        }
      };
    },
    navigate(ref) {
      if (ref.workspaceId === workspaceId) navigate(ref.id);
    },
  };
}
