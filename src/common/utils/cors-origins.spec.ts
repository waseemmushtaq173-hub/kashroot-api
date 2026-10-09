import {
  buildCorsOriginCheck,
  CAPACITOR_ORIGINS,
  resolveAllowedOrigins,
} from './cors-origins';

/** Runs the check synchronously and reports what it told the cors package. */
function isAllowed(allowlist: readonly string[], origin: string | undefined): boolean {
  const check = buildCorsOriginCheck(allowlist);
  let result: boolean | undefined;
  let error: Error | null = null;

  check(origin, (err, allow) => {
    error = err;
    result = allow;
  });

  expect(error).toBeNull();
  return result === true;
}

describe('resolveAllowedOrigins', () => {
  it('splits a comma-separated CORS_ORIGINS value', () => {
    expect(
      resolveAllowedOrigins(['https://app.kashroot.com,https://staging.kashroot.com']),
    ).toEqual(['https://app.kashroot.com', 'https://staging.kashroot.com']);
  });

  it('drops unset and blank entries instead of allowing an empty origin', () => {
    expect(resolveAllowedOrigins(['http://localhost:3000', undefined, '', '  ', ',,'])).toEqual([
      'http://localhost:3000',
    ]);
  });

  it('trims whitespace around comma-separated entries', () => {
    expect(resolveAllowedOrigins([' https://a.example , https://b.example '])).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('strips trailing slashes, which an Origin header never carries', () => {
    expect(resolveAllowedOrigins(['http://localhost:3000/'])).toEqual([
      'http://localhost:3000',
    ]);
  });

  it('collapses duplicates', () => {
    expect(
      resolveAllowedOrigins(['http://localhost:3000', 'http://localhost:3000/']),
    ).toEqual(['http://localhost:3000']);
  });
});

describe('buildCorsOriginCheck', () => {
  const allowlist = resolveAllowedOrigins([
    'http://localhost:3000',
    'https://app.kashroot.com',
    ...CAPACITOR_ORIGINS,
  ]);

  it('allows an origin on the list', () => {
    expect(isAllowed(allowlist, 'https://app.kashroot.com')).toBe(true);
  });

  it('refuses an origin that is not on the list', () => {
    expect(isAllowed(allowlist, 'https://evil.example')).toBe(false);
  });

  it('refuses a look-alike that merely contains an allowed origin', () => {
    // The regression that a substring or startsWith check would let through.
    expect(isAllowed(allowlist, 'https://app.kashroot.com.evil.example')).toBe(false);
    expect(isAllowed(allowlist, 'https://evil.example?x=https://app.kashroot.com')).toBe(
      false,
    );
  });

  it('refuses a different scheme or port on an allowed host', () => {
    expect(isAllowed(allowlist, 'http://app.kashroot.com')).toBe(false);
    expect(isAllowed(allowlist, 'http://localhost:3001')).toBe(false);
  });

  it('allows the Capacitor WebView origins the mobile builds send', () => {
    for (const origin of CAPACITOR_ORIGINS) {
      expect(isAllowed(allowlist, origin)).toBe(true);
    }
  });

  it('allows a request with no Origin header (server-to-server, curl, probes)', () => {
    expect(isAllowed(allowlist, undefined)).toBe(true);
  });

  it('matches an allowed origin sent with a trailing slash', () => {
    expect(isAllowed(allowlist, 'http://localhost:3000/')).toBe(true);
  });

  it('refuses everything when the allowlist is empty, rather than reflecting', () => {
    expect(isAllowed([], 'https://app.kashroot.com')).toBe(false);
  });

  it('never reports an error, so a stray preflight cannot become a 500', () => {
    const check = buildCorsOriginCheck(allowlist);
    const callback = jest.fn();
    check('https://evil.example', callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });
});
