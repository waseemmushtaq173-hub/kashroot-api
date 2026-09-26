/**
 * RoleLayoutRouter — the top-level shell selector. It reads the authenticated
 * `UserRole` and mounts a COMPLETELY different layout per persona, so a farmer
 * on a cheap Android phone and a buyer on a desktop console never share chrome.
 *
 * In Next.js App Router this sits in the root layout (or a (protected) group
 * layout) wrapping {children}; the nested route segments render inside the
 * chosen persona layout's <main>. On React Native this maps to a role-switched
 * root navigator.
 */
import type { ReactNode } from 'react';

import { personaForRole, useAuth } from '../auth/AuthContext';
import { FarmerLayout } from '../layouts/FarmerLayout';
import { BuyerLayout } from '../layouts/BuyerLayout';
import { ExpertLayout } from '../layouts/ExpertLayout';
import { AdminLayout } from '../layouts/AdminLayout';

export function RoleLayoutRouter({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();

  // Unauthenticated -> the app shell should redirect to /login. Kept explicit
  // here so the router never renders a persona shell without an identity.
  if (!user || !role) {
    return <UnauthenticatedGate />;
  }

  switch (personaForRole(role)) {
    case 'farmer':
      return <FarmerLayout>{children}</FarmerLayout>;
    case 'buyer':
      return <BuyerLayout>{children}</BuyerLayout>;
    case 'expert':
      return <ExpertLayout>{children}</ExpertLayout>;
    case 'admin':
      return <AdminLayout>{children}</AdminLayout>;
  }
}

function UnauthenticatedGate() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <p className="text-slate-600">Redirecting to sign in…</p>
    </div>
  );
}
