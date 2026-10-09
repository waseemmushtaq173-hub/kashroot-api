/**
 * /login/farmer · /login/buyer · /login/seller — one dedicated sign-in per
 * portal, replacing the global "Welcome Back" page. Any other role 404s.
 *
 * `params` and `searchParams` are awaited: they are Promises from Next 15 on,
 * and awaiting the plain objects Next 14 passes is harmless, so this file works
 * on both.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BuyerLogin } from '@/components/auth/BuyerLogin';
import { FarmerLogin } from '@/components/auth/FarmerLogin';
import { SellerLogin } from '@/components/auth/SellerLogin';
import { isPortalRole, ROLE_LABELS, type PortalRole } from '@/lib/auth/roles';

const LOGINS: Record<PortalRole, typeof FarmerLogin> = {
  farmer: FarmerLogin,
  buyer: BuyerLogin,
  seller: SellerLogin,
};

interface LoginPageProps {
  params: Promise<{ role: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
}

export async function generateMetadata({ params }: LoginPageProps): Promise<Metadata> {
  const { role } = await params;
  return { title: isPortalRole(role) ? `${ROLE_LABELS[role]} sign in · Kashroot` : 'Sign in · Kashroot' };
}

export default async function RoleLoginPage({ params, searchParams }: LoginPageProps) {
  const { role } = await params;
  if (!isPortalRole(role)) notFound();

  const { next } = await searchParams;
  const Login = LOGINS[role];
  return <Login next={typeof next === 'string' ? next : undefined} />;
}
