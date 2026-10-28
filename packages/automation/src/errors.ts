import { HostError, type AutomationErrorCode } from '@tio/core';
export class AutomationError extends Error {
  constructor(readonly code: AutomationErrorCode) {
    super(code);
  }
}
export function errorCode(error: unknown): AutomationErrorCode {
  if (error instanceof AutomationError) return error.code;
  if (error instanceof HostError) return error.code === 'pending' ? 'conflict' : error.code;
  return 'io';
}
