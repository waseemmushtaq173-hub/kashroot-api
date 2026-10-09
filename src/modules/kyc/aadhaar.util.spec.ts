import { aadhaarLast4, isValidAadhaar, maskAadhaar, normaliseAadhaar } from './aadhaar.util';

/**
 * UIDAI's published sample numbers. They are the only fixtures here with
 * correct Verhoeff check digits by construction, which is what makes them worth
 * pinning: a broken checksum table would still pass a hand-rolled example.
 */
const VALID = [
  '999941057058',
  '999971658847',
  '999933119405',
  '999955183433',
  '999990161280',
];

describe('isValidAadhaar', () => {
  it.each(VALID)('accepts the UIDAI sample %s', (value) => {
    expect(isValidAadhaar(value)).toBe(true);
  });

  it('accepts a number typed in 4-4-4 groups', () => {
    expect(isValidAadhaar('9999 4105 7058')).toBe(true);
  });

  it('rejects a single-digit typo — the whole point of the check digit', () => {
    expect(isValidAadhaar('999941057059')).toBe(false);
  });

  it('rejects an adjacent transposition', () => {
    expect(isValidAadhaar('999941057085')).toBe(false);
  });

  it.each(['0' + '99941057058', '1' + '99941057058'])(
    'rejects %s: UIDAI issues no number starting 0 or 1',
    (value) => {
      expect(isValidAadhaar(value)).toBe(false);
    },
  );

  it.each([
    '99994105705', // eleven digits
    '9999410570580', // thirteen
    '',
    '99994105705X',
    'not-a-number',
  ])('rejects malformed input %p', (value) => {
    expect(isValidAadhaar(value)).toBe(false);
  });
});

describe('normaliseAadhaar / aadhaarLast4 / maskAadhaar', () => {
  it('strips the spaces a user pastes in', () => {
    expect(normaliseAadhaar('9999 4105 7058')).toBe('999941057058');
  });

  it('keeps only the last four digits', () => {
    expect(aadhaarLast4('9999 4105 7058')).toBe('7058');
  });

  it('masks everything but the last four digits', () => {
    expect(maskAadhaar('999941057058')).toBe('XXXXXXXX7058');
  });

  it('never leaves the full number in a masked value', () => {
    expect(maskAadhaar('999941057058')).not.toContain('999941057058');
  });
});
