import { SetMetadata } from '@nestjs/common';

export const AUDIT_LOG_KEY = 'audit_log_action';

/**
 * Mark an endpoint for automatic audit logging.
 * The AuditLogInterceptor reads this metadata and writes to audit_logs.
 *
 * @example
 * @AuditLog('kyc:approve')
 * @AuditLog('user:suspend')
 */
export const AuditLog = (action: string, targetType?: string) =>
  SetMetadata(AUDIT_LOG_KEY, { action, targetType });
