// Gallery-token lifecycle (docs/plan/07 §2): 32 random bytes; SHA-256 hash for
// lookups; raw value AES-256-GCM-encrypted at rest so digest emails can embed
// the link later. Raw tokens are otherwise only ever inside emailed links.
import { Injectable } from '@nestjs/common';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { Participant } from 'src/schema';

export interface GeneratedToken {
  raw: string;
  hash: Buffer;
  enc: Buffer;
}

@Injectable()
export class GalleryTokenService {
  private key: Buffer;
  private publicBaseUrl: string;

  constructor(
    configRepository: ConfigRepository,
    private cryptoRepository: CryptoRepository,
  ) {
    const env = configRepository.getEnv();
    this.publicBaseUrl = env.publicBaseUrl.replace(/\/$/, '');
    if (env.tokenEncryptionKey) {
      this.key = Buffer.from(env.tokenEncryptionKey, 'hex');
      if (this.key.length !== 32) {
        throw new Error('EL_TOKEN_ENCRYPTION_KEY must be 32 bytes of hex (64 hex chars)');
      }
    } else if (env.environment === 'development') {
      // dev-only fallback so the participant flow works out of the box
      this.key = this.cryptoRepository.hashSha256('eventlens-dev-token-key');
    } else {
      throw new Error('EL_TOKEN_ENCRYPTION_KEY is required in production');
    }
  }

  generate(): GeneratedToken {
    const raw = this.cryptoRepository.randomBytesAsText(32);
    return {
      raw,
      hash: this.cryptoRepository.hashSha256(raw),
      enc: this.cryptoRepository.encryptAesGcm(raw, this.key),
    };
  }

  decrypt(participant: Pick<Participant, 'galleryTokenEnc'>): string | null {
    if (!participant.galleryTokenEnc) {
      return null;
    }
    return this.cryptoRepository.decryptAesGcm(participant.galleryTokenEnc, this.key);
  }

  galleryUrl(rawToken: string): string {
    return `${this.publicBaseUrl}/g/${rawToken}`;
  }

  eventUrl(slug: string): string {
    return `${this.publicBaseUrl}/e/${slug}`;
  }
}
