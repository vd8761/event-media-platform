<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, downloadSelectionZip, sha1Hex, uploadAsset, type AssetItem, type ProcessingStatus } from '$lib/api';
  import PhotoTimeline from '$lib/components/PhotoTimeline.svelte';
  import PhotoViewer from '$lib/components/PhotoViewer.svelte';
  import Scrubber from '$lib/components/Scrubber.svelte';
  import ProcessingBar from '$lib/components/ProcessingBar.svelte';
  import SelectionBar from '$lib/components/SelectionBar.svelte';
  import { Button, Icon, IconButton, LoadingSpinner } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiCheckCircle,
    mdiCheckCircleOutline,
    mdiChevronDown,
    mdiClose,
    mdiImageOff,
    mdiUpload,
  } from '@mdi/js';
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
  let processing = $state<ProcessingStatus | null>(null);
  let timelineEl = $state<HTMLElement | null>(null);

  // PhotoTimeline owns selection; this page just reads its size for the
  // toolbar and clears it after bulk actions. `selectMode` is the touch-device
  // entry point — hover has no equivalent on mobile, so a button forces the
  // checkboxes on with nothing selected yet.
  let selected = $state(new Set<string>());
  let selectMode = $state(false);
  const selecting = $derived(selected.size > 0 || selectMode);
  let downloadingZip = $state(false);

  // --- upload panel (Immich UploadPanel pattern) ---
  // Items live in this $state array and are only ever mutated *through it*.
  // Holding a reference to the original object and mutating that instead is
  // the classic Svelte 5 trap: the proxy keeps serving the stale value, so the
  // progress bar freezes even though the upload is running fine.
  interface UploadItem {
    id: number;
    name: string;
    state: 'pending' | 'hashing' | 'uploading' | 'done' | 'duplicate' | 'error';
    progress: number;
    error?: string;
  }

  const UPLOAD_CONCURRENCY = 3;
  let uploads = $state<UploadItem[]>([]);
  let uploadPanelOpen = $state(true);
  let nextUploadId = 0;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;

  const uploadSummary = $derived.by(() => {
    let active = 0;
    let done = 0;
    let duplicate = 0;
    let failed = 0;
    let progressTotal = 0;
    for (const upload of uploads) {
      switch (upload.state) {
        case 'done': {
          done++;
          progressTotal += 100;
          break;
        }
        case 'duplicate': {
          duplicate++;
          progressTotal += 100;
          break;
        }
        case 'error': {
          failed++;
          progressTotal += 100;
          break;
        }
        default: {
          active++;
          progressTotal += upload.state === 'uploading' ? upload.progress : 0;
        }
      }
    }
    return {
      active,
      done,
      duplicate,
      failed,
      finished: active === 0,
      percent: uploads.length > 0 ? Math.round(progressTotal / uploads.length) : 0,
    };
  });

  function patchUpload(id: number, changes: Partial<UploadItem>) {
    const index = uploads.findIndex((upload) => upload.id === id);
    if (index !== -1) {
      Object.assign(uploads[index], changes);
    }
  }

  let pollTimer: ReturnType<typeof setInterval> | undefined;

  async function refresh(showSpinner = false) {
    if (showSpinner) {
      loading = true;
    }
    const [first, status] = await Promise.all([api.assets.list(eventId), api.events.processing(eventId)]);
    assets = first.assets;
    nextCursor = first.nextCursor;
    processing = status;
    loading = false;
    schedulePolling();
  }

  // Poll while anything is still moving through the pipeline — derivative
  // generation or face detection (docs/plan/10 §5).
  function schedulePolling() {
    const busy =
      assets.some((asset) => asset.status !== 'processed' && asset.status !== 'failed') ||
      (processing?.assets.pendingDetection ?? 0) > 0 ||
      (processing?.assets.pendingMedia ?? 0) > 0;

    if (busy && !pollTimer) {
      pollTimer = setInterval(() => void refresh(), 4000);
    } else if (!busy && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  async function loadMore() {
    if (!nextCursor) {
      return;
    }
    const next = await api.assets.list(eventId, nextCursor);
    assets = [...assets, ...next.assets];
    nextCursor = next.nextCursor;
  }

  async function uploadOne(item: UploadItem, file: File) {
    try {
      patchUpload(item.id, { state: 'hashing' });

      // SHA-1 preflight — known duplicates are never sent (docs/plan/04 §3)
      const checksum = await sha1Hex(file);
      const { results } = await api.assets.bulkUploadCheck(eventId, [{ id: file.name, checksum }]);
      if (results[0]?.action === 'reject') {
        patchUpload(item.id, { state: 'duplicate' });
        return;
      }

      patchUpload(item.id, { state: 'uploading', progress: 0 });
      const result = await uploadAsset(eventId, file, (percent) => patchUpload(item.id, { progress: percent }));
      patchUpload(item.id, { state: result.status === 'duplicate' ? 'duplicate' : 'done', progress: 100 });
    } catch (error) {
      patchUpload(item.id, { state: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function onFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) {
      return;
    }
    const files = [...list];
    if (fileInput) {
      fileInput.value = '';
    }
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = undefined;
    }

    uploadPanelOpen = true;
    const items: UploadItem[] = files.map((file) => ({
      id: nextUploadId++,
      name: file.name,
      state: 'pending',
      progress: 0,
    }));
    uploads = [...items, ...uploads];

    // Small worker pool: a long single-file queue is what made this look
    // frozen when someone dropped in a whole camera roll.
    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const current = cursor++;
        await uploadOne(items[current], files[current]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));

    await refresh();

    // Clean runs disappear on their own; anything with a duplicate or a
    // failure stays up so it can actually be read.
    if (uploads.every((upload) => upload.state === 'done')) {
      dismissTimer = setTimeout(() => (uploads = []), 4000);
    }
  }

  function clearSelection() {
    selected = new Set();
    selectMode = false;
  }

  async function downloadSelected() {
    downloadingZip = true;
    try {
      await downloadSelectionZip(api.assets.downloadManyUrl(eventId), [...selected], `${data.event.name}.zip`);
    } finally {
      downloadingZip = false;
    }
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} photo${selected.size === 1 ? '' : 's'}? They are removed from all galleries.`)) {
      return;
    }
    await api.assets.remove(eventId, [...selected]);
    clearSelection();
    await refresh();
  }

  async function deleteAsset(assetId: string) {
    if (!confirm('Delete this photo? It will be removed from all galleries.')) {
      return;
    }
    await api.assets.remove(eventId, [assetId]);
    viewerIndex = -1;
    await refresh();
  }

  async function reprocessFaces() {
    const { queued } = await api.events.reprocessFaces(eventId, false);
    alert(queued > 0 ? `Queued face detection for ${queued} photo${queued === 1 ? '' : 's'}.` : 'Nothing pending — every photo has already been through detection.');
    await refresh();
  }

  // Deep-linking from elsewhere (the org Photos timeline, an event glimpse)
  // passes `?asset=<id>` — the asset may be further back than the first page,
  // so page forward until it turns up or the gallery runs out.
  async function openFromQuery() {
    const assetId = page.url.searchParams.get('asset');
    if (!assetId) {
      return;
    }
    let index = assets.findIndex((asset) => asset.id === assetId);
    let attempts = 0;
    while (index === -1 && nextCursor && attempts < 20) {
      await loadMore();
      index = assets.findIndex((asset) => asset.id === assetId);
      attempts++;
    }
    if (index !== -1) {
      viewerIndex = index;
    }
  }

  onMount(async () => {
    await refresh(true);
    await openFromQuery();
  });
  onDestroy(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    if (dismissTimer) {
      clearTimeout(dismissTimer);
    }
  });
</script>

<svelte:head><title>{data.event.name} — EventLens</title></svelte:head>

<div class="mb-4 flex items-center justify-between gap-4">
  <p class="text-sm text-gray-500">{assets.length} item{assets.length === 1 ? '' : 's'}</p>
  <input
    bind:this={fileInput}
    type="file"
    accept="image/*,video/*"
    multiple
    class="hidden"
    onchange={(event) => onFilesPicked(event.currentTarget.files)}
  />
  <div class="flex items-center gap-2">
    {#if assets.length > 0 && !selecting}
      <Button variant="outline" leadingIcon={mdiCheckCircleOutline} onclick={() => (selectMode = true)}>Select</Button>
    {/if}
    <Button leadingIcon={mdiUpload} onclick={() => fileInput?.click()}>Upload</Button>
  </div>
</div>

{#if selecting}
  <SelectionBar
    count={selected.size}
    total={assets.length}
    downloading={downloadingZip}
    canDelete={canManage}
    onSelectAll={() => (selected = new Set(assets.map((asset) => asset.id)))}
    onClear={clearSelection}
    onDownload={downloadSelected}
    onDelete={deleteSelected}
  />
{/if}

{#if processing}
  <ProcessingBar status={processing} {canManage} onReprocess={reprocessFaces} />
{/if}

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else if assets.length === 0}
  <div class="rounded-2xl border border-dashed border-gray-300 p-16 text-center text-gray-500">
    <Icon icon={mdiImageOff} size="2.5rem" class="mx-auto mb-3 text-gray-300" />
    No photos yet — upload some to get started.
  </div>
{:else}
  <div class="md:pe-[60px]">
    <div bind:this={timelineEl}>
      <PhotoTimeline {assets} bind:selected {selectMode} onOpen={(index) => (viewerIndex = index)} />
    </div>

    {#if nextCursor}
      <div class="mt-6 flex justify-center">
        <Button variant="outline" onclick={loadMore}>Load more</Button>
      </div>
    {/if}
  </div>

  <Scrubber timelineElement={timelineEl} revision={assets.length} />
{/if}

<!-- upload progress panel -->
{#if uploads.length > 0}
  <div class="fixed bottom-4 end-4 z-40 w-80 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
    <div class="flex items-center justify-between gap-2 px-4 py-3">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold">
          {#if uploadSummary.finished}
            Upload complete
          {:else}
            Uploading {uploadSummary.done + uploadSummary.duplicate + uploadSummary.failed + 1} of {uploads.length}
          {/if}
        </p>
        <p class="truncate text-xs text-gray-500">
          {uploadSummary.done} uploaded{#if uploadSummary.duplicate > 0}, {uploadSummary.duplicate} already here{/if}{#if uploadSummary.failed > 0}, {uploadSummary.failed} failed{/if}
        </p>
      </div>
      <div class="flex shrink-0 items-center">
        <IconButton
          icon={mdiChevronDown}
          aria-label={uploadPanelOpen ? 'Collapse' : 'Expand'}
          size="small"
          variant="ghost"
          color="secondary"
          class={uploadPanelOpen ? '' : 'rotate-180'}
          onclick={() => (uploadPanelOpen = !uploadPanelOpen)}
        />
        {#if uploadSummary.finished}
          <IconButton
            icon={mdiClose}
            aria-label="Dismiss"
            size="small"
            variant="ghost"
            color="secondary"
            onclick={() => (uploads = [])}
          />
        {/if}
      </div>
    </div>

    <!-- overall progress: always advances, even between files -->
    <div class="h-1 bg-gray-100">
      <div
        class="h-full transition-all duration-300 {uploadSummary.failed > 0 ? 'bg-red-500' : 'bg-immich-primary'}"
        style="width: {uploadSummary.percent}%"
      ></div>
    </div>

    {#if uploadPanelOpen}
      <div class="immich-scrollbar max-h-56 space-y-2 overflow-y-auto p-4 pt-3">
        {#each uploads as upload (upload.id)}
          <div class="text-xs">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate">{upload.name}</span>
              <span class="flex shrink-0 items-center gap-1 text-gray-500">
                {#if upload.state === 'uploading'}
                  {upload.progress}%
                {:else if upload.state === 'hashing'}
                  checking…
                {:else if upload.state === 'pending'}
                  queued
                {:else if upload.state === 'done'}
                  <Icon icon={mdiCheckCircle} size="1rem" class="text-green-600" />
                {:else if upload.state === 'duplicate'}
                  already here
                {:else}
                  <Icon icon={mdiAlertCircleOutline} size="1rem" class="text-red-600" />
                {/if}
              </span>
            </div>
            {#if upload.state === 'uploading'}
              <div class="mt-1 h-1 overflow-hidden rounded bg-gray-200">
                <div class="bg-immich-primary h-full transition-all" style="width: {upload.progress}%"></div>
              </div>
            {/if}
            {#if upload.state === 'error' && upload.error}
              <p class="mt-0.5 text-[11px] text-red-600">{upload.error}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if viewerIndex >= 0 && assets[viewerIndex]}
  <PhotoViewer
    {assets}
    index={viewerIndex}
    downloadUrl={(assetId) => api.assets.downloadUrl(eventId, assetId)}
    loadDetail={(assetId) => api.assets.get(eventId, assetId)}
    onOpenPerson={(personId) => goto(`/events/${eventId}/people/${personId}`)}
    onSetPersonCover={canManage
      ? async (personId, faceId) => void (await api.people.setCover(eventId, personId, faceId))
      : undefined}
    canDelete={canManage}
    canEdit={canManage}
    imageProxyUrl={(assetId) => api.assets.imageUrl(eventId, assetId)}
    onEditSave={async (file) => {
      await uploadAsset(eventId, file, () => {});
      await refresh();
    }}
    onRefreshFaces={canManage ? (assetId) => api.assets.runJob(eventId, assetId, 'faceDetection', true) : undefined}
    onViewSimilar={(assetId) => goto(`/events/${eventId}/similar/${assetId}`)}
    onClose={() => (viewerIndex = -1)}
    onIndexChange={(index) => (viewerIndex = index)}
    onDelete={deleteAsset}
  />
{/if}
