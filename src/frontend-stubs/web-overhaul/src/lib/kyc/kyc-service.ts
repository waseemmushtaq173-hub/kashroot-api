/**
 * KYC service adapter for KYCPanel — the one place to swap simulation for real
 * verification.
 *
 * IFSC lookup is real: it calls this app's /api/ifsc route, which proxies the
 * public Razorpay IFSC directory. Set NEXT_PUBLIC_IFSC_MOCK=true to answer from
 * the bank-code table below instead (offline development, demos).
 *
 * Aadhaar OTP and DigiLocker are SIMULATED — the Kashroot API has no
 * verification endpoints yet. Real Aadhaar e-KYC only works through a
 * UIDAI-licensed KUA or a DigiLocker partner (API Setu), with credentials that
 * must never reach the browser. When the API grows those routes (e.g.
 * POST /kyc/aadhaar/otp, POST /kyc/aadhaar/verify, GET /kyc/digilocker/start),
 * replace the three simulated functions with fetches to them; the signatures
 * are already what the panel needs.
 *
 * Simulation rules: any valid Aadhaar receives an OTP; any 6-digit OTP verifies
 * except 000000, which is rejected so the error state can be exercised.
 */
import { isValidIfsc } from './validators';

export interface IfscDetails {
  ifsc: string;
  bank: string;
  branch: string;
  city?: string;
  state?: string;
  address?: string;
}

export interface IdentityVerification {
  /** Opaque reference from the verifier, stored instead of the Aadhaar number. */
  referenceId: string;
  aadhaarLast4: string;
}

export class IfscNotFoundError extends Error {
  constructor(ifsc: string) {
    super(`No bank branch found for IFSC ${ifsc}`);
    this.name = 'IfscNotFoundError';
  }
}

export class OtpRejectedError extends Error {
  constructor() {
    super('That OTP is incorrect or has expired.');
    this.name = 'OtpRejectedError';
  }
}

const USE_IFSC_MOCK = process.env.NEXT_PUBLIC_IFSC_MOCK === 'true';
const ifscCache = new Map<string, IfscDetails>();

export async function lookupIfsc(ifsc: string, signal?: AbortSignal): Promise<IfscDetails> {
  const cached = ifscCache.get(ifsc);
  if (cached) return cached;

  const details = USE_IFSC_MOCK ? await mockIfscLookup(ifsc, signal) : await fetchIfsc(ifsc, signal);
  ifscCache.set(ifsc, details);
  return details;
}

async function fetchIfsc(ifsc: string, signal?: AbortSignal): Promise<IfscDetails> {
  const res = await fetch(`/api/ifsc?code=${encodeURIComponent(ifsc)}`, { signal });
  if (res.status === 404) throw new IfscNotFoundError(ifsc);
  if (!res.ok) throw new Error(`IFSC lookup failed (${res.status})`);
  return (await res.json()) as IfscDetails;
}

/**
 * The first four letters of an IFSC identify the bank, so the mock names the
 * bank correctly and says plainly that the branch is a placeholder.
 */
const BANK_CODES: Record<string, string> = {
  JAKA: 'Jammu & Kashmir Bank',
  SBIN: 'State Bank of India',
  HDFC: 'HDFC Bank',
  ICIC: 'ICICI Bank',
  PUNB: 'Punjab National Bank',
  UTIB: 'Axis Bank',
  BARB: 'Bank of Baroda',
  CNRB: 'Canara Bank',
  UBIN: 'Union Bank of India',
  KKBK: 'Kotak Mahindra Bank',
};

async function mockIfscLookup(ifsc: string, signal?: AbortSignal): Promise<IfscDetails> {
  await delay(700, signal);
  const bank = BANK_CODES[ifsc.slice(0, 4)];
  if (!bank || !isValidIfsc(ifsc)) throw new IfscNotFoundError(ifsc);
  return { ifsc, bank, branch: `Branch ${ifsc.slice(5)} (mock lookup)` };
}

// ---------------------------------------------------------------------------
// Simulated identity verification — see the file header before shipping.
// ---------------------------------------------------------------------------

const pendingOtps = new Map<string, string>();

/** Asks UIDAI to text an OTP to the Aadhaar-linked mobile. */
export async function requestAadhaarOtp(aadhaarDigits: string): Promise<{ txnId: string }> {
  await delay(1100);
  const txnId = simulatedId('sim-otp');
  pendingOtps.set(txnId, aadhaarDigits.slice(-4));
  return { txnId };
}

export async function verifyAadhaarOtp(txnId: string, otp: string): Promise<IdentityVerification> {
  await delay(1000);
  const last4 = pendingOtps.get(txnId);
  if (!last4 || !/^\d{6}$/.test(otp) || otp === '000000') throw new OtpRejectedError();
  pendingOtps.delete(txnId);
  return { referenceId: txnId, aadhaarLast4: last4 };
}

/**
 * Real flow: redirect to DigiLocker's consent screen, then read the verified
 * Aadhaar back on the callback. Simulated here as an instant consent.
 */
export async function verifyWithDigiLocker(): Promise<IdentityVerification> {
  await delay(1600);
  return { referenceId: simulatedId('sim-dl'), aadhaarLast4: '0000' };
}

/** Not crypto.randomUUID(): that is undefined over plain http on a LAN IP. */
function simulatedId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
