import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Column-level encryption for secrets that must survive a database dump
 * unreadable: TOTP seeds (User.mfaSecret) and bank account numbers
 * (KycSubmission.accountNumberEnc).
 *
 * Extracted from AuthService so both callers share one key, one format and one
 * validation path — a second implementation would eventually drift and leave
 * ciphertext that only one of them could read.
 *
 * Format: iv (16 bytes) || ciphertext, AES-256-CBC. Byte-for-byte what
 * AuthService wrote before the extraction, so secrets stored by earlier builds
 * still decrypt.
 *
 * AES-256-CBC carries no authentication tag: the ciphertext is malleable and
 * corruption is not detected. Migrating to aes-256-gcm would invalidate
 * already-stored secrets, so it is tracked as a separate fix.
 */
@Injectable()
export class FieldEncryptionService implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  /**
   * Providers are initialised before the HTTP server starts accepting
   * connections, so validating the encryption key here turns a malformed key
   * into a startup failure with a clear message, instead of a 500 on the first
   * MFA or KYC request from a user who has no idea why.
   */
  onModuleInit(): void {
    this.getEncryptionKey();
  }

  /**
   * Reads and validates ENCRYPTION_KEY, returning it as raw bytes.
   *
   * AES-256 needs exactly 32 bytes, and Buffer.from(value, 'hex') does not
   * reject a bad value — it stops at the first non-hex character and silently
   * returns whatever it parsed, which for a passphrase-shaped value is zero
   * bytes. That zero-length key is what reaches createCipheriv and throws
   * "Invalid key length" at request time. Validating the string first is the
   * only way to catch it before then.
   */
  getEncryptionKey(): Buffer {
    // Trailing whitespace is stripped defensively: a CRLF line ending in .env
    // can otherwise leave a stray character that fails an exact-length check.
    const configured = (this.config.get<string>('ENCRYPTION_KEY') ?? '').trim();

    if (configured.length === 0) {
      throw new Error(
        'ENCRYPTION_KEY is not set. Generate one with: ' +
          `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }

    if (!/^[0-9a-fA-F]{64}$/.test(configured)) {
      // Only the length is reported. Echoing the value would copy a secret into
      // the logs and any error tracker that captures startup failures.
      throw new Error(
        'ENCRYPTION_KEY must be exactly 64 hexadecimal characters ' +
          `(32 bytes for AES-256); received ${configured.length} character(s). ` +
          'Generate a valid key with: ' +
          `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }

    return Buffer.from(configured, 'hex');
  }

  encrypt(plaintext: string): Buffer {
    const key = this.getEncryptionKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, encrypted]);
  }

  decrypt(data: Buffer): string {
    const key = this.getEncryptionKey();
    const iv = data.subarray(0, 16);
    const encrypted = data.subarray(16);
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
