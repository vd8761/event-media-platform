<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, downloadSelectionZip, sha1Hex, uploadAsset, type AssetItem, type ProcessingStatus } from '$lib/api';
  import PhotoTimeline from '$lib/components/PhotoTimeline.svelte';
  import PhotoViewer from '$lib/components/PhotoViewer.svelte';
  import Scrubber from '$lib/components/Scrubber.svelte';
  import UploadPanel, { type UploadItem } from '$lib/components/UploadPanel.svelte';
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

  // --- uploads ---
  // Items live in this $state array and are only ever mutated *through it*.
  // Holding a reference to the original object and mutating that instead is
  // the classic Svelte 5 trap: the proxy keeps serving the stale value, so the
  // progress bar freezes even though the upload is running fine.
  // Rendering is UploadPanel's job (a port of Immich's).
  const UPLOAD_CONCURRENCY = 3;
  let uploads = $state<UploadItem[]>([]);
  let nextUploadId = 0;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;

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

<UploadPanel {uploads} onDismiss={() => (uploads = [])} />

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
