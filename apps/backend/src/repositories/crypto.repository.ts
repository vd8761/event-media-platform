// Ported from immich:server/src/repositories/crypto.repository.ts; drops the
// license-key verification, adds AES-256-GCM helpers for cloud-import tokens
// (docs/plan/03-database-schema.md `cloud_account`).
import { Injectable } from '@nestjs/common';
import { compareSync, hash } from 'bcrypt';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { createReadStream } from 'node:fs';

const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

@Injectable()
export class CryptoRepository {
  randomUUID(): string {
    return randomUUID();
  }

  randomBytes(size: number) {
    return randomBytes(size);
  }

  randomBytesAsText(bytes: number) {
    return randomBytes(bytes).toString('base64').replaceAll(/\W/g, '');
  }

  hashBcrypt(data: string | Buffer, saltOrRounds: string | number) {
    return hash(data, saltOrRounds);
  }

  compareBcrypt(data: string | Buffer, encrypted: string) {
    return compareSync(data, encrypted);
  }

  hashSha256(value: string) {
    return createHash('sha256').update(value).digest();
  }

  hashSha1(value: string | Buffer): Buffer {
    return createHash('sha1').update(value).digest();
  }

  hashFile(filepath: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const hash = createHash('sha1');
      const stream = createReadStream(filepath);
      stream.on('error', (error) => reject(error));
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest()));
    });
  }

  // Stored as iv || authTag || ciphertext, random IV per value.
  encryptAesGcm(plaintext: string, key: Buffer): Buffer {
    const iv = randomBytes(GCM_IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  }

  decryptAesGcm(payload: Buffer, key: Buffer): string {
    const iv = payload.subarray(0, GCM_IV_LENGTH);
    const tag = payload.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_TAG_LENGTH);
    const ciphertext = payload.subarray(GCM_IV_LENGTH + GCM_TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
