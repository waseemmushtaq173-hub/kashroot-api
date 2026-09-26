/**
 * Authentication context. Holds the decoded JWT identity for the whole app and,
 * critically, the `UserRole` that the RoleLayoutRouter switches on to serve a
 * completely different shell per persona.
 *
 * The role list mirrors the backend `UserRole` enum (src/modules/auth/
 * user-role.enum.ts) — keep the two in sync. NOTE: `EXPERT` is a product
 * persona used by this frontend but is NOT yet in the backend enum (experts are
 * currently modelled via ExpertProfile + the expert-kyc module). Add `EXPERT`
 * to the backend enum, or map the expert persona onto an existing role, before
 * wiring real auth.
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { PreferredLanguage } from '../types';

export type UserRole =
  | 'PLATFORM_ADMIN'
  | 'REGIONAL_ADMIN'
  | 'SUPPORT_MODERATOR'
  | 'FARMER'
  | 'BUYER'
  | 'EXPERT';

export interface AuthUser {
  /** JWT `sub` — the user id. */
  id: string;
  displayName: string;
  role: UserRole;
  /** Drives the voice-first surfaces; farmers default to KASHMIRI. */
  preferredLanguage: PreferredLanguage;
  accessToken: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  signIn: (user: AuthUser) => void;
  signOut: () => void;
  /**
   * Update just the spoken-audio language for the current user. Backs the
   * farmer profile's LanguageSelector; persist to the API in the real app.
   */
  setPreferredLanguage: (language: PreferredLanguage) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode;
  initialUser?: AuthUser | null;
}) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      role: user?.role ?? null,
      isAuthenticated: user !== null,
      signIn: setUser,
      signOut: () => setUser(null),
      setPreferredLanguage: (language: PreferredLanguage) =>
        setUser((prev) => (prev ? { ...prev, preferredLanguage: language } : prev)),
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the current session. Throws if used outside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

/** Coarse persona grouping used by the router to pick a shell. */
export function personaForRole(role: UserRole): 'farmer' | 'buyer' | 'expert' | 'admin' {
  switch (role) {
    case 'FARMER':
      return 'farmer';
    case 'BUYER':
      return 'buyer';
    case 'EXPERT':
      return 'expert';
    case 'PLATFORM_ADMIN':
    case 'REGIONAL_ADMIN':
    case 'SUPPORT_MODERATOR':
      return 'admin';
  }
}
