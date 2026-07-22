<script lang="ts">
  import { api, type CloudAccountItem, type ImportProgress } from '$lib/api';
  import { Alert, Badge, Button, Heading, LoadingSpinner, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiChevronRight, mdiCloudDownloadOutline, mdiFolderOutline } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { DateTime } from 'luxon';
  import { onDestroy } from 'svelte';

  let { data } = $props();
  // Derived, not captured — this component is reused across event switches.
  const eventId = $derived(data.event.id);
  const orgId = $derived(data.event.orgId);

  let imports = $state<ImportProgress[]>([]);
  let accounts = $state<CloudAccountItem[]>([]);
  let loading = $state(true);
  let expanded = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  // wizard state
  let showWizard = $state(false);
  let wizardAccount = $state<CloudAccountItem | null>(null);
  let crumbs = $state<{ id: string | undefined; name: string }[]>([]);
  let folders = $state<{ id: string; name: string; hasChildren: boolean }[]>([]);
  let foldersLoading = $state(false);
  let recursive = $state(true);
  let starting = $state(false);
  let wizardError = $state('');

  const statusColor: Record<string, 'success' | 'warning' | 'danger' | 'secondary' | 'primary'> = {
    done: 'success',
    listing: 'warning',
    importing: 'primary',
    failed: 'danger',
    cancelled: 'secondary',
  };

  async function refresh() {
    imports = await api.imports.list(eventId);
    loading = false;
    const active = imports.some((job) => job.status === 'listing' || job.status === 'importing');
    if (active && !pollTimer) {
      pollTimer = setInterval(() => void refresh(), 3000);
    } else if (!active && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  async function openWizard() {
    wizardError = '';
    wizardAccount = null;
    crumbs = [];
    folders = [];
    accounts = await api.cloud.listAccounts(orgId);
    showWizard = true;
  }

  async function pickAccount(account: CloudAccountItem) {
    wizardAccount = account;
    await enterFolder(undefined, account.provider === 'gdrive' ? 'My Drive' : 'OneDrive');
  }

  async function enterFolder(folderId: string | undefined, name: string) {
    foldersLoading = true;
    crumbs = [...crumbs, { id: folderId, name }];
    folders = await api.cloud.listFolders(orgId, wizardAccount!.id, folderId);
    foldersLoading = false;
  }

  async function jumpToCrumb(index: number) {
    const target = crumbs[index];
    crumbs = crumbs.slice(0, index);
    await enterFolder(target.id, target.name);
  }

  const currentFolder = $derived(crumbs.at(-1));

  async function startImport() {
    if (!wizardAccount || !currentFolder) return;
    starting = true;
    wizardError = '';
    try {
      // Drive root has no id — fall back to the provider's root alias
      const folderId = currentFolder.id ?? (wizardAccount.provider === 'gdrive' ? 'root' : 'root');
      await api.imports.create(eventId, {
        accountId: wizardAccount.id,
        folderId,
        folderName: crumbs.map((crumb) => crumb.name).join(' / '),
        recursive,
      });
      showWizard = false;
      await refresh();
    } catch (error) {
      wizardError = `${error}`;
    } finally {
      starting = false;
    }
  }

  async function cancelImport(job: ImportProgress) {
    if (!confirm(`Cancel the import of "${job.folderName}"?`)) return;
    await api.imports.cancel(eventId, job.id);
    await refresh();
  }

  async function toggleDetails(job: ImportProgress) {
    if (expanded === job.id) {
      expanded = null;
      return;
    }
    const full = await api.imports.get(eventId, job.id);
    imports = imports.map((existing) => (existing.id === job.id ? full : existing));
    expanded = job.id;
  }

  // Keyed on the event so switching reloads its imports rather than leaving the
  // previous event's job list on screen.
  $effect(() => {
    void eventId;
    imports = [];
    accounts = [];
    loading = true;
    expanded = null;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    void refresh();
  });
  onDestroy(() => pollTimer && clearInterval(pollTimer));
</script>

<svelte:head><title>Imports — {data.event.name}</title></svelte:head>

<div class="mb-4 flex items-center justify-between">
  <p class="text-sm text-gray-500">Import photos from Google Drive or OneDrive folders.</p>
  <Button leadingIcon={mdiCloudDownloadOutline} onclick={openWizard}>New import</Button>
</div>

{#if loading}
  <div class="flex justify-center py-16"><LoadingSpinner size="giant" /></div>
{:else if imports.length === 0}
  <EmptyState
    icon={mdiCloudDownloadOutline}
    title="No imports yet"
    description="Pull photos straight from a Google Drive or OneDrive folder."
  />
{:else}
  <div class="space-y-3">
    {#each imports as job (job.id)}
      {@const finished = job.doneFiles + job.skippedFiles + job.failedFiles}
      <div class="md-surface p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-medium">{job.folderName}</p>
              <Badge color={statusColor[job.status] ?? 'secondary'} size="small">{job.status}</Badge>
            </div>
            <p class="mt-0.5 text-xs text-gray-400">
              {job.provider === 'gdrive' ? 'Google Drive' : 'OneDrive'} ·
              {DateTime.fromISO(job.createdAt).toRelative()}
              {#if job.status !== 'listing'}
                · {job.doneFiles} imported, {job.skippedFiles} skipped{job.failedFiles ? `, ${job.failedFiles} failed` : ''}
                of {job.totalFiles}
              {/if}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            {#if job.failedFiles > 0}
              <Button size="small" variant="ghost" onclick={() => toggleDetails(job)}>
                {expanded === job.id ? 'Hide failures' : 'Show failures'}
              </Button>
            {/if}
            {#if job.status === 'listing' || job.status === 'importing'}
              <Button size="small" variant="ghost" color="danger" onclick={() => cancelImport(job)}>Cancel</Button>
            {/if}
          </div>
        </div>

        {#if job.status === 'importing' && job.totalFiles > 0}
          <div class="mt-3 h-1.5 overflow-hidden rounded bg-gray-100">
            <div
              class="h-full bg-immich-primary transition-all"
              style="width: {Math.round((finished / job.totalFiles) * 100)}%"
            ></div>
          </div>
        {/if}

        {#if job.error}
          <p class="mt-2 text-xs text-red-600">{job.error}</p>
        {/if}

        {#if expanded === job.id && job.failedItems?.length}
          <div class="mt-3 space-y-1 rounded-xl bg-red-50 p-3">
            {#each job.failedItems as failure (failure.remoteName)}
              <p class="text-xs text-red-700"><span class="font-medium">{failure.remoteName}</span> — {failure.error}</p>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if showWizard}
  <Modal title="Import from cloud" size="small" onClose={() => (showWizard = false)}>
    <ModalBody>
      {#if wizardError}<div class="mb-3"><Alert color="danger" title={wizardError} /></div>{/if}

      {#if !wizardAccount}
        {#if accounts.length === 0}
          <p class="text-sm text-gray-500">
            No cloud accounts connected for this organization —
            <a href="/settings/cloud-accounts" class="text-immich-primary underline">connect one first</a>.
          </p>
        {:else}
          <p class="immich-form-label mb-2 text-sm">Choose an account</p>
          <div class="space-y-2">
            {#each accounts as account (account.id)}
              <button
                class="w-full rounded-xl border border-gray-200 px-4 py-3 text-start text-sm transition hover:border-immich-primary"
                onclick={() => pickAccount(account)}
              >
                <span class="font-medium">{account.accountEmail}</span>
                <span class="ms-2 text-xs text-gray-400">{account.provider === 'gdrive' ? 'Google Drive' : 'OneDrive'}</span>
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <nav class="mb-3 flex flex-wrap items-center gap-1 text-xs text-gray-500">
          {#each crumbs as crumb, index (index)}
            {#if index < crumbs.length - 1}
              <button class="text-immich-primary hover:underline" onclick={() => jumpToCrumb(index)}>{crumb.name}</button>
              <Icon icon={mdiChevronRight} size="0.9rem" />
            {:else}
              <span class="font-medium text-gray-700">{crumb.name}</span>
            {/if}
          {/each}
        </nav>

        {#if foldersLoading}
          <div class="flex justify-center py-8"><LoadingSpinner /></div>
        {:else if folders.length === 0}
          <p class="py-6 text-center text-sm text-gray-400">No subfolders — import this folder.</p>
        {:else}
          <div class="immich-scrollbar max-h-64 space-y-1 overflow-y-auto">
            {#each folders as folder (folder.id)}
              <button
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-gray-100"
                onclick={() => enterFolder(folder.id, folder.name)}
              >
                <Icon icon={mdiFolderOutline} size="1.1rem" class="text-gray-400" />
                {folder.name}
              </button>
            {/each}
          </div>
        {/if}

        <label class="mt-4 flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" bind:checked={recursive} />
          Include subfolders
        </label>
      {/if}
    </ModalBody>
    {#if wizardAccount}
      <ModalFooter>
        <Button fullWidth disabled={starting || !currentFolder} loading={starting} onclick={startImport}>
          Import "{currentFolder?.name}"
        </Button>
      </ModalFooter>
    {/if}
  </Modal>
{/if}
