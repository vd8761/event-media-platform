<script lang="ts">
  import { api, sha1Hex, uploadAsset, type AssetItem } from '$lib/api';
  import PhotoTimeline from '$lib/components/PhotoTimeline.svelte';
  import { Button, IconButton, LoadingSpinner } from '@immich/ui';
  import {
    mdiChevronLeft,
    mdiChevronRight,
    mdiClose,
    mdiDelete,
    mdiDownload,
    mdiImageOff,
    mdiUpload,
  } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';

  let { data } = $props();
  const eventId = data.event.id;
  const canManage = $derived(
    data.me.isSuperAdmin ||
      ['owner', 'admin'].includes(data.me.organizations.find((org) => org.id === data.event.orgId)?.role ?? ''),
  );

  let assets = $state<AssetItem[]>([]);
  let nextCursor = $state<string | null>(null);
  let loading = $state(true);
  let viewerIndex = $state(-1);
  let fileInput = $state<HTMLInputElement | null>(null);

  // upload panel state (per-file, Immich upload store pattern)
  interface UploadItem {
    name: string;
    state: 'pending' | 'hashing' | 'uploading' | 'done' | 'duplicate' | 'error';
    progress: number;
    error?: string;
  }
  let uploads = $state<UploadItem[]>([]);
  const uploadsActive = $derived(uploads.some((u) => u.state !== 'done' && u.state !== 'duplicate' && u.state !== 'error'));

  let pollTimer: ReturnType<typeof setInterval> | undefined;

  async function refresh(showSpinner = false) {
    if (showSpinner) loading = true;
    const first = await api.assets.list(eventId);
    assets = first.assets;
    nextCursor = first.nextCursor;
    loading = false;
    schedulePolling();
  }

  // processing badge: poll while anything is not yet processed (docs/plan/10 §5)
  function schedulePolling() {
    const hasProcessing = assets.some((asset) => asset.status !== 'processed' && asset.status !== 'failed');
    if (hasProcessing && !pollTimer) {
      pollTimer = setInterval(() => void refresh(), 5000);
    } else if (!hasProcessing && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    const next = await api.assets.list(eventId, nextCursor);
    assets = [...assets, ...next.assets];
    nextCursor = next.nextCursor;
  }

  async function onFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = [...list];
    if (fileInput) fileInput.value = '';

    const items: UploadItem[] = files.map((file) => ({ name: file.name, state: 'pending', progress: 0 }));
    uploads = [...items, ...uploads];

    // SHA-1 preflight — known duplicates are never sent (docs/plan/04 §3)
    for (const [index, file] of files.entries()) {
      const item = items[index];
      try {
        item.state = 'hashing';
        uploads = [...uploads];
        const checksum = await sha1Hex(file);
        const { results } = await api.assets.bulkUploadCheck(eventId, [{ id: file.name, checksum }]);
        if (results[0]?.action === 'reject') {
          item.state = 'duplicate';
          uploads = [...uploads];
          continue;
        }
        item.state = 'uploading';
        uploads = [...uploads];
        const result = await uploadAsset(eventId, file, (percent) => {
          item.progress = percent;
          uploads = [...uploads];
        });
        item.state = result.status === 'duplicate' ? 'duplicate' : 'done';
      } catch (error) {
        item.state = 'error';
        item.error = `${error}`;
      }
      uploads = [...uploads];
    }
    await refresh();
  }

  async function deleteAsset(assetId: string) {
    if (!confirm('Delete this photo? It will be removed from all galleries.')) return;
    await api.assets.remove(eventId, [assetId]);
    viewerIndex = -1;
    await refresh();
  }

  function onKeydown(event: KeyboardEvent) {
    if (viewerIndex < 0) return;
    if (event.key === 'Escape') viewerIndex = -1;
    if (event.key === 'ArrowRight' && viewerIndex < assets.length - 1) viewerIndex++;
    if (event.key === 'ArrowLeft' && viewerIndex > 0) viewerIndex--;
  }

  onMount(() => void refresh(true));
  onDestroy(() => pollTimer && clearInterval(pollTimer));
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head><title>{data.event.name} — EventLens</title></svelte:head>

<div class="mb-4 flex items-center justify-between">
  <p class="text-sm text-gray-500">{assets.length} item{assets.length === 1 ? '' : 's'}</p>
  <input
    bind:this={fileInput}
    type="file"
    accept="image/*,video/*"
    multiple
    class="hidden"
    onchange={(event) => onFilesPicked(event.currentTarget.files)}
  />
  <Button leadingIcon={mdiUpload} onclick={() => fileInput?.click()}>Upload</Button>
</div>

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else if assets.length === 0}
  <div class="rounded-2xl border border-dashed border-gray-300 p-16 text-center text-gray-500">
    <Icon icon={mdiImageOff} size="2.5rem" class="mx-auto mb-3 text-gray-300" />
    No photos yet — upload some to get started.
  </div>
{:else}
  <PhotoTimeline {assets} onOpen={(index) => (viewerIndex = index)} />

  {#if nextCursor}
    <div class="mt-6 flex justify-center">
      <Button variant="outline" onclick={loadMore}>Load more</Button>
    </div>
  {/if}
{/if}

<!-- upload progress panel (Immich UploadPanel pattern) -->
{#if uploads.length > 0}
  <div class="fixed bottom-4 end-4 z-40 w-80 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
    <div class="mb-2 flex items-center justify-between">
      <p class="text-sm font-semibold">Uploads</p>
      {#if !uploadsActive}
        <IconButton icon={mdiClose} aria-label="Dismiss" size="small" variant="ghost" onclick={() => (uploads = [])} />
      {/if}
    </div>
    <div class="immich-scrollbar max-h-56 space-y-2 overflow-y-auto">
      {#each uploads as upload (upload.name + upload.state)}
        <div class="text-xs">
          <div class="flex justify-between gap-2">
            <span class="truncate">{upload.name}</span>
            <span class="shrink-0 text-gray-500">
              {#if upload.state === 'uploading'}{upload.progress}%{:else}{upload.state}{/if}
            </span>
          </div>
          {#if upload.state === 'uploading' || upload.state === 'hashing'}
            <div class="mt-1 h-1 overflow-hidden rounded bg-gray-200">
              <div class="h-full bg-immich-primary transition-all" style="width: {upload.state === 'hashing' ? 5 : upload.progress}%"></div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<!-- lightbox viewer -->
{#if viewerIndex >= 0 && assets[viewerIndex]}
  {@const current = assets[viewerIndex]}
  <div class="fixed inset-0 z-50 flex flex-col bg-black/95">
    <div class="flex items-center justify-between p-4 text-white">
      <p class="truncate text-sm">{current.originalFilename}</p>
      <div class="flex gap-1">
        <IconButton
          icon={mdiDownload}
          aria-label="Download"
          variant="ghost"
          color="secondary"
          href={api.assets.downloadUrl(eventId, current.id)}
        />
        {#if canManage}
          <IconButton
            icon={mdiDelete}
            aria-label="Delete"
            variant="ghost"
            color="danger"
            onclick={() => deleteAsset(current.id)}
          />
        {/if}
        <IconButton icon={mdiClose} aria-label="Close" variant="ghost" color="secondary" onclick={() => (viewerIndex = -1)} />
      </div>
    </div>
    <div class="relative flex flex-1 items-center justify-center overflow-hidden px-14 pb-6">
      {#if viewerIndex > 0}
        <button class="absolute start-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onclick={() => viewerIndex--}>
          <Icon icon={mdiChevronLeft} size="2rem" />
        </button>
      {/if}
      <img src={current.previewUrl ?? current.thumbUrl} alt={current.originalFilename} class="max-h-full max-w-full object-contain" />
      {#if viewerIndex < assets.length - 1}
        <button class="absolute end-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onclick={() => viewerIndex++}>
          <Icon icon={mdiChevronRight} size="2rem" />
        </button>
      {/if}
    </div>
  </div>
{/if}
