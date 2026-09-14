import { Request } from 'express';
import { RoleName } from '@prisma/client';

export interface AuthenticatedUser {
  sub: string;           // user UUID
  email?: string;
  phone?: string;
  roles: RoleName[];
  regionIds: string[];   // for REGIONAL_ADMIN scoping
  permissions: string[]; // resolved permission keys, cached in JWT
  mfaVerified: boolean;
}

export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}
