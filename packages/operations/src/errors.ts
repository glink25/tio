import { DomainError, HostError } from '@tio/core';
import { z } from 'zod';
export type OperationErrorCode =
  | 'permission'
  | 'conflict'
  | 'invalid'
  | 'unsupported'
  | 'closed'
  | 'unavailable'
  | 'pending'
  | 'limit';
export class OperationError extends Error {
  constructor(
    readonly code: OperationErrorCode,
    message: string = code,
    readonly path?: string,
  ) {
    super(message);
  }
}
export function errorResult(error: unknown) {
  if (error instanceof z.ZodError)
    return {
      code: 'invalid' as const,
      message: 'Invalid operation arguments',
      issues: error.issues.map((i) => ({ path: '/' + i.path.join('/'), message: i.message })),
    };
  if (error instanceof OperationError)
    return {
      code: error.code,
      message: error.message,
      ...(error.path ? { path: error.path } : {}),
    };
  if (error instanceof HostError)
    return { code: error.code === 'timeout' ? 'pending' : error.code, message: error.message };
  if (error instanceof DomainError) return { code: 'invalid' as const, message: error.message };
  return {
    code: 'invalid' as const,
    message: error instanceof Error ? error.message : 'Invalid operation',
  };
}
