<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, downloadSelectionZip, uploadAsset, type AssetItem, type ProcessingStatus } from '$lib/api';
  import PhotoTimeline from '$lib/components/PhotoTimeline.svelte';
  import PhotoViewer from '$lib/components/PhotoViewer.svelte';
  import Scrubber from '$lib/components/Scrubber.svelte';
  import ProcessingBar from '$lib/components/ProcessingBar.svelte';
  import { uploadStore } from '$lib/uploads.svelte';
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
    mdiLinkVariant,
    mdiCheck,
    mdiCloudUploadOutline,
    mdiEyeOffOutline,
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
  // The queue itself lives in `uploadStore` at module scope so it survives
  // navigating away from this page; the panel is rendered by the app layout.
  // This page only starts batches and adopts the finished assets.

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
    // A file may have finished uploading while this request was in flight; the
    // server list would not have it yet, and dropping it here would make the
    // tile vanish and reappear.
    adoptFresh();
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

  async function onFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) {
      return;
    }
    const files = [...list];
    if (fileInput) {
      fileInput.value = '';
    }

    // Not awaited before adopting: `enqueue` only settles once the whole batch
    // is done, and each file should appear as it lands rather than all at the
    // end. `adoptFresh` on the existing poll picks them up one by one.
    void uploadStore.enqueue(eventId, files).then(() => refresh());
  }

  // Splice in anything the store has finished uploading for this event. Called
  // from the poll, so a photo shows up seconds after it uploads instead of
  // waiting on derivative generation and face detection.
  function adoptFresh() {
    const fresh = uploadStore.takeFresh(eventId);
    if (fresh.length === 0) {
      return;
    }
    // Guard against a refresh having already returned them — the server list
    // is authoritative, and a duplicate row would render as a duplicate photo.
    const known = new Set(assets.map((asset) => asset.id));
    const additions = fresh.filter((asset) => !known.has(asset.id));
    if (additions.length > 0) {
      assets = [...additions, ...assets];
    }
  }

  // While a batch is running, splice each finished upload in promptly rather
  // than waiting on the 4s pipeline poll — showing the photo the moment it
  // lands is the whole point, and derivative generation is much slower.
  $effect(() => {
    if (!uploadStore.hasActive) {
      return;
    }
    const timer = setInterval(() => {
      adoptFresh();
      schedulePolling();
    }, 1000);
    return () => clearInterval(timer);
  });

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
  // --- draft / active ---
  let status = $state(data.event.status);
  let statusBusy = $state(false);
  let statusError = $state('');
  let copied = $state(false);
  const isActive = $derived(status === 'active');

  async function setActive(next: boolean) {
    const previous = status;
    // Optimistic: the switch should move under the finger, not after a round
    // trip. Reverted below if the server disagrees.
    status = next ? 'active' : 'draft';
    statusBusy = true;
    statusError = '';
    try {
      await api.events.update(eventId, { status: status as typeof data.event.status });
    } catch (err) {
      status = previous;
      statusError = err instanceof Error ? err.message : 'Could not change the status';
    } finally {
      statusBusy = false;
    }
  }

  async function copyShareLink() {
    const url = `${location.origin}/e/${data.event.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard is blocked outside a secure context or without permission;
      // showing the URL still lets someone copy it by hand.
      statusError = `Copy failed — the link is ${url}`;
    }
  }

  onDestroy(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
  });
</script>

<svelte:head><title>{data.event.name} — EventLens</title></svelte:head>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <div class="flex flex-wrap items-center gap-3">
    <p class="text-sm text-gray-500">{assets.length} item{assets.length === 1 ? '' : 's'}</p>

    {#if canManage}
      <!-- Draft/Active as a switch rather than a select buried in settings: it
           is the one setting an organiser flips repeatedly, and it decides
           whether the public link works at all. -->
      <!-- A button rather than a switch. A toggle implies a setting you flip
           back and forth; publishing is a deliberate act with a consequence
           (the public link starts working), and it reads better as something
           you press than something you slide. -->
      <Button
        size="small"
        variant={isActive ? 'outline' : 'filled'}
        disabled={statusBusy}
        leadingIcon={isActive ? mdiEyeOffOutline : mdiCloudUploadOutline}
        onclick={() => setActive(!isActive)}
      >
        {isActive ? 'Unpublish' : 'Publish media'}
      </Button>
    {/if}

    {#if isActive}
      <!-- Only shown once the event is live: handing out a link to a draft
           event gives guests a page that rejects them. -->
      <Button size="small" leadingIcon={copied ? mdiCheck : mdiLinkVariant} onclick={copyShareLink}>
        {copied ? 'Link copied' : 'Share link'}
      </Button>
    {/if}
  </div>
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

{#if statusError}
  <div class="mb-3 rounded-2xl bg-red-500/10 px-4 py-2 text-sm text-red-600">{statusError}</div>
{/if}

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
