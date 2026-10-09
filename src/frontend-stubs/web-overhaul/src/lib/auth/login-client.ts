/**
 * Browser client for POST /api/v1/auth/login (see the API's AuthController).
 *
 * Contract: `{ email | phone, password, totpCode? }` →
 * `{ accessToken, user: { id, email, phone, roles, mfaEnabled } }`, plus an
 * httpOnly `refresh_token` cookie — which is why the request is sent with
 * `credentials: 'include'`. A 401 with message MFA_REQUIRED means the account is
 * enrolled in TOTP and the same call must be repeated with `totpCode`.
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

export interface AuthSession {
  accessToken: string;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    roles: string[];
    mfaEnabled: boolean;
  };
}

export class LoginError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: 'MFA_REQUIRED' | 'NETWORK',
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

/**
 * Anything containing "@" is an email; otherwise an Indian mobile number in any
 * common spelling ("98765 43210", "098765-43210", "+91 98765 43210") becomes
 * the E.164 form the API stores ("+919876543210").
 */
export function toCredentialIdentifier(input: string): { email: string } | { phone: string } {
  const trimmed = input.trim();
  if (trimmed.includes('@')) return { email: trimmed };

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return { phone: `+91${digits}` };
  if (digits.length === 11 && digits.startsWith('0')) return { phone: `+91${digits.slice(1)}` };
  if (digits.length === 12 && digits.startsWith('91')) return { phone: `+${digits}` };
  return { phone: trimmed.startsWith('+') ? `+${digits}` : digits };
}

export async function loginWithPassword(input: {
  identifier: string;
  password: string;
  totpCode?: string;
}): Promise<AuthSession> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        ...toCredentialIdentifier(input.identifier),
        password: input.password,
        ...(input.totpCode ? { totpCode: input.totpCode } : {}),
      }),
    });
  } catch {
    throw new LoginError('We couldn’t reach Kashroot. Check your connection and try again.', 0, 'NETWORK');
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    if (message === 'MFA_REQUIRED') {
      throw new LoginError('Enter the 6-digit code from your authenticator app.', res.status, 'MFA_REQUIRED');
    }
    throw new LoginError(friendlyMessage(message, res.status), res.status);
  }

  const session = (await res.json()) as AuthSession;
  currentSession = session;
  return session;
}

/**
 * The signed-in session, held in memory on purpose: the access token lives ~15
 * minutes and the httpOnly refresh cookie restores it (POST /auth/refresh) after
 * a reload, so nothing token-shaped is written to localStorage where injected
 * script could read it. If the app has an AuthContext, hand the session to its
 * `signIn` instead.
 */
let currentSession: AuthSession | null = null;

export function getSession(): AuthSession | null {
  return currentSession;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    // Nest sends `message` as a string, or a string[] for validation failures.
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
    return typeof message === 'string' ? message : res.statusText;
  } catch {
    return res.statusText;
  }
}

function friendlyMessage(message: string, status: number): string {
  if (status === 429) return 'Too many attempts. Please wait a minute and try again.';
  if (status >= 500) return 'Something went wrong on our side. Please try again shortly.';
  if (message === 'Invalid credentials') {
    return 'Those details don’t match an account. Check your mobile number or email and password.';
  }
  return message;
}
