import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../guards/jwt-auth.guard';

/**
 * Mark a route as public — JwtAuthGuard will skip authentication.
 * Use sparingly: only for truly unauthenticated endpoints.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
