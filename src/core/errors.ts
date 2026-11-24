// Structured errors (SPEC §6). The HTTP layer maps `status` and `code`
// directly; the service layer throws these and never returns partial results.

import type { ResumeSummary } from './types.ts';

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_REFERENCE'
  | 'NOT_FOUND'
  | 'RECORD_IN_USE'
  | 'PROFILE_REQUIRED'
  | 'CONTENT_POLICY_VIOLATION'
  | 'ASSEMBLY_FAILED'
  | 'RENDER_FAILED';

const STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  INVALID_REFERENCE: 400,
  NOT_FOUND: 404,
  RECORD_IN_USE: 409,
  PROFILE_REQUIRED: 409,
  CONTENT_POLICY_VIOLATION: 409,
  ASSEMBLY_FAILED: 500,
  RENDER_FAILED: 500,
};

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly affectedResumes?: ResumeSummary[];

  constructor(code: ErrorCode, message: string, affectedResumes?: ResumeSummary[]) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = STATUS[code];
    if (affectedResumes) this.affectedResumes = affectedResumes;
  }
}

export const invalidInput = (message: string) => new ServiceError('INVALID_INPUT', message);
export const invalidReference = (message: string) => new ServiceError('INVALID_REFERENCE', message);
export const notFound = (message: string) => new ServiceError('NOT_FOUND', message);
