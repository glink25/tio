/** Stable first-party error identities; messages are diagnostic only. */
export type DomainErrorCode =
  | 'stale'
  | 'asset-size'
  | 'single-workspace'
  | 'backup-identity'
  | 'move-cycle'
  | 'identity'
  | 'future-version'
  | 'asset-missing'
  | 'asset-pending'
  | 'missing'
  | 'invalid-number'
  | 'close-tabs';
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
