import { HostError } from '@tio/core';

const prefix = (scope: string) => `tio.assistant.authorizations:${scope}:`;
const resetKey = (scope: string) => prefix(scope) + 'reset';
const generation = (scope: string) => localStorage.getItem(resetKey(scope)) ?? '';
const resetEvent = 'tio:assistant-authorizations-reset';

export function resetAssistantAuthorizations(scope: string) {
  const grants = prefix(scope) + 'grant:';
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
  localStorage.setItem(resetKey(scope), crypto.randomUUID());
  window.dispatchEvent(new CustomEvent(resetEvent, { detail: scope }));
  for (const key of keys) if (key?.startsWith(grants)) localStorage.removeItem(key);
}

export function watchAssistantAuthorizations(scope: string, reset: () => void) {
  function local(event: Event) {
    if ((event as CustomEvent<string>).detail === scope) reset();
  }
  function remote(event: StorageEvent) {
    if (event.storageArea === localStorage && (event.key === null || event.key === resetKey(scope)))
      reset();
  }
  window.addEventListener(resetEvent, local);
  window.addEventListener('storage', remote);
  return () => {
    window.removeEventListener(resetEvent, local);
    window.removeEventListener('storage', remote);
  };
}

export function assistantAuthorization(scope: string) {
  const current = generation(scope);
  const key = (target: string) => prefix(scope) + 'grant:' + JSON.stringify([current, target]);
  return {
    check() {
      if (generation(scope) !== current) throw new HostError('permission');
    },
    has(target: string) {
      return localStorage.getItem(key(target)) === '1';
    },
    remember(target: string) {
      localStorage.setItem(key(target), '1');
    },
  };
}

export function abortWith(signals: (AbortSignal | undefined)[]) {
  const controller = new AbortController();
  const sources = signals.filter((signal) => signal !== undefined);
  const abort = () => controller.abort('closed');
  for (const signal of sources) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return {
    controller,
    dispose: () => {
      for (const signal of sources) signal.removeEventListener('abort', abort);
    },
  };
}
