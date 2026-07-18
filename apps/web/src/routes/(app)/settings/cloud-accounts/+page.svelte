<script lang="ts">
  import { page } from '$app/state';
  import { api, type CloudAccountItem } from '$lib/api';
  import { Alert, Badge, Button, Heading, IconButton, LoadingSpinner } from '@immich/ui';
  import { mdiCloudOutline, mdiDelete, mdiGoogleDrive, mdiMicrosoftOnedrive } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';

  let { data } = $props();

  const adminOrgs = $derived(
    data.me.isSuperAdmin
      ? data.me.organizations
      : data.me.organizations.filter((org) => org.role === 'owner' || org.role === 'admin'),
  );
  let orgId = $state('');
  let accounts = $state<CloudAccountItem[]>([]);
  let loading = $state(true);
  const justConnected = page.url.searchParams.get('connected');

  const providerMeta = {
    gdrive: { label: 'Google Drive', icon: mdiGoogleDrive },
    onedrive: { label: 'OneDrive', icon: mdiMicrosoftOnedrive },
  } as const;

  async function refresh() {
    if (!orgId) {
      loading = false;
      return;
    }
    loading = true;
    accounts = await api.cloud.listAccounts(orgId);
    loading = false;
  }

  function connect(provider: 'gdrive' | 'onedrive') {
    // full-page redirect into the provider consent screen (docs/plan/08 §1)
    window.location.href = api.cloud.authorizeUrl(orgId, provider);
  }

  async function disconnect(account: CloudAccountItem) {
    if (!confirm(`Disconnect ${account.accountEmail}? Running imports using it will fail.`)) return;
    await api.cloud.disconnect(orgId, account.id);
    await refresh();
  }

  onMount(() => {
    orgId = adminOrgs[0]?.id ?? '';
    void refresh();
  });
</script>

<svelte:head><title>Cloud accounts — EventLens</title></svelte:head>

<Heading size="large" class="mb-2">Cloud accounts</Heading>
<p class="mb-6 max-w-xl text-sm text-gray-500">
  Connect Google Drive or OneDrive to import event photos directly from shared folders. Connections are per
  organization and read-only.
</p>

{#if justConnected}
  <div class="mb-4 max-w-xl">
    <Alert color="success" title={`${providerMeta[justConnected as 'gdrive' | 'onedrive']?.label ?? justConnected} connected`} />
  </div>
{/if}

{#if adminOrgs.length === 0}
  <Alert color="warning" title="You need an admin or owner role to manage cloud accounts." />
{:else}
  {#if adminOrgs.length > 1}
    <div class="mb-5 max-w-xs">
      <label for="org" class="immich-form-label mb-1 block text-sm">Organization</label>
      <select id="org" bind:value={orgId} onchange={() => void refresh()} class="immich-form-input">
        {#each adminOrgs as org (org.id)}
          <option value={org.id}>{org.name}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="mb-6 flex gap-3">
    <Button leadingIcon={mdiGoogleDrive} variant="outline" onclick={() => connect('gdrive')}>
      Connect Google Drive
    </Button>
    <Button leadingIcon={mdiMicrosoftOnedrive} variant="outline" onclick={() => connect('onedrive')}>
      Connect OneDrive
    </Button>
  </div>

  {#if loading}
    <LoadingSpinner />
  {:else if accounts.length === 0}
    <div class="max-w-xl rounded-2xl border border-dashed border-gray-300 p-10 text-center text-gray-500">
      <Icon icon={mdiCloudOutline} size="2rem" class="mx-auto mb-2 text-gray-300" />
      No cloud accounts connected yet.
    </div>
  {:else}
    <div class="max-w-xl overflow-hidden rounded-2xl border border-gray-200">
      {#each accounts as account (account.id)}
        <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3 last:border-b-0">
          <div class="flex items-center gap-3">
            <Icon icon={providerMeta[account.provider].icon} size="1.5rem" class="text-gray-500" />
            <div>
              <p class="text-sm font-medium">{account.accountEmail}</p>
              <p class="text-xs text-gray-400">
                {providerMeta[account.provider].label} · connected
                {DateTime.fromISO(account.createdAt).toRelative()}
              </p>
            </div>
          </div>
          <IconButton
            icon={mdiDelete}
            aria-label="Disconnect"
            size="small"
            variant="ghost"
            color="danger"
            onclick={() => disconnect(account)}
          />
        </div>
      {/each}
    </div>
  {/if}
{/if}
