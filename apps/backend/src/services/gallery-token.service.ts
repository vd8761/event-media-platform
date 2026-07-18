// Gallery-token lifecycle (docs/plan/07 §2): 32 random bytes; SHA-256 hash for
// lookups; raw value AES-256-GCM-encrypted at rest so digest emails can embed
// the link later. Raw tokens are otherwise only ever inside emailed links.
import { Injectable } from '@nestjs/common';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { Participant } from 'src/schema';
import { CipherService } from 'src/services/cipher.service';

export interface GeneratedToken {
  raw: string;
  hash: Buffer;
  enc: Buffer;
}

@Injectable()
export class GalleryTokenService {
  private publicBaseUrl: string;

  constructor(
    configRepository: ConfigRepository,
    private cipherService: CipherService,
    private cryptoRepository: CryptoRepository,
  ) {
    this.publicBaseUrl = configRepository.getEnv().publicBaseUrl.replace(/\/$/, '');
  }

  generate(): GeneratedToken {
    const raw = this.cryptoRepository.randomBytesAsText(32);
    return {
      raw,
      hash: this.cryptoRepository.hashSha256(raw),
      enc: this.cipherService.encrypt(raw),
    };
  }

  decrypt(participant: Pick<Participant, 'galleryTokenEnc'>): string | null {
    if (!participant.galleryTokenEnc) {
      return null;
    }
    return this.cipherService.decrypt(participant.galleryTokenEnc);
  }

  galleryUrl(rawToken: string): string {
    return `${this.publicBaseUrl}/g/${rawToken}`;
  }

  eventUrl(slug: string): string {
    return `${this.publicBaseUrl}/e/${slug}`;
  }
}
