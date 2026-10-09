/**
 * GET /api/ifsc?code=SBIN0000001 — bank + branch for an IFSC, proxied from the
 * public Razorpay IFSC directory (https://ifsc.razorpay.com).
 *
 * Proxied rather than called from the browser so the panel never depends on a
 * third party's CORS policy, upstream answers are cached for a day (IFSC data
 * changes rarely), and the upstream can be swapped without touching the UI.
 *
 * 200 IfscDetails · 400 malformed code · 404 unknown IFSC · 502 upstream down.
 */
import { NextResponse } from 'next/server';

import { IFSC_PATTERN } from '@/lib/kyc/validators';

const UPSTREAM = 'https://ifsc.razorpay.com';

interface RazorpayIfsc {
  IFSC: string;
  BANK: string;
  BRANCH: string;
  CITY?: string;
  STATE?: string;
  ADDRESS?: string;
}

export async function GET(request: Request) {
  const code = (new URL(request.url).searchParams.get('code') ?? '').trim().toUpperCase();
  if (!IFSC_PATTERN.test(code)) {
    return NextResponse.json({ message: 'Malformed IFSC code' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/${code}`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return NextResponse.json({ message: 'IFSC directory unreachable' }, { status: 502 });
  }

  if (upstream.status === 404) {
    return NextResponse.json({ message: 'IFSC not found' }, { status: 404 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ message: 'IFSC directory error' }, { status: 502 });
  }

  const data = (await upstream.json()) as RazorpayIfsc;
  return NextResponse.json(
    {
      ifsc: data.IFSC,
      bank: data.BANK,
      branch: data.BRANCH,
      city: data.CITY,
      state: data.STATE,
      address: data.ADDRESS,
    },
    { headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
