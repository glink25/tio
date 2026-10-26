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
        references.map(
          (reference) =>
            new Promise<MentionResolution>((resolve, reject) => {
              pending.push({ reference, resolve, reject });
              if (!scheduled) {
                scheduled = true;
                queueMicrotask(() => {
                  void flush();
                });
              }
            }),
        ),
      );
    },
    subscribe(listener) {
      let signature = '';
      return runtime.state.subscribe((state) => {
        const next = JSON.stringify([
          state.version,
          state.status,
          state.objects
            .filter((o) => ['page', 'database'].includes(o.type))
            .map((o) => [
              mentionKey({
                workspaceId: o.workspaceId,
                kind: o.type as 'page' | 'database',
                id: o.id,
              }),
              o.title,
              o.name,
              o.deleted,
              runtime.can(o, 'read'),
            ]),
        ]);
        if (signature !== next) {
          signature = next;
          listener();
        }
      });
    },
    navigate(ref) {
      if (ref.workspaceId === workspaceId) navigate(ref.id);
    },
  };
}
