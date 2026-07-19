<script lang="ts">
  // Full-screen asset viewer modelled on Immich's AssetViewer (docs/plan/10 §3):
  // preview image with thumbhash placeholder, keyboard + swipe navigation,
  // zoom-to-fill toggle, a slide-in detail panel and a real file download.
  import type { AssetDetail } from '$lib/api';
  import { Icon, IconButton, LoadingSpinner } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiChevronLeft,
    mdiChevronRight,
    mdiClose,
    mdiDelete,
    mdiDownload,
    mdiInformationOutline,
    mdiMagnifyMinusOutline,
    mdiMagnifyPlusOutline,
    mdiStar,
    mdiStarOutline,
  } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';
  import { thumbHashToDataURL } from 'thumbhash';

  // Minimal shape the viewer needs — satisfied by both the org gallery's
  // AssetItem and the public gallery's asset rows.
  export interface ViewerAsset {
    id: string;
    originalFilename?: string;
    status?: string;
    capturedAt: string | null;
    createdAt: string;
    width: number | null;
    height: number | null;
    thumbhash: string | null;
    thumbUrl: string | null;
    previewUrl: string | null;
    facesDetectedAt?: string | null;
    faceCount?: number;
  }

  interface Props {
    assets: ViewerAsset[];
    index: number;
    /** URL that streams the original file (the viewer fetches it as a blob). */
    downloadUrl: (assetId: string) => string;
    /** Optional — populates the info panel. Omitted on the public gallery. */
    loadDetail?: (assetId: string) => Promise<AssetDetail>;
    canDelete?: boolean;
    /** False hides the download control (view-only event photos). */
    canDownload?: boolean;
    /** Id of the event's shared cover photo, so the star can show as active. */
    featureAssetId?: string | null;
    /** Provided when the viewer may change the event cover. */
    onSetFeature?: (assetId: string | null) => Promise<void>;
    onClose: () => void;
    onIndexChange: (index: number) => void;
    onDelete?: (assetId: string) => void;
  }

  let {
    assets,
    index,
    downloadUrl,
    loadDetail,
    canDelete = false,
    canDownload = true,
    featureAssetId = null,
    onSetFeature,
    onClose,
    onIndexChange,
    onDelete,
  }: Props = $props();


  const filename = $derived(assets[index]?.originalFilename ?? 'photo.jpg');

  const asset = $derived(assets[index]);
  const isFeatured = $derived(!!asset && featureAssetId === asset.id);
  let savingFeature = $state(false);

  // Star toggles: feature the current photo, or clear it if it already is.
  async function toggleFeature() {
    if (!asset || !onSetFeature || savingFeature) {
      return;
    }
    savingFeature = true;
    try {
      await onSetFeature(isFeatured ? null : asset.id);
    } finally {
      savingFeature = false;
    }
  }

  let showInfo = $state(false);
  let zoomed = $state(false);
  let imageLoaded = $state(false);
  let detail = $state<AssetDetail | null>(null);
  let downloading = $state(false);
  let downloadError = $state('');

  // Reset per-image state whenever we move to a different asset, and fetch the
  // detail record that backs the info panel.
  $effect(() => {
    const id = asset?.id;
    if (!id) {
      return;
    }
    imageLoaded = false;
    zoomed = false;
    detail = null;
    if (!loadDetail) {
      return;
    }
    let cancelled = false;
    void loadDetail(id)
      .then((result) => {
        if (!cancelled) {
          detail = result;
        }
      })
      .catch(() => {
        // info panel simply stays empty — never block the image on this
      });
    return () => {
      cancelled = true;
    };
  });

  const placeholder = $derived.by(() => {
    if (!asset?.thumbhash) {
      return null;
    }
    try {
      return thumbHashToDataURL(Uint8Array.from(atob(asset.thumbhash), (char) => char.charCodeAt(0)));
    } catch {
      return null;
    }
  });

  function previous() {
    if (index > 0) {
      onIndexChange(index - 1);
    }
  }

  function next() {
    if (index < assets.length - 1) {
      onIndexChange(index + 1);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape': {
        if (zoomed) {
          zoomed = false;
        } else if (showInfo) {
          showInfo = false;
        } else {
          onClose();
        }
        break;
      }
      case 'ArrowLeft': {
        previous();
        break;
      }
      case 'ArrowRight': {
        next();
        break;
      }
      case 'i': {
        showInfo = !showInfo;
        break;
      }
      case 'd': {
        if (event.metaKey || event.ctrlKey) {
          return; // leave browser bookmark shortcut alone
        }
        void download();
        break;
      }
    }
  }

  // The download route 302s to a presigned URL with a Content-Disposition
  // filename. Anchor-clicking that cross-origin URL would open the image in a
  // tab on some browsers, so fetch it and save the blob instead.
  async function download() {
    if (!asset || downloading) {
      return;
    }
    downloading = true;
    downloadError = '';
    try {
      const response = await fetch(downloadUrl(asset.id));
      if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      downloadError = error instanceof Error ? error.message : 'Download failed';
    } finally {
      downloading = false;
    }
  }

  // touch swipe (mobile) — horizontal only, ignore vertical scrolls
  let touchStartX = 0;
  let touchStartY = 0;
  function onTouchStart(event: TouchEvent) {
    touchStartX = event.changedTouches[0].screenX;
    touchStartY = event.changedTouches[0].screenY;
  }
  function onTouchEnd(event: TouchEvent) {
    const deltaX = event.changedTouches[0].screenX - touchStartX;
    const deltaY = event.changedTouches[0].screenY - touchStartY;
    if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX > 0) {
        previous();
      } else {
        next();
      }
    }
  }

  function formatBytes(bytes: number) {
    if (!bytes) {
      return '—';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    const unit = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** unit).toFixed(1)} ${units[unit]}`;
  }

  // lock background scrolling while the viewer owns the screen
  onMount(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if asset}
  <div class="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Photo viewer">
    <!-- top bar -->
    <header class="absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-3">
      <div class="flex min-w-0 items-center gap-2">
        <IconButton icon={mdiClose} aria-label="Close" variant="ghost" color="secondary" onclick={onClose} />
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-white">{filename}</p>
          <p class="text-xs text-white/60">
            {index + 1} of {assets.length}
            {#if asset.capturedAt}
              · {DateTime.fromISO(asset.capturedAt).toLocaleString(DateTime.DATETIME_MED)}
            {/if}
          </p>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <IconButton
          icon={zoomed ? mdiMagnifyMinusOutline : mdiMagnifyPlusOutline}
          aria-label={zoomed ? 'Fit to screen' : 'Zoom to fill'}
          variant="ghost"
          color="secondary"
          onclick={() => (zoomed = !zoomed)}
        />
        {#if onSetFeature}
          <IconButton
            icon={isFeatured ? mdiStar : mdiStarOutline}
            aria-label={isFeatured ? 'Remove as event cover' : 'Set as event cover'}
            variant="ghost"
            color={isFeatured ? 'warning' : 'secondary'}
            loading={savingFeature}
            onclick={toggleFeature}
          />
        {/if}
        {#if canDownload}
          <IconButton
            icon={mdiDownload}
            aria-label="Download"
            variant="ghost"
            color="secondary"
            loading={downloading}
            onclick={download}
          />
        {/if}
        <IconButton
          icon={mdiInformationOutline}
          aria-label="Info"
          variant="ghost"
          color={showInfo ? 'primary' : 'secondary'}
          onclick={() => (showInfo = !showInfo)}
        />
        {#if canDelete}
          <IconButton
            icon={mdiDelete}
            aria-label="Delete"
            variant="ghost"
            color="danger"
            onclick={() => onDelete?.(asset.id)}
          />
        {/if}
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- stage -->
      <div
        class="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden"
        ontouchstart={onTouchStart}
        ontouchend={onTouchEnd}
      >
        {#if index > 0}
          <button
            class="absolute start-2 z-10 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/70"
            aria-label="Previous"
            onclick={previous}
          >
            <Icon icon={mdiChevronLeft} size="2rem" />
          </button>
        {/if}

        {#if asset.previewUrl}
          <!-- thumbhash placeholder underneath so there is never a black flash -->
          {#if placeholder && !imageLoaded}
            <img src={placeholder} alt="" class="absolute h-full w-full object-contain blur-xl" />
            <div class="absolute"><LoadingSpinner size="giant" /></div>
          {/if}
          <img
            src={asset.previewUrl}
            alt={filename}
            class="max-h-full max-w-full transition-opacity duration-200 {imageLoaded ? 'opacity-100' : 'opacity-0'}
              {zoomed ? 'h-full w-full cursor-zoom-out object-cover' : 'cursor-zoom-in object-contain'}"
            onload={() => (imageLoaded = true)}
            onclick={() => (zoomed = !zoomed)}
          />
        {:else}
          <div class="flex flex-col items-center gap-3 text-white/70">
            <Icon icon={mdiAlertCircleOutline} size="3rem" />
            <p class="text-sm">
              {asset.status === 'failed' ? 'This photo could not be processed.' : 'Still processing — check back shortly.'}
            </p>
          </div>
        {/if}

        {#if index < assets.length - 1}
          <button
            class="absolute end-2 z-10 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/70"
            aria-label="Next"
            onclick={next}
          >
            <Icon icon={mdiChevronRight} size="2rem" />
          </button>
        {/if}

        {#if downloadError}
          <p class="absolute bottom-4 rounded-lg bg-red-600/90 px-3 py-1.5 text-sm text-white">{downloadError}</p>
        {/if}
      </div>

      <!-- info panel -->
      {#if showInfo}
        <aside class="immich-scrollbar w-80 shrink-0 overflow-y-auto border-s border-white/10 bg-neutral-900 p-5 text-sm text-white">
          <h2 class="mb-4 text-base font-semibold">Details</h2>

          <dl class="space-y-3">
            <div>
              <dt class="text-xs text-white/50">File name</dt>
              <dd class="break-all">{filename}</dd>
            </div>
            {#if asset.width && asset.height}
              <div>
                <dt class="text-xs text-white/50">Dimensions</dt>
                <dd>{asset.width} × {asset.height}</dd>
              </div>
            {/if}
            {#if detail}
              <div>
                <dt class="text-xs text-white/50">Size</dt>
                <dd>{formatBytes(detail.fileSize)} · {detail.mimeType}</dd>
              </div>
              {#if detail.exif?.make || detail.exif?.model}
                <div>
                  <dt class="text-xs text-white/50">Camera</dt>
                  <dd>{[detail.exif.make, detail.exif.model].filter(Boolean).join(' ')}</dd>
                </div>
              {/if}
              <div>
                <dt class="text-xs text-white/50">Source</dt>
                <dd class="capitalize">{detail.source}</dd>
              </div>
            {/if}
            <div>
              <dt class="text-xs text-white/50">Added</dt>
              <dd>{DateTime.fromISO(asset.createdAt).toLocaleString(DateTime.DATETIME_MED)}</dd>
            </div>
            {#if asset.faceCount !== undefined}
              <div>
                <dt class="text-xs text-white/50">Face detection</dt>
                <dd>
                  {#if asset.facesDetectedAt}
                    {asset.faceCount === 0
                      ? 'No faces found'
                      : `${asset.faceCount} face${asset.faceCount === 1 ? '' : 's'} found`}
                  {:else}
                    <span class="text-amber-300">Pending</span>
                  {/if}
                </dd>
              </div>
            {/if}
          </dl>

          {#if detail && detail.people.length > 0}
            <h3 class="mt-6 mb-3 text-xs font-medium tracking-wide text-white/50 uppercase">People</h3>
            <div class="flex flex-wrap gap-3">
              {#each detail.people as person (person.id)}
                <div class="w-16 text-center">
                  {#if person.thumbnailUrl}
                    <img src={person.thumbnailUrl} alt={person.name} class="h-16 w-16 rounded-full object-cover" />
                  {:else}
                    <div class="h-16 w-16 rounded-full bg-white/10"></div>
                  {/if}
                  <p class="mt-1 truncate text-xs">{person.name || 'Unnamed'}</p>
                </div>
              {/each}
            </div>
          {/if}
        </aside>
      {/if}
    </div>
  </div>
{/if}
