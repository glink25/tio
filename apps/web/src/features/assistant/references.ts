import type { ConversationReference } from '@glink25/chaty';
import type { EditorSurfaceProps } from '@tio/web-editor';

export type SelectionQuote = Parameters<NonNullable<EditorSurfaceProps['onAskAssistant']>>[0];
export interface AssistantReference extends ConversationReference {
  selection: SelectionQuote;
}
export const assistantScope = (connectionId: string, workspaceId: string) =>
  JSON.stringify(['tio', connectionId, workspaceId]);
export function selectionReference(
  scope: string,
  selection: SelectionQuote,
  title: string,
): AssistantReference {
  return {
    type: 'tio.selection',
    id: crypto.randomUUID(),
    label: `${title} · ${selection.text.slice(0, 80)}`,
    hostScope: scope,
    selection: structuredClone(selection),
  };
}
