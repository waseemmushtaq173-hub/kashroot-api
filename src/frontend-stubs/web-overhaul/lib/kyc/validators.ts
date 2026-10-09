/**
 * Input masks and validators for the KYC panel. Pure functions, no React, so
 * they are trivially unit-testable and reusable server-side.
 *
 * Each `format*` function is an input mask: it takes whatever the user typed or
 * pasted and returns the canonical display value, dropping characters that are
 * not allowed at their position. Each `isValid*` checks a complete value.
 */

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

// ---------------------------------------------------------------------------
// Aadhaar — 12 digits, never starting 0 or 1, last digit a Verhoeff checksum.
// ---------------------------------------------------------------------------

/** "123456789012" → "1234 5678 9012" (max 12 digits). */
export function formatAadhaar(value: string): string {
  return digitsOnly(value)
    .slice(0, 12)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function isValidAadhaar(digits: string): boolean {
  return /^[2-9]\d{11}$/.test(digits) && verhoeffCheck(digits);
}

/** UIDAI's own masked form: only the last four digits are ever shown again. */
export function maskAadhaar(last4: string): string {
  return `XXXX XXXX ${last4}`;
}

// Verhoeff tables: d = dihedral group D5 multiplication, p = position permutation.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/**
 * True when the trailing check digit is right. Catches every single-digit typo
 * and every swap of two adjacent digits — the two mistakes people actually make
 * copying an Aadhaar number — before a round-trip to UIDAI.
 */
export function verhoeffCheck(digits: string): boolean {
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

// ---------------------------------------------------------------------------
// PAN — AAAAA9999A; the 4th letter encodes the holder type.
// ---------------------------------------------------------------------------

const PAN_HOLDER_TYPES: Record<string, string> = {
  P: 'Individual',
  C: 'Company',
  H: 'Hindu Undivided Family',
  F: 'Firm / LLP',
  A: 'Association of Persons',
  T: 'Trust',
  B: 'Body of Individuals',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government',
};

const PAN_PATTERN = /^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/;

/** Upper-cases and keeps only a letter in slots 1–5 and 10, a digit in 6–9. */
export function formatPan(value: string): string {
  let out = '';
  for (const ch of value.toUpperCase()) {
    if (out.length === 10) break;
    const wantsDigit = out.length >= 5 && out.length <= 8;
    if (wantsDigit ? /\d/.test(ch) : /[A-Z]/.test(ch)) out += ch;
  }
  return out;
}

export function isValidPan(pan: string): boolean {
  return PAN_PATTERN.test(pan);
}

/** "Individual" for ABCPE1234F; null until the 4th letter is a known type. */
export function panHolderType(pan: string): string | null {
  return PAN_HOLDER_TYPES[pan.charAt(3)] ?? null;
}

/** A specific reason a complete PAN is invalid, or null if it is valid. */
export function panError(pan: string): string | null {
  if (pan.length < 10 || isValidPan(pan)) return null;
  if (!panHolderType(pan)) return 'The 4th letter of a PAN is its holder type: P, C, H, F, A, T, B, L, J or G.';
  return 'PAN format is 5 letters, 4 digits, then 1 letter.';
}

// ---------------------------------------------------------------------------
// IFSC — 4-letter bank code, a literal zero, 6-character branch code.
// ---------------------------------------------------------------------------

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * Upper-cases and enforces the shape as the user types. The 5th character is
 * always the digit zero, so a typed letter "O" there — the most common IFSC
 * typo — is corrected rather than rejected.
 */
export function formatIfsc(value: string): string {
  let out = '';
  for (const raw of value.toUpperCase()) {
    if (out.length === 11) break;
    if (out.length < 4) {
      if (/[A-Z]/.test(raw)) out += raw;
    } else if (out.length === 4) {
      if (raw === '0' || raw === 'O') out += '0';
    } else if (/[A-Z0-9]/.test(raw)) {
      out += raw;
    }
  }
  return out;
}

export function isValidIfsc(ifsc: string): boolean {
  return IFSC_PATTERN.test(ifsc);
}

// ---------------------------------------------------------------------------
// Bank account — Indian account numbers are 9 to 18 digits.
// ---------------------------------------------------------------------------

export function formatAccountNumber(value: string): string {
  return digitsOnly(value).slice(0, 18);
}

export function isValidAccountNumber(digits: string): boolean {
  return /^\d{9,18}$/.test(digits) && !/^0+$/.test(digits);
}
