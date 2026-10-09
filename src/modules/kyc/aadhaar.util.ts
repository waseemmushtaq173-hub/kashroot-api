/**
 * Aadhaar number handling. Nothing here persists or logs a full number — see
 * the privacy note on the KycSubmission model.
 *
 * The web KYC panel runs the same checks before it calls the API, but a client
 * check is not a security boundary: anything that reaches a licensed KUA on our
 * behalf has to be validated here too.
 */

/**
 * Verhoeff check digit, the scheme UIDAI uses for the twelfth digit. It catches
 * every single-digit typo and every adjacent transposition, which a plain
 * length check does not — without it the sandbox (and later a real KUA, at a
 * cost per call) accepts any twelve digits a user fat-fingers.
 */
const D5 = [
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
] as const;

const PERM = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

function verhoeffIsValid(digits: string): boolean {
  let checksum = 0;
  // The number is processed right to left, so index 0 is the check digit.
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    checksum = D5[checksum][PERM[i % 8][Number(reversed[i])]];
  }
  return checksum === 0;
}

/**
 * True for a structurally valid Aadhaar: exactly twelve digits, a first digit
 * of 2–9 (UIDAI does not issue numbers starting 0 or 1), and a correct Verhoeff
 * check digit. It says nothing about whether the number is real or active —
 * only the verifier can answer that.
 */
export function isValidAadhaar(value: string): boolean {
  const digits = value.replace(/\s+/g, '');
  if (!/^[2-9][0-9]{11}$/.test(digits)) return false;
  return verhoeffIsValid(digits);
}

/** Strips the spaces a user pastes in from "1234 5678 9012" groupings. */
export function normaliseAadhaar(value: string): string {
  return value.replace(/\s+/g, '');
}

/** The only part of an Aadhaar number that may be stored or displayed. */
export function aadhaarLast4(value: string): string {
  return normaliseAadhaar(value).slice(-4);
}

/**
 * The form the number may appear in a log line or error message:
 * XXXXXXXX9012. Use it instead of interpolating the number anywhere.
 */
export function maskAadhaar(value: string): string {
  const digits = normaliseAadhaar(value);
  return `${'X'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
