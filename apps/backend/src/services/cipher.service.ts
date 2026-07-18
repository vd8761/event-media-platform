// Shared AES-256-GCM cipher keyed by EL_TOKEN_ENCRYPTION_KEY — used for
// participant gallery tokens and Drive/OneDrive OAuth tokens
// (docs/plan/03 `cloud_account`, docs/plan/08 §1). Key loss forces every org
// to reconnect cloud accounts (risk R11) — back it up like a DB credential.
import { Injectable } from '@nestjs/common';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';

@Injectable()
export class CipherService {
  private key: Buffer;

  constructor(
    configRepository: ConfigRepository,
    private cryptoRepository: CryptoRepository,
  ) {
    const env = configRepository.getEnv();
    if (env.tokenEncryptionKey) {
      this.key = Buffer.from(env.tokenEncryptionKey, 'hex');
      if (this.key.length !== 32) {
        throw new Error('EL_TOKEN_ENCRYPTION_KEY must be 32 bytes of hex (64 hex chars)');
      }
    } else if (env.environment === 'development') {
      // dev-only fallback so the flows work out of the box
      this.key = this.cryptoRepository.hashSha256('eventlens-dev-token-key');
    } else {
      throw new Error('EL_TOKEN_ENCRYPTION_KEY is required in production');
    }
  }

  encrypt(plaintext: string): Buffer {
    return this.cryptoRepository.encryptAesGcm(plaintext, this.key);
  }

  decrypt(payload: Buffer): string {
    return this.cryptoRepository.decryptAesGcm(payload, this.key);
  }

  // tamper-proof, confidential state blobs (OAuth state, docs/plan/08 §1)
  encryptState(payload: object): string {
    return this.encrypt(JSON.stringify(payload)).toString('base64url');
  }

  decryptState<T>(state: string): T {
    return JSON.parse(this.decrypt(Buffer.from(state, 'base64url'))) as T;
  }
}
