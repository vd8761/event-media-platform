// Drive/OneDrive OAuth + folder browsing (docs/plan/08 §1-2). Import-only
// OAuth — org login stays password/session. Tokens at rest are AES-256-GCM;
// access tokens refresh lazily with a 60s expiry margin.
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CloudProvider } from 'src/enum';
import { CloudAccount, CloudAccountRepository } from 'src/repositories/cloud-account.repository';
import { CloudProviderRegistry } from 'src/repositories/cloud-providers';
import { RemoteFolder } from 'src/repositories/cloud-providers/types';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { CipherService } from 'src/services/cipher.service';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 min (docs/plan/08 §1)
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

interface OAuthState {
  orgId: string;
  userId: string;
  provider: CloudProvider;
  exp: number;
  nonce: string;
}

@Injectable()
export class CloudService {
  private publicBaseUrl: string;

  constructor(
    private cipherService: CipherService,
    private cloudAccountRepository: CloudAccountRepository,
    private configRepository: ConfigRepository,
    private cryptoRepository: CryptoRepository,
    private logger: LoggingRepository,
    private providers: CloudProviderRegistry,
  ) {
    this.logger.setContext(CloudService.name);
    this.publicBaseUrl = this.configRepository.getEnv().publicBaseUrl.replace(/\/$/, '');
  }

  private redirectUri(provider: CloudProvider): string {
    return `${this.publicBaseUrl}/api/cloud/${provider}/callback`;
  }

  getAuthorizeUrl(orgId: string, userId: string, provider: CloudProvider): string {
    const client = this.providers.get(provider);
    const state: OAuthState = {
      orgId,
      userId,
      provider,
      exp: Date.now() + STATE_TTL_MS,
      nonce: this.cryptoRepository.randomBytesAsText(8),
    };
    return client.authorizeUrl(this.redirectUri(provider), this.cipherService.encryptState(state));
  }

  // returns the web URL to redirect the browser to after the exchange
  async handleCallback(provider: CloudProvider, code: string, stateRaw: string): Promise<string> {
    let state: OAuthState;
    try {
      state = this.cipherService.decryptState<OAuthState>(stateRaw);
    } catch {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    if (state.provider !== provider || state.exp < Date.now()) {
      throw new UnauthorizedException('Expired OAuth state');
    }

    const client = this.providers.get(provider);
    const tokens = await client.exchangeCode(code, this.redirectUri(provider));
    if (!tokens.refreshToken) {
      throw new BadRequestException('Provider did not return a refresh token — remove app access and reconnect');
    }
    const email = await client.getAccountEmail(tokens.accessToken);

    await this.cloudAccountRepository.upsert({
      orgId: state.orgId,
      provider,
      accountEmail: email,
      refreshTokenEnc: this.cipherService.encrypt(tokens.refreshToken),
      accessTokenEnc: this.cipherService.encrypt(tokens.accessToken),
      tokenExpiresAt: new Date(Date.now() + tokens.expiresInSec * 1000),
      scopes: client.scopes,
      createdBy: state.userId,
    });
    this.logger.log(`Connected ${provider} account ${email} for org ${state.orgId}`);

    return `${this.publicBaseUrl}/settings/cloud-accounts?connected=${provider}`;
  }

  async listAccounts(orgId: string) {
    const accounts = await this.cloudAccountRepository.listByOrg(orgId);
    return accounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      accountEmail: account.accountEmail,
      createdAt: account.createdAt,
    }));
  }

  async disconnect(orgId: string, accountId: string): Promise<void> {
    const account = await this.cloudAccountRepository.getById(orgId, accountId);
    if (!account) {
      throw new NotFoundException('Cloud account not found');
    }
    // best-effort provider-side revocation is future work; soft-revoke locally
    await this.cloudAccountRepository.markRevoked(accountId);
  }

  async listFolders(orgId: string, accountId: string, parentId?: string): Promise<RemoteFolder[]> {
    const account = await this.requireAccount(orgId, accountId);
    const accessToken = await this.getFreshAccessToken(account);
    return this.providers.get(account.provider).listFolders(accessToken, parentId);
  }

  async requireAccount(orgId: string, accountId: string): Promise<CloudAccount> {
    const account = await this.cloudAccountRepository.getById(orgId, accountId);
    if (!account) {
      throw new NotFoundException('Cloud account not found (disconnected?)');
    }
    return account;
  }

  // lazy refresh with in-DB caching (docs/plan/08 §1 step 3)
  async getFreshAccessToken(account: CloudAccount): Promise<string> {
    const valid =
      account.accessTokenEnc &&
      account.tokenExpiresAt &&
      account.tokenExpiresAt.getTime() > Date.now() + TOKEN_EXPIRY_MARGIN_MS;
    if (valid) {
      return this.cipherService.decrypt(account.accessTokenEnc!);
    }

    const client = this.providers.get(account.provider);
    try {
      const tokens = await client.refresh(this.cipherService.decrypt(account.refreshTokenEnc));
      await this.cloudAccountRepository.updateAccessToken(
        account.id,
        this.cipherService.encrypt(tokens.accessToken),
        new Date(Date.now() + tokens.expiresInSec * 1000),
      );
      return tokens.accessToken;
    } catch (error) {
      // revoked consent — actionable "reconnect" error (docs/plan/08 §1)
      this.logger.warn(`Token refresh failed for ${account.provider}/${account.accountEmail}: ${error}`);
      await this.cloudAccountRepository.markRevoked(account.id);
      throw new UnauthorizedException(
        `${account.provider} access for ${account.accountEmail} was revoked — reconnect the account`,
      );
    }
  }
}
