/**
 * Same-origin proxy to the Supabase project for the browser client
 * (src/lib/supabase.ts). Only the auth and data APIs are forwarded, only to
 * the configured project. When the project can't be reached the reply says
 * why — wrong address, paused project — in words the sign-in form shows.
 *
 * It also guards against attacks before they reach Supabase:
 *   - password guessing (lib/server/signinGuard): a growing wait after the
 *     3rd wrong password, a 15-minute pause after 8 in 15 minutes (or 40 from
 *     one network), a 1-hour lock after 15 in a day — with an email to the
 *     account when it is paused or locked;
 *   - mass sign-ups and reset-email floods from one network;
 *   - request floods on the data API.
 * The sign-in, sign-up and email counts are shared by every server instance
 * (lib/server/sharedLimit), so spreading the guesses over instances does not
 * help. Every sign-in (right or wrong), sign-up, reset email and pause is
 * logged (lib/server/securityLog) — hashed, never the email or password.
 * Supabase keeps its own limits behind this, for anyone calling it directly.
 * A sign-in on a new device and a changed password, email or phone send the
 * account an email notice (lib/server/accountNotices).
 * Limits are generous because many farmers share one mobile-network address.
 */
const FIFTEEN_MIN = 15 * 60_000;
const paused = (msg: string, retryAfter = 900) => Response.json({ msg: `[setup] ${msg}`, message: `[setup] ${msg}`, error: 'too_many_requests' }, { status: 429, headers: { 'retry-after': String(retryAfter) } });

/** The email or phone in a sign-in / reset request, lower-cased. */
function account(body: ArrayBuffer | undefined): string {
  if (!body || body.byteLength > 20_000) return '';
  try {
    const j = JSON.parse(new TextDecoder().decode(body)) as { email?: string; phone?: string };
    return String(j.email ?? j.phone ?? '').trim().toLowerCase().slice(0, 200);
  } catch {
    return '';
  }
}
import { afterPasswordSignIn, afterUserChange } from '@/lib/server/accountNotices';
import { gateOn, passedGate } from '@/lib/server/gate';
import { recordWrongPassword, rightPassword, signinBlock } from '@/lib/server/signinGuard';
import { securityEvent } from '@/lib/server/securityLog';
import { hashed, sharedLimited } from '@/lib/server/sharedLimit';
import { clientIp, rateLimited } from '@/lib/server/sign';
import { supabaseOrigin } from '@/lib/supabase-config';

export const dynamic = 'force-dynamic';

const ALLOWED = /^(auth|rest)\/v1(\/|$)/;
const PASS_REQUEST = ['apikey', 'authorization', 'content-type', 'accept', 'accept-profile', 'content-profile', 'prefer', 'range', 'x-client-info', 'x-supabase-api-version'];
const PASS_RESPONSE = ['content-type', 'content-range', 'x-supabase-api-version', 'preference-applied', 'retry-after'];

/** auth-js reads `msg`; "[setup]" tells the form to show it as is. */
const problem = (status: number, msg: string) => Response.json({ msg: `[setup] ${msg}`, message: `[setup] ${msg}` }, { status });

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  // Only Supabase's sign-in and data APIs, and no path tricks ("..", encoded slashes).
  const parts = (await params).path;
  const path = parts.join('/');
  if (!ALLOWED.test(path) || parts.some((p) => p === '..' || p === '.' || /[\\/%]/.test(p))) return Response.json({ msg: 'Not found' }, { status: 404 });
  const origin = supabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!origin) return problem(503, 'Sign-in is not set up on this site yet: add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel and redeploy.');

  const headers = new Headers();
  for (const name of PASS_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;
  const ip = hashed(clientIp(request));
  const query = new URL(request.url).searchParams;
  const passwordSignIn = path === 'auth/v1/token' && query.get('grant_type') === 'password';
  const who = passwordSignIn || /^auth\/v1\/(recover|otp|resend)$/.test(path) ? account(body) : '';

  const whoKey = who ? hashed(who) : '';

  // The security gate (lib/server/gate): when the "I am human" check is working,
  // sign-in, sign-up, reset and code emails need the gate cookie. When Turnstile
  // is broken the gate lets people through ("Continue to sign-in") and this logs
  // the missing cookie but does not block — the rate limits below still protect.
  if ((passwordSignIn || /^auth\/v1\/(signup|recover|otp|resend)$/.test(path)) && gateOn() && !passedGate(request)) {
    securityEvent('bot_check_failed', { request, code: 'gate: skipped', detail: `(${path})` });
  }

  if (passwordSignIn) {
    const block = await signinBlock(request, who, whoKey, ip);
    if (block) return paused(block.message, block.retryAfter);
  } else if (path === 'auth/v1/signup') {
    if (await sharedLimited(`signup-ip:${ip}`, 30, 60 * 60_000)) {
      securityEvent('signup_paused', { request, path, status: 429, detail: '30 new accounts from one network in an hour' });
      return paused('Too many new accounts from this network. Please try again in an hour.');
    }
  } else if (who) {
    if ((await sharedLimited(`mail:${whoKey}`, 4, FIFTEEN_MIN)) || (await sharedLimited(`mail-ip:${ip}`, 20, FIFTEEN_MIN))) {
      securityEvent('email_paused', { request, account: who, path, status: 429, detail: 'too many emails or codes in 15 min' });
      return paused('Too many emails or codes requested. Please wait 15 minutes.');
    }
  } else if (path.startsWith('rest/')) {
    if (rateLimited(`rest-ip:${ip}`, 1200, 60_000)) return Response.json({ message: 'Too many requests. Please wait a minute.' }, { status: 429, headers: { 'retry-after': '60' } });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/${path}${new URL(request.url).search}`, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error)?.name;
    const host = new URL(origin).host;
    console.error('Supabase proxy:', host, cause);
    if (cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') {
      return problem(502, `The sign-in service address saved for this site (${host}) does not exist. In Supabase open Project Settings → Data API, copy the Project URL exactly, put it in Vercel as NEXT_PUBLIC_SUPABASE_URL and redeploy.`);
    }
    if (cause === 'TimeoutError') return problem(504, 'The sign-in service took too long to answer. Please try again in a minute.');
    return problem(502, `Could not connect to the sign-in service (${host}). If the Supabase project is paused, open the Supabase dashboard and restore it.`);
  }

  if (upstream.status === 540 || (upstream.status >= 500 && !(upstream.headers.get('content-type') ?? '').includes('json'))) {
    return problem(503, 'The sign-in service is paused or not responding. Open the Supabase dashboard; if the project shows \"Paused\", press Restore, then try again.');
  }

  // Everyone's sign-in traffic reaches Supabase from this server's few
  // addresses, so its per-address limit can answer "too many" to a session
  // refresh. As a 429 that makes the browser delete the session (signed out);
  // as a 503 it keeps the session and simply tries again a little later.
  const keepsSession = (path === 'auth/v1/token' && query.get('grant_type') === 'refresh_token') || path === 'auth/v1/user';
  if (upstream.status === 429 && keepsSession) {
    return Response.json({ msg: 'The sign-in service is busy. Trying again shortly.', message: 'The sign-in service is busy.' }, { status: 503, headers: { 'retry-after': '30', 'cache-control': 'no-store' } });
  }

  // A refused sign-in: read Supabase's reason — only a wrong password counts towards the lock.
  let refusedText: string | null = null;
  if (passwordSignIn && (upstream.status === 400 || upstream.status === 401)) {
    refusedText = await upstream.text();
    const code = (() => {
      try {
        return String((JSON.parse(refusedText) as { error_code?: string }).error_code ?? '');
      } catch {
        return '';
      }
    })();
    if (code === 'captcha_failed') securityEvent('bot_check_failed', { request, path, status: upstream.status, code: 'supabase-captcha_failed' });
    else await recordWrongPassword(request, who, whoKey, ip);
  }
  if (passwordSignIn) {
    if (upstream.ok) {
      await rightPassword(whoKey);
      securityEvent('signin_ok', { request, account: who, path, status: upstream.status });
    }
  } else if (path === 'auth/v1/signup' && upstream.ok) {
    securityEvent('signup', { request, path, status: upstream.status });
  } else if (path === 'auth/v1/recover' && upstream.ok) {
    securityEvent('reset_email', { request, account: who, path, status: upstream.status });
  } else if (upstream.status === 401 || upstream.status === 403) {
    // A data request refused (no permission, or an expired / forged token): worth seeing when it comes in waves.
    if (path.startsWith('rest/')) securityEvent('forbidden', { request, path: path.split('?')[0].slice(0, 120), status: upstream.status });
  }

  const out = new Headers();
  for (const name of PASS_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set('cache-control', 'no-store');
  if (refusedText !== null) return new Response(refusedText, { status: upstream.status, headers: out });
  // Security notices need the account the answer names: read it, then pass it on unchanged.
  if (upstream.ok && (passwordSignIn || (path === 'auth/v1/user' && request.method === 'PUT'))) {
    const text = await upstream.text();
    if (passwordSignIn) {
      const remember = afterPasswordSignIn(request, text);
      if (remember) out.append('set-cookie', remember);
    } else afterUserChange(body, text);
    return new Response(text, { status: upstream.status, headers: out });
  }
  return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
