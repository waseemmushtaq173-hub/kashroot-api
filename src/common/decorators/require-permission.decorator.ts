import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'required_permissions';

/**
 * Declare the permission keys required to access this endpoint.
 * Evaluated by PermissionsGuard after JwtAuthGuard passes.
 *
 * @example
 * @RequirePermissions('listing:create:own')
 * @RequirePermissions('kyc:review', 'kyc:document:read')
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
