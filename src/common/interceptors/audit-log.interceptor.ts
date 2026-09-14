import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDIT_LOG_KEY } from '../decorators/audit-log.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Intercepts requests decorated with @AuditLog() and writes to audit_logs
 * after the handler succeeds. Failures are not audited (nothing happened).
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMeta = this.reflector.get<{ action: string; targetType?: string }>(
      AUDIT_LOG_KEY,
      context.getHandler(),
    );

    if (!auditMeta) return next.handle();

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? request.socket?.remoteAddress;

    return next.handle().pipe(
      tap(async (responseData) => {
        // Best-effort: never throw from audit log
        try {
          const targetId =
            request.params?.id ||
            responseData?.id ||
            request.body?.id ||
            'unknown';

          await this.prisma.auditLog.create({
            data: {
              actorUserId: user?.sub,
              action: auditMeta.action,
              targetType: auditMeta.targetType ?? 'unknown',
              targetId,
              ipAddress: ip,
              deviceInfo: {
                userAgent: request.headers['user-agent'],
              },
              metadata: {
                body: request.body,
                response: typeof responseData === 'object' ? responseData : undefined,
              },
            },
          });
        } catch (e) {
          // Swallow audit log errors — never break the real response
        }
      }),
    );
  }
}
