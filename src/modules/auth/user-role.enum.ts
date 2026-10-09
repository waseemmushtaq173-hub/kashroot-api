/**
 * Role names as they appear in access tokens.
 *
 * These values are compared against RbacService.resolveUserRoles(), which
 * returns Prisma's RoleName, so every member here must spell a RoleName
 * exactly or @Roles() silently matches nobody.
 *
 * PLATFORM_ADMIN is kept for the call sites that already reference it, but it
 * has no RoleName counterpart: the platform-wide admin role is SUPER_ADMIN.
 */
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  REGIONAL_ADMIN = 'REGIONAL_ADMIN',
  SUPPORT_MODERATOR = 'SUPPORT_MODERATOR',
  FARMER = 'FARMER',
  BUYER = 'BUYER',
  SELLER = 'SELLER',
  TESTER = 'TESTER',
  EXPERT = 'EXPERT',
}
