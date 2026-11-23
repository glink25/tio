import { HostError } from '@tio/core';
export type Grant = 'read' | 'edit';
export interface Scope {
  key: string;
  workspace: string;
  connection: string;
}
export interface StoredGrant extends Scope {
  grant: Grant;
}
const storageKey = 'tio.agent-permissions';
let revision = 0;
const listeners = new Set<() => void>();
function notify() {
  revision++;
  listeners.forEach((fn) => fn());
}
export function readGrants(): StoredGrant[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(values)
      ? values.filter(
          (v): v is StoredGrant =>
            v &&
            typeof v === 'object' &&
            ['key', 'workspace', 'connection'].every((k) => typeof v[k] === 'string') &&
            ['read', 'edit'].includes(v.grant),
        )
      : [];
  } catch {
    return [];
  }
}
export function setGrant(scope: Scope, grant?: Grant) {
  const rows = readGrants().filter((r) => r.key !== scope.key);
  if (grant) rows.push({ ...scope, grant });
  localStorage.setItem(storageKey, JSON.stringify(rows));
  notify();
}
export function clearGrants() {
  localStorage.removeItem(storageKey);
  notify();
}
export const subscribeGrants = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const grantRevision = () => revision;
window.addEventListener('storage', (event) => {
  if (event.key === storageKey || event.key === null) notify();
});
export interface Prompt {
  id: string;
  scope: Scope;
  level: Grant;
  error: boolean;
}
interface Waiting {
  scope: Scope;
  level: Grant;
  resolve: (lease: () => void) => void;
  reject: (error: unknown) => void;
  session: PermissionSession;
}
let queue: Waiting[] = [];
let prompt: Prompt | null = null;
const promptListeners = new Set<() => void>();
export const subscribePrompt = (fn: () => void) => {
  promptListeners.add(fn);
  return () => {
    promptListeners.delete(fn);
  };
};
export const currentPrompt = () => prompt;
const emit = () => promptListeners.forEach((fn) => fn());
function advance() {
  const first = queue[0];
  prompt = first
    ? { id: crypto.randomUUID(), scope: first.scope, level: first.level, error: false }
    : null;
  emit();
}
const includes = (grant: Grant | undefined, level: Grant) => grant === 'edit' || grant === level;
export function answerPrompt(allow: boolean, edit: boolean, remember: boolean) {
  if (!prompt) return;
  const active = prompt;
  const group = queue.filter((w) => w.scope.key === active.scope.key && w.level === active.level);
  if (allow && remember) {
    try {
      setGrant(active.scope, edit ? 'edit' : active.level);
    } catch {
      prompt = { ...active, error: true };
      emit();
      return;
    }
  }
  queue = queue.filter((w) => !group.includes(w));
  for (const waiting of group) {
    if (allow) waiting.resolve(waiting.session.lease(waiting.level, remember));
    else waiting.reject(new HostError('permission'));
  }
  // A persisted explicit edit grant may satisfy queued writes, without silently upgrading the visible dialog.
  const granted = queue.filter((w) =>
    includes(readGrants().find((g) => g.key === w.scope.key)?.grant, w.level),
  );
  queue = queue.filter((w) => !granted.includes(w));
  for (const w of granted) w.resolve(w.session.lease(w.level, true));
  advance();
}
export class PermissionSession {
  private closed = false;
  private epoch = 0;
  private stop = subscribeGrants(() => {
    this.epoch++;
  });
  constructor(readonly scope: Scope) {}
  async authorize(level: Grant) {
    if (this.closed) throw new HostError('closed');
    if (includes(readGrants().find((r) => r.key === this.scope.key)?.grant, level))
      return this.lease(level, true);
    return new Promise<() => void>((resolve, reject) => {
      queue.push({ scope: this.scope, level, resolve, reject, session: this });
      if (!prompt) advance();
    });
  }
  lease(level: Grant, persisted: boolean) {
    const epoch = this.epoch;
    return () => {
      if (this.closed) throw new HostError('closed');
      if (
        this.epoch !== epoch ||
        (persisted && !includes(readGrants().find((r) => r.key === this.scope.key)?.grant, level))
      )
        throw new HostError('permission');
    };
  }
  dispose() {
    this.closed = true;
    this.stop();
    const abandoned = queue.filter((w) => w.session === this);
    queue = queue.filter((w) => w.session !== this);
    abandoned.forEach((w) => w.reject(new HostError('closed')));
    if (abandoned.length) advance();
  }
}
