import {
  mentionKey,
  visibility,
  recordTitle,
  HostError,
  githubMentionUrl,
  type MentionCandidate,
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
  people?: () => Promise<MentionCandidate[]>,
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
        .filter((o) => ['page', 'database', 'record'].includes(o.type))
        .map((o) => [
          o.id,
          o.title,
          o.name,
          o.properties,
          o.fields,
          o.deleted,
          o.parentId,
          runtime.can(o, 'read'),
        ]),
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
      const visible = visibility([...entries.map((e) => e.object), ...runtime.snapshot()]);
      for (const item of batch) {
        const ref = item.reference;
        const object =
          runtime.snapshot().find((o) => o.id === ref.id) ??
          entries.find((e) => e.object.id === ref.id)?.object;
        const result: MentionResolution =
          ref.workspaceId !== workspaceId || denied.has(ref.id)
            ? { reference: ref, status: 'denied' }
            : !object || object.type !== ref.kind || object.workspaceId !== workspaceId
              ? { reference: ref, status: 'missing' }
              : object.deleted || !visible(object)
                ? { reference: ref, status: 'deleted' }
                : !runtime.can(object, 'read')
                  ? { reference: ref, status: 'denied' }
                  : {
                      reference: ref,
                      status: 'ready',
                      title:
                        object.type === 'record'
                          ? recordTitle(object, runtime.snapshot())
                          : object.title || object.name || 'Untitled',
                    };
        item.resolve(result);
      }
    } catch (error) {
      batch.forEach((item) => item.reject(error));
    }
  };
  return {
    kinds: ['page', 'database', 'record', ...(people ? ['github-user' as const] : [])],
    async query(text, after, kind) {
      let cursor: {
        text: string;
        kind?: MentionReference['kind'];
        content?: string;
        contentDone?: boolean;
        person: number;
      } = {
        text,
        kind,
        person: 0,
      };
      if (after) {
        try {
          cursor = JSON.parse(after);
          if (
            cursor.text !== text ||
            cursor.kind !== kind ||
            !Number.isSafeInteger(cursor.person) ||
            cursor.person < 0 ||
            (cursor.content !== undefined && typeof cursor.content !== 'string') ||
            (cursor.contentDone !== undefined && typeof cursor.contentDone !== 'boolean')
          )
            throw new Error();
        } catch {
          throw new HostError('invalid', 'Invalid mention cursor');
        }
      }
      const [content, collaborators] = await Promise.allSettled([
        cursor.contentDone || kind === 'github-user'
          ? Promise.resolve({ items: [] as MentionCandidate[], next: undefined })
          : runtime.mentionCandidates(text, cursor.content, kind),
        people && (!kind || kind === 'github-user')
          ? people()
          : Promise.resolve([] as MentionCandidate[]),
      ]);
      const sourceErrors: ('content' | 'github')[] = [];
      if (content.status === 'rejected') sourceErrors.push('content');
      if (collaborators.status === 'rejected') sourceErrors.push('github');
      const items =
        content.status === 'fulfilled'
          ? content.value.items.filter((item) => {
              const known = runtime.snapshot().find((o) => o.id === item.reference.id);
              return (
                item.reference.workspaceId === workspaceId && (!known || runtime.can(known, 'read'))
              );
            })
          : [];
      const users =
        collaborators.status === 'fulfilled'
          ? collaborators.value.filter(
              (item) =>
                item.reference.workspaceId === workspaceId &&
                item.title.toLocaleLowerCase().includes(text.replace(/^@/, '').toLocaleLowerCase()),
            )
          : [];
      const selected = users.slice(cursor.person, cursor.person + 50);
      const nextContent = content.status === 'fulfilled' ? content.value.next : undefined;
      const person = cursor.person + selected.length;
      return {
        items: [...items, ...selected],
        next:
          nextContent || person < users.length
            ? JSON.stringify({
                text,
                kind,
                content: nextContent,
                contentDone: !nextContent,
                person,
              })
            : undefined,
        sourceErrors,
      };
    },
    resolve(references) {
      return Promise.all(
        references.map((reference) => {
          if (reference.kind === 'github-user')
            return Promise.resolve<MentionResolution>({
              reference,
              ...(reference.workspaceId === workspaceId
                ? { status: 'ready', title: `@${reference.login}` }
                : { status: 'denied' }),
            });
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
                (o) => ['page', 'database', 'record'].includes(o.type) && !runtime.can(o, 'read'),
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
      if (ref.workspaceId !== workspaceId) return;
      const url = githubMentionUrl(ref);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else navigate(ref.id);
    },
  };
}
