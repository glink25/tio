import type { EditorSession } from '@tio/workspace';

import type { AppSliceDiagnostic } from './types';

type Scope = { workspaceId: string; pageId: string; blockId: string; html: string };
type Observation = { html: string; error?: AppSliceDiagnostic };
const observations = new WeakMap<EditorSession, Map<string, Observation>>();
const keyOf = ({ workspaceId, pageId, blockId }: Scope) =>
  JSON.stringify([workspaceId, pageId, blockId]);

// The iframe supplies the method and field name. Never store arbitrary log text or payloads.
const sdkMethod =
  /^(context\.get|ui\.resize|pages?\.(get|getBlocks|update|insertBlocks|updateBlock|removeBlock)|databases\.(list|get|create)|records\.(query|get|create|update|delete)|(?:fields|views)\.(list|create|update|delete)|attachments\.(list|read|write|download|remove))$/;

export function observeAppSlice(runtime: EditorSession, scope: Scope) {
  const entries = observations.get(runtime) ?? new Map<string, Observation>();
  observations.set(runtime, entries);
  const key = keyOf(scope);
  let current = entries.get(key);
  if (!current || current.html !== scope.html) {
    current = { html: scope.html };
    entries.delete(key);
    entries.set(key, current);
    if (entries.size > 32) entries.delete(entries.keys().next().value!);
  }
  const observation = current;
  return (method: string, error: Omit<AppSliceDiagnostic, 'method'>) => {
    if (entries.get(key) === observation)
      observation.error = { method: sdkMethod.test(method) ? method : 'request', ...error };
  };
}

export function latestAppSliceError(runtime: EditorSession, scope: Scope) {
  const observation = observations.get(runtime)?.get(keyOf(scope));
  return observation?.html === scope.html ? observation.error : undefined;
}
