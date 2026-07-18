// Provider registry — resolves a CloudProvider enum to its client. Tests
// swap clients via setClient() to run the import pipeline against a stub.
import { BadRequestException, Injectable } from '@nestjs/common';
import { CloudProvider } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { GoogleDriveProvider } from 'src/repositories/cloud-providers/google-drive.provider';
import { OneDriveProvider } from 'src/repositories/cloud-providers/onedrive.provider';
import { CloudProviderClient } from 'src/repositories/cloud-providers/types';

@Injectable()
export class CloudProviderRegistry {
  private clients = new Map<CloudProvider, CloudProviderClient>();

  constructor(configRepository: ConfigRepository) {
    const { oauth } = configRepository.getEnv();
    if (oauth.google.clientId && oauth.google.clientSecret) {
      this.clients.set(CloudProvider.GDrive, new GoogleDriveProvider(oauth.google.clientId, oauth.google.clientSecret));
    }
    if (oauth.microsoft.clientId && oauth.microsoft.clientSecret) {
      this.clients.set(CloudProvider.OneDrive, new OneDriveProvider(oauth.microsoft.clientId, oauth.microsoft.clientSecret));
    }
  }

  get(provider: CloudProvider): CloudProviderClient {
    const client = this.clients.get(provider);
    if (!client) {
      throw new BadRequestException(
        `${provider} is not configured — set ${provider === CloudProvider.GDrive ? 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET' : 'MS_CLIENT_ID/MS_CLIENT_SECRET'}`,
      );
    }
    return client;
  }

  isConfigured(provider: CloudProvider): boolean {
    return this.clients.has(provider);
  }

  // test seam
  setClient(provider: CloudProvider, client: CloudProviderClient): void {
    this.clients.set(provider, client);
  }
}
