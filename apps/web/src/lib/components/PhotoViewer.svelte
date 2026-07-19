<script lang="ts">
  // Full-screen asset viewer modelled on Immich's AssetViewer (docs/plan/10 §3):
  // preview image with thumbhash placeholder, face outlines, keyboard + swipe
  // navigation, zoom, a detail panel and a real file download.
  import type { AssetDetail } from '$lib/api';
  import FaceBoxes, { type FaceBox } from '$lib/components/FaceBoxes.svelte';
  import { Icon, IconButton, LoadingSpinner } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiChevronLeft,
    mdiChevronRight,
    mdiClose,
    mdiDelete,
    mdiDownload,
    mdiFaceRecognition,
    mdiInformationOutline,
    mdiMagnifyMinusOutline,
    mdiMagnifyPlusOutline,
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
    /** Face outlines for the current photo. */
    loadFaces?: (assetId: string) => Promise<FaceBox[]>;
    /** Tapping a face opens that person; omit to show names without links. */
    onOpenPerson?: (personId: string) => void;
    /** Organiser-only: set this face as the person's portrait. */
    onSetPersonCover?: (personId: string, faceId: string) => Promise<void>;
    canDelete?: boolean;
    /** False hides the download control (view-only event photos). */
    canDownload?: boolean;
    onClose: () => void;
    onIndexChange: (index: number) => void;
    onDelete?: (assetId: string) => void;
  }

  let {
    assets,
    index,
    downloadUrl,
    loadDetail,
    loadFaces,
    onOpenPerson,
    onSetPersonCover,
    canDelete = false,
    canDownload = true,
    onClose,
    onIndexChange,
    onDelete,
  }: Props = $props();

  const filename = $derived(assets[index]?.originalFilename ?? 'photo.jpg');
  const asset = $derived(assets[index]);

  let showInfo = $state(false);
  let showFaces = $state(true);
  let imageLoaded = $state(false);

  // --- zoom & pan ---------------------------------------------------------
  // Zoom resizes the image box outright rather than applying a CSS transform:
  // the photo is laid out at `fit size × zoom` inside a scrollable stage, so
  // panning is native scrolling and the face overlay — which is simply inset-0
  // on that same box — stays aligned for free at every magnification.
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;
  let zoom = $state(1);
  const zoomed = $derived(zoom > 1);

  let frameEl = $state<HTMLDivElement | null>(null);
  let stageSize = $state({ width: 0, height: 0 });
  let natural = $state({ width: 0, height: 0 });

  // scale that makes the photo fit the stage without cropping
  const fitScale = $derived(
    natural.width > 0 && natural.height > 0 && stageSize.width > 0 && stageSize.height > 0
      ? Math.min(stageSize.width / natural.width, stageSize.height / natural.height)
      : 0,
  );
  const displayWidth = $derived(fitScale > 0 ? natural.width * fitScale * zoom : 0);
  const displayHeight = $derived(fitScale > 0 ? natural.height * fitScale * zoom : 0);

  function measureStage() {
    if (frameEl) {
      stageSize = { width: frameEl.clientWidth, height: frameEl.clientHeight };
    }
  }

  function onImageLoad(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    natural = { width: image.naturalWidth, height: image.naturalHeight };
    imageLoaded = true;
    measureStage();
  }

  // Zoom about the centre of the viewport: keep whatever is in the middle in
  // the middle, which is what people expect from the +/- controls.
  function setZoom(next: number) {
    const previous = zoom;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
    if (clamped === previous) {
      return;
    }
    zoom = clamped;

    const frame = frameEl;
    if (!frame) {
      return;
    }
    const ratio = clamped / previous;
    const centreX = frame.scrollLeft + frame.clientWidth / 2;
    const centreY = frame.scrollTop + frame.clientHeight / 2;
    requestAnimationFrame(() => {
      frame.scrollLeft = centreX * ratio - frame.clientWidth / 2;
      frame.scrollTop = centreY * ratio - frame.clientHeight / 2;
    });
  }

  function resetZoom() {
    zoom = 1;
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
  }

  // drag to pan by scrolling the stage
  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let scrollStartX = 0;
  let scrollStartY = 0;

  function onPointerDown(event: PointerEvent) {
    if (!zoomed || !frameEl) {
      return;
    }
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    scrollStartX = frameEl.scrollLeft;
    scrollStartY = frameEl.scrollTop;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging || !frameEl) {
      return;
    }
    frameEl.scrollLeft = scrollStartX - (event.clientX - dragStartX);
    frameEl.scrollTop = scrollStartY - (event.clientY - dragStartY);
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) {
      return;
    }
    dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }
  let detail = $state<AssetDetail | null>(null);
  let faces = $state<FaceBox[]>([]);
  let downloading = $state(false);
  let downloadError = $state('');

  // Reset per-image state whenever we move to a different asset, and fetch the
  // detail record and face boxes that overlay it.
  $effect(() => {
    const id = asset?.id;
    if (!id) {
      return;
    }
    imageLoaded = false;
    resetZoom();
    natural = { width: 0, height: 0 };
    detail = null;
    faces = [];

    let cancelled = false;
    if (loadDetail) {
      void loadDetail(id)
        .then((result) => {
          if (cancelled) {
            return;
          }
          detail = result;
          // the org-side detail already carries the boxes — no second request
          if (!loadFaces && result.faces) {
            faces = result.faces;
          }
        })
        .catch(() => {
          // info panel simply stays empty — never block the image on this
        });
    }
    if (loadFaces) {
      void loadFaces(id)
        .then((result) => !cancelled && (faces = result))
        .catch(() => {
          // no outlines is a fine fallback
        });
    }
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
          resetZoom();
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
      case '+':
      case '=': {
        setZoom(zoom * 1.4);
        break;
      }
      case '-': {
        setZoom(zoom / 1.4);
        break;
      }
      case '0': {
        resetZoom();
        break;
      }
      case 'i': {
        showInfo = !showInfo;
        break;
      }
      case 'f': {
        showFaces = !showFaces;
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
    if (!asset || downloading || !canDownload) {
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

  // Opening a person always replaces what the viewer is showing, so get out of
  // the way first — otherwise the destination renders behind the overlay.
  function openPerson(personId: string) {
    onClose();
    onOpenPerson?.(personId);
  }

  async function setCover(personId: string, faceId: string) {
    await onSetPersonCover?.(personId, faceId);
    // reflect the new cover in the overlay without a refetch
    faces = faces.map((face) => ({ ...face, isCover: face.personId === personId && face.id === faceId }));
  }

  // touch swipe (mobile) — horizontal only, ignore vertical scrolls
  let touchStartX = 0;
  let touchStartY = 0;
  function onTouchStart(event: TouchEvent) {
    touchStartX = event.changedTouches[0].screenX;
    touchStartY = event.changedTouches[0].screenY;
  }
  function onTouchEnd(event: TouchEvent) {
    // while zoomed a horizontal drag is a pan, not a request for the next photo
    if (zoomed) {
      return;
    }
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

  // Recompute the fit when the stage resizes — window resize, opening the info
  // panel, orientation change. An effect rather than onMount because the frame
  // only exists once an image is rendered.
  $effect(() => {
    if (!frameEl) {
      return;
    }
    const observer = new ResizeObserver(() => measureStage());
    observer.observe(frameEl);
    return () => observer.disconnect();
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if asset}
  <!-- `viewer` scopes the icon-colour override below: @immich/ui's secondary
       colour is near-black, which is invisible on this backdrop. -->
  <div class="viewer fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Photo viewer">
    <header
      class="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 via-black/40 to-transparent p-2 sm:p-3"
    >
      <div class="flex min-w-0 items-center gap-1 sm:gap-2">
        <IconButton icon={mdiClose} aria-label="Close" variant="ghost" color="secondary" onclick={onClose} />
        <div class="min-w-0">
          <p class="md-title-small truncate text-white">{filename}</p>
          <p class="md-label-medium truncate text-white/60">
            {index + 1} of {assets.length}
            {#if asset.capturedAt}
              · {DateTime.fromISO(asset.capturedAt).toLocaleString(DateTime.DATETIME_MED)}
            {/if}
          </p>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-0.5 sm:gap-1">
        {#if faces.length > 0}
          <IconButton
            icon={mdiFaceRecognition}
            aria-label={showFaces ? 'Hide faces' : 'Show faces'}
            variant="ghost"
            color={showFaces ? 'primary' : 'secondary'}
            onclick={() => (showFaces = !showFaces)}
          />
        {/if}
        <IconButton
          icon={mdiMagnifyMinusOutline}
          aria-label="Zoom out"
          variant="ghost"
          color="secondary"
          disabled={zoom <= 1}
          onclick={() => setZoom(zoom / 1.4)}
        />
        {#if zoomed}
          <button
            data-md-raw
            class="md-label-medium min-w-11 rounded-full px-2 py-1 text-white/80 hover:bg-white/10"
            title="Reset zoom"
            onclick={resetZoom}
          >
            {Math.round(zoom * 100)}%
          </button>
        {/if}
        <IconButton
          icon={mdiMagnifyPlusOutline}
          aria-label="Zoom in"
          variant="ghost"
          color="secondary"
          disabled={zoom >= 6}
          onclick={() => setZoom(zoom * 1.4)}
        />
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

    <div class="flex min-h-0 flex-1 flex-col md:flex-row">
      <!-- stage -->
      <div
        class="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
        ontouchstart={onTouchStart}
        ontouchend={onTouchEnd}
      >
        {#if index > 0}
          <button
            data-md-raw
            class="absolute start-1 z-10 hidden h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/80 sm:flex"
            aria-label="Previous"
            onclick={previous}
          >
            <Icon icon={mdiChevronLeft} size="1.75rem" />
          </button>
        {/if}

        {#if asset.previewUrl}
          {#if placeholder && !imageLoaded}
            <img src={placeholder} alt="" class="absolute h-full w-full object-contain blur-xl" />
            <div class="absolute"><LoadingSpinner size="giant" /></div>
          {/if}

          <!-- The frame is absolutely sized to the stage, which gives the image
               a definite box to resolve max-h-full/max-w-full against. An
               auto-height wrapper here silently disables those percentages and
               the photo renders at its natural size instead of fitting. -->
          <!-- Scrollable stage: at zoom 1 the photo fits exactly; above that it
               overflows and the browser handles panning. -->
          <div
            bind:this={frameEl}
            class="immich-scrollbar absolute inset-0 overscroll-contain
              {zoomed ? 'overflow-auto' : 'overflow-hidden'}
              {dragging ? 'cursor-grabbing' : zoomed ? 'cursor-grab' : ''}"
            onwheel={onWheel}
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerUp}
            onpointercancel={onPointerUp}
            ondblclick={() => setZoom(zoomed ? 1 : 2.5)}
          >
            <div class="flex min-h-full min-w-full items-center justify-center">
              <!-- Exact photo box: the overlay is inset-0 on it, so outlines
                   line up at any zoom without measuring anything.
                   Deliberately NOT transitioned — animating width/height
                   relayouts every frame, and in any frame-starved context
                   (background tab, throttled compositor) the transition stalls
                   and the photo appears stuck at its old size. -->
              <div
                class="relative shrink-0"
                style={displayWidth > 0 ? `width: ${displayWidth}px; height: ${displayHeight}px` : ''}
              >
                <img
                  src={asset.previewUrl}
                  alt={filename}
                  draggable="false"
                  class="block h-full w-full object-contain transition-opacity duration-200 select-none
                    {imageLoaded ? 'opacity-100' : 'opacity-0'}"
                  onload={onImageLoad}
                />

                {#if showFaces && imageLoaded && faces.length > 0}
                  <FaceBoxes
                    {faces}
                    onOpenPerson={onOpenPerson ? openPerson : undefined}
                    onSetCover={onSetPersonCover ? setCover : undefined}
                  />
                {/if}
              </div>
            </div>
          </div>
        {:else}
          <div class="flex flex-col items-center gap-3 px-6 text-center text-white/70">
            <Icon icon={mdiAlertCircleOutline} size="3rem" />
            <p class="md-body-medium">
              {asset.status === 'failed' ? 'This photo could not be processed.' : 'Still processing — check back shortly.'}
            </p>
          </div>
        {/if}

        {#if index < assets.length - 1}
          <button
            data-md-raw
            class="absolute end-1 z-10 hidden h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/80 sm:flex"
            aria-label="Next"
            onclick={next}
          >
            <Icon icon={mdiChevronRight} size="1.75rem" />
          </button>
        {/if}

        {#if downloadError}
          <p class="md-body-medium absolute bottom-4 rounded-xl bg-red-600/90 px-4 py-2 text-white">{downloadError}</p>
        {/if}
      </div>

      <!-- info panel: side drawer on desktop, bottom sheet on mobile -->
      {#if showInfo}
        <aside
          class="immich-scrollbar max-h-[45vh] shrink-0 overflow-y-auto border-t border-white/10 bg-neutral-900 p-5 text-white md:max-h-none md:w-80 md:border-t-0 md:border-s"
        >
          <h2 class="md-title-medium mb-4">Details</h2>

          <dl class="space-y-3.5">
            <div>
              <dt class="md-label-medium text-white/50">File name</dt>
              <dd class="md-body-medium break-all">{filename}</dd>
            </div>
            {#if asset.width && asset.height}
              <div>
                <dt class="md-label-medium text-white/50">Dimensions</dt>
                <dd class="md-body-medium">{asset.width} × {asset.height}</dd>
              </div>
            {/if}
            {#if detail}
              <div>
                <dt class="md-label-medium text-white/50">Size</dt>
                <dd class="md-body-medium">{formatBytes(detail.fileSize)} · {detail.mimeType}</dd>
              </div>
              {#if detail.exif?.make || detail.exif?.model}
                <div>
                  <dt class="md-label-medium text-white/50">Camera</dt>
                  <dd class="md-body-medium">{[detail.exif.make, detail.exif.model].filter(Boolean).join(' ')}</dd>
                </div>
              {/if}
            {/if}
            <div>
              <dt class="md-label-medium text-white/50">Added</dt>
              <dd class="md-body-medium">{DateTime.fromISO(asset.createdAt).toLocaleString(DateTime.DATETIME_MED)}</dd>
            </div>
            {#if asset.faceCount !== undefined}
              <div>
                <dt class="md-label-medium text-white/50">Face detection</dt>
                <dd class="md-body-medium">
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

          {#if faces.length > 0}
            <h3 class="md-label-medium mt-6 mb-3 text-white/50 uppercase">People in this photo</h3>
            <div class="flex flex-wrap gap-2">
              {#each faces as face (face.id)}
                <button
                  data-md-raw
                  class="md-label-large rounded-full bg-white/10 px-3 py-1.5 transition hover:bg-white/20 disabled:cursor-default disabled:hover:bg-white/10"
                  disabled={!face.personId || !onOpenPerson}
                  onclick={() => face.personId && openPerson(face.personId)}
                >
                  {face.name || 'Unnamed'}
                </button>
              {/each}
            </div>
          {/if}
        </aside>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* @immich/ui maps ghost+secondary to a near-black foreground, which
     disappears against the viewer's black backdrop. Force light-on-dark for
     every control inside the viewer chrome, including their hover states. */
  .viewer :global(button) {
    color: rgba(255, 255, 255, 0.92);
  }

  .viewer :global(button:hover:not(:disabled)) {
    background-color: rgba(255, 255, 255, 0.14);
    color: #fff;
  }

  /* keep the semantic colours that are meant to stand out */
  .viewer :global(button[aria-label='Delete']) {
    color: rgb(248, 113, 113);
  }

  .viewer :global(aside button:disabled) {
    color: rgba(255, 255, 255, 0.6);
  }
</style>
