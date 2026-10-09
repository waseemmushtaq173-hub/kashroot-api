import { ConfigService } from '@nestjs/config';

import { FieldEncryptionService } from './field-encryption.service';

const KEY = 'a'.repeat(64);

function service(value: string | undefined): FieldEncryptionService {
  return new FieldEncryptionService({
    get: () => value,
  } as unknown as ConfigService);
}

describe('FieldEncryptionService', () => {
  it('round-trips a value', () => {
    const svc = service(KEY);
    expect(svc.decrypt(svc.encrypt('001234567890'))).toBe('001234567890');
  });

  it('produces different ciphertext each time, so equal values are not linkable', () => {
    const svc = service(KEY);
    const a = svc.encrypt('001234567890');
    const b = svc.encrypt('001234567890');

    expect(a.equals(b)).toBe(false);
    expect(svc.decrypt(a)).toBe(svc.decrypt(b));
  });

  it('prefixes the 16-byte IV, the format User.mfaSecret already uses', () => {
    const svc = service(KEY);
    const encrypted = svc.encrypt('x');

    // IV + one AES block for a short plaintext.
    expect(encrypted.length).toBe(32);
  });

  it('does not leave the plaintext in the ciphertext', () => {
    const svc = service(KEY);
    expect(svc.encrypt('001234567890').toString('utf8')).not.toContain('001234567890');
  });

  it('cannot decrypt with a different key', () => {
    const encrypted = service(KEY).encrypt('001234567890');
    expect(() => service('b'.repeat(64)).decrypt(encrypted)).toThrow();
  });

  it('round-trips a value stored under a key with stray whitespace', () => {
    // A CRLF line ending in .env must not change the key that is derived.
    const written = service(KEY).encrypt('001234567890');
    expect(service(`${KEY}\r\n`).decrypt(written)).toBe('001234567890');
  });

  describe('key validation', () => {
    it('fails at startup when ENCRYPTION_KEY is unset', () => {
      expect(() => service(undefined).onModuleInit()).toThrow(/ENCRYPTION_KEY is not set/);
    });

    it('fails at startup on a passphrase rather than hex', () => {
      expect(() => service('not-a-hex-key').onModuleInit()).toThrow(
        /64 hexadecimal characters/,
      );
    });

    it('fails on a key of the wrong length', () => {
      expect(() => service('ab'.repeat(16)).onModuleInit()).toThrow(
        /64 hexadecimal characters/,
      );
    });

    it('never echoes the key in the error message', () => {
      const leaky = 'deadbeef'.repeat(9); // 72 chars: wrong length, valid hex
      expect(() => service(leaky).onModuleInit()).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('deadbeef') }),
      );
    });

    it('accepts a valid key at startup', () => {
      expect(() => service(KEY).onModuleInit()).not.toThrow();
    });
  });
});
