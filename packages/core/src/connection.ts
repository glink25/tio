export type ConnectionAccessCode =
  | 'available'
  | 'reauthorization-required'
  | 'unreachable'
  | 'unrecoverable'
  | 'forbidden';
export interface ConnectionAccessState {
  code: ConnectionAccessCode;
  scope: { connectionId: string; workspaceId?: string };
}
/** Interactive authorization is host-only; background calls must never prompt. */
export interface ConnectionAdapter {
  readonly supportsSync: boolean;
  getAccessState(workspaceId?: string): Promise<ConnectionAccessState>;
  reauthorize?(workspaceId?: string): Promise<'success' | 'cancelled' | 'failed'>;
  subscribe(listener: (state: ConnectionAccessState) => void): () => void;
  classifyError(error: unknown): ConnectionAccessState;
}
/** Adapters use this for endpoint failures, distinct from resource-level AccessPolicy denial. */
export class ConnectionAccessError extends Error {
  constructor(readonly state: ConnectionAccessState) {
    super(state.code);
    this.name = 'ConnectionAccessError';
  }
}
export function connectionError(error: unknown, connectionId: string): ConnectionAccessState {
  if (error instanceof ConnectionAccessError) return error.state;
  const name = (error as Error)?.name;
  return {
    code:
      name === 'NotAllowedError'
        ? 'reauthorization-required'
        : name === 'NotFoundError'
          ? 'unrecoverable'
          : 'unreachable',
    scope: { connectionId },
  };
}
