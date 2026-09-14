import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter — normalises all errors to a consistent JSON shape.
 * Hides internal details in production; logs full stack always.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[];
    if (isHttp) {
      const res = exception.getResponse();
      message =
        typeof res === 'object' && 'message' in (res as object)
          ? (res as any).message
          : exception.message;
    } else {
      // Never leak internal error messages to clients in production
      message =
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : (exception as Error)?.message ?? 'Internal server error';
    }

    this.logger.error(
      `${request.method} ${request.url} → ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}
