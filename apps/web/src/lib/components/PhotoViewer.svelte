<script lang="ts">
  // Full-screen asset viewer modelled on Immich's AssetViewer (docs/plan/10 §3):
  // preview image with thumbhash placeholder, face outlines, keyboard + swipe
  // navigation, zoom, a detail panel and a real file download.
  import type { AssetDetail } from '$lib/api';
  import FaceBoxes, { type FaceBox } from '$lib/components/FaceBoxes.svelte';
  import PhotoEditor from '$lib/components/PhotoEditor.svelte';
  import { ContextMenuButton, Icon, IconButton, MenuItemType, type MenuItems } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiArrowLeft,
    mdiCalendarBlankOutline,
    mdiCamera,
    mdiCameraIris,
    mdiCheck,
    mdiChevronLeft,
    mdiChevronRight,
    mdiClose,
    mdiContentCopy,
    mdiDelete,
    mdiDotsVertical,
    mdiDownload,
    mdiFaceRecognition,
    mdiImageOutline,
    mdiImageSearchOutline,
    mdiInformationOutline,
    mdiMagnifyMinusOutline,
    mdiMagnifyPlusOutline,
    mdiMapMarkerOutline,
    mdiPencilOutline,
    mdiPlay,
    mdiRefresh,
    mdiStop,
  } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
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
    /** Same-origin image bytes — required for Copy and the Editor, both of
     * which read pixels via canvas (the presigned R2 preview URL is
     * cross-origin with no CORS headers, which taints that canvas). Omit to
     * hide both actions. */
    imageProxyUrl?: (assetId: string) => string;
    /** Organiser-only: shows the Editor action. Saves as a new photo via the
     * normal upload pipeline rather than replacing the original. */
    canEdit?: boolean;
    onEditSave?: (file: File) => Promise<void>;
    /** 3-dot menu: re-run face detection on just this photo. */
    onRefreshFaces?: (assetId: string) => Promise<void>;
    /** 3-dot menu: jump to this photo in the event's main timeline — omit
     * where the viewer already *is* the main timeline. */
    onViewInTimeline?: (assetId: string) => void;
    /** 3-dot menu: show photos visually similar to this one (CLIP search). */
    onViewSimilar?: (assetId: string) => void;
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
    imageProxyUrl,
    canEdit = false,
    onEditSave,
    onRefreshFaces,
    onViewInTimeline,
    onViewSimilar,
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

  // Slide direction for the change transition: +1 forward, -1 back. Derived by
  // comparing the incoming index against the last one we rendered.
  let direction = $state(1);
  let lastIndex: number | undefined;
  $effect(() => {
    const current = index;
    untrack(() => {
      if (lastIndex !== undefined && current !== lastIndex) {
        direction = current > lastIndex ? 1 : -1;
      }
      lastIndex = current;
    });
  });

  // Reset per-image state whenever we move to a different asset, and fetch the
  // detail record and face boxes that overlay it.
  $effect(() => {
    const id = asset?.id;
    if (!id) {
      return;
    }
    imageLoaded = false;
    resetZoom();
    // `natural` is intentionally NOT reset here: keeping the last photo's
    // dimensions means the sized box holds its shape through the slide
    // transition instead of collapsing to zero, and onImageLoad overwrites it
    // the moment the new photo decodes.
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
    stopSlideshow();
    if (index > 0) {
      onIndexChange(index - 1);
    }
  }

  function next() {
    stopSlideshow();
    if (index < assets.length - 1) {
      onIndexChange(index + 1);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape': {
        if (slideshowActive) {
          stopSlideshow();
        } else if (zoomed) {
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

  // --- copy image (Immich's copyImageToClipboard, asset-utils.ts) ---------
  const canCopy = $derived(!!imageProxyUrl && !!globalThis.navigator?.clipboard && !!globalThis.ClipboardItem);
  let copyStatus = $state<'idle' | 'copying' | 'done' | 'error'>('idle');

  async function copyImage() {
    if (!asset || !imageProxyUrl || copyStatus === 'copying') {
      return;
    }
    copyStatus = 'copying';
    try {
      // Same-origin proxy, not the presigned R2 URL — reading pixels from a
      // cross-origin image with no CORS headers taints the canvas.
      const image = new Image();
      image.src = imageProxyUrl(asset.id);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Canvas conversion failed'))), 'image/png'),
      );
      // Not awaited before constructing ClipboardItem — Safari only allows
      // clipboard writes started synchronously within the user gesture.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      copyStatus = 'done';
    } catch {
      copyStatus = 'error';
    } finally {
      setTimeout(() => (copyStatus = 'idle'), 2000);
    }
  }

  // --- editor: opens PhotoEditor.svelte over this photo --------------------
  // PhotoEditor owns its own "saving" spinner state; this just closes the
  // overlay once the upload completes.
  let editing = $state(false);

  async function saveEdit(file: File) {
    if (!onEditSave) {
      return;
    }
    await onEditSave(file);
    editing = false;
  }

  // --- slideshow: loops through the current asset list ---------------------
  let slideshowActive = $state(false);
  let slideshowTimer: ReturnType<typeof setInterval> | undefined;

  function startSlideshow() {
    slideshowActive = true;
    slideshowTimer = setInterval(() => onIndexChange((index + 1) % assets.length), 4000);
  }

  function stopSlideshow() {
    slideshowActive = false;
    if (slideshowTimer) {
      clearInterval(slideshowTimer);
      slideshowTimer = undefined;
    }
  }

  async function refreshFaces() {
    if (!asset) {
      return;
    }
    await onRefreshFaces?.(asset.id);
  }

  const menuItems = $derived<MenuItems>([
    {
      title: slideshowActive ? 'Stop slideshow' : 'Slideshow',
      icon: slideshowActive ? mdiStop : mdiPlay,
      onAction: () => (slideshowActive ? stopSlideshow() : startSlideshow()),
    },
    { title: 'Download', icon: mdiDownload, $if: () => canDownload, onAction: () => download() },
    {
      title: 'View in timeline',
      icon: mdiImageSearchOutline,
      $if: () => !!onViewInTimeline,
      onAction: () => asset && onViewInTimeline?.(asset.id),
    },
    {
      title: 'View similar photos',
      icon: mdiImageSearchOutline,
      $if: () => !!onViewSimilar,
      onAction: () => asset && onViewSimilar?.(asset.id),
    },
    ...(onRefreshFaces
      ? ([MenuItemType.Divider, { title: 'Refresh faces', icon: mdiRefresh, onAction: () => void refreshFaces() }] as const)
      : []),
  ]);

  onDestroy(() => stopSlideshow());

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

  // Info-panel derived bits (Immich DetailPanel).
  const megapixels = $derived(
    asset?.width && asset?.height ? Math.round((asset.width * asset.height) / 1_000_000) : 0,
  );
  const camera = $derived([detail?.exif?.make, detail?.exif?.model].filter(Boolean).join(' '));
  const latlng = $derived(
    detail?.exif?.latitude && detail?.exif?.longitude
      ? { lat: Number(detail.exif.latitude.toFixed(7)), lng: Number(detail.exif.longitude.toFixed(7)) }
      : null,
  );
  // People with a portrait first (Immich shows avatars); fall back to the raw
  // face list for names when no detail record is loaded.
  const people = $derived(detail?.people ?? []);

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
        <IconButton icon={mdiArrowLeft} aria-label="Back" variant="ghost" color="secondary" onclick={onClose} />
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
        {#if canCopy}
          <IconButton
            icon={copyStatus === 'done' ? mdiCheck : mdiContentCopy}
            aria-label={copyStatus === 'error' ? 'Copy failed' : copyStatus === 'done' ? 'Copied' : 'Copy image'}
            variant="ghost"
            color={copyStatus === 'error' ? 'danger' : copyStatus === 'done' ? 'success' : 'secondary'}
            loading={copyStatus === 'copying'}
            onclick={copyImage}
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
        {#if canEdit && imageProxyUrl}
          <IconButton
            icon={mdiPencilOutline}
            aria-label="Editor"
            variant="ghost"
            color="secondary"
            onclick={() => (editing = true)}
          />
        {/if}
        {#if canDelete}
          <IconButton
            icon={mdiDelete}
            aria-label="Delete"
            variant="ghost"
            color="danger"
            onclick={() => onDelete?.(asset.id)}
          />
        {/if}
        <div class="dark">
          <ContextMenuButton icon={mdiDotsVertical} aria-label="More" items={menuItems} />
        </div>
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col md:flex-row">
      <!-- stage -->
      <div
        class="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
        ontouchstart={onTouchStart}
        ontouchend={onTouchEnd}
      >
        {#if slideshowActive}
          <button
            type="button"
            onclick={stopSlideshow}
            class="absolute top-3 start-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm text-white transition hover:bg-black/80"
          >
            <Icon icon={mdiStop} size="1rem" />
            Stop slideshow
          </button>
        {/if}

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
          <!-- Thumbhash backdrop while the full preview decodes — no spinner,
               so a change reads as a smooth crossfade the way Immich's does. -->
          {#if placeholder && !imageLoaded}
            <img src={placeholder} alt="" class="pointer-events-none absolute h-full w-full object-contain blur-xl" />
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
                <!-- Keyed so each photo change mounts a fresh image that slides
                     in from the direction of travel while the old one slides
                     out — Immich's next/previous feel. The two overlap
                     (absolute inset-0) during the ~220ms transition. Zoomed in,
                     the slide is skipped so panning isn't interrupted. -->
                {#key asset.id}
                  <img
                    src={asset.previewUrl}
                    alt={filename}
                    draggable="false"
                    class="absolute inset-0 block h-full w-full object-contain select-none"
                    in:fly={{ x: zoomed ? 0 : direction * 48, duration: zoomed ? 0 : 220, opacity: 0 }}
                    out:fly={{ x: zoomed ? 0 : -direction * 48, duration: zoomed ? 0 : 220, opacity: 0 }}
                    onload={onImageLoad}
                  />
                {/key}

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

      <!-- Info panel — Immich's DetailPanel: a light side panel (bottom sheet
           on mobile) with a people row, then icon-led detail rows. -->
      {#if showInfo}
        <aside
          id="info-panel"
          class="immich-scrollbar bg-light text-immich-fg dark:text-immich-dark-fg max-h-[45vh] shrink-0 overflow-y-auto md:max-h-none md:w-90 md:border-s md:border-gray-200 dark:md:border-immich-dark-gray"
        >
          <section class="relative p-2">
            <div class="flex place-items-center gap-2">
              <IconButton
                icon={mdiClose}
                aria-label="Close"
                shape="round"
                variant="ghost"
                color="secondary"
                onclick={() => (showInfo = false)}
              />
              <p class="text-lg">Info</p>
            </div>

            <!-- People -->
            {#if people.length > 0}
              <div class="px-2 pt-4">
                <div class="flex flex-wrap gap-3">
                  {#each people as person (person.id)}
                    <button
                      type="button"
                      class="flex w-16 flex-col items-center gap-1 text-center"
                      disabled={!onOpenPerson}
                      onclick={() => openPerson(person.id)}
                    >
                      <span class="size-14 overflow-hidden rounded-full bg-subtle">
                        {#if person.thumbnailUrl}
                          <img src={person.thumbnailUrl} alt="" class="h-full w-full object-cover" />
                        {:else}
                          <span class="text-primary flex h-full w-full items-center justify-center">
                            <Icon icon={mdiFaceRecognition} size="1.5rem" />
                          </span>
                        {/if}
                      </span>
                      {#if person.name}
                        <span class="w-full truncate text-xs">{person.name}</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="p-4">
              <div class="flex h-10 w-full items-center">
                <span class="md-label-medium text-gray-500">
                  {detail?.exif ? 'DETAILS' : 'No metadata available'}
                </span>
              </div>

              <!-- Date -->
              {#if asset.capturedAt || asset.createdAt}
                <div class="flex gap-4 py-2">
                  <Icon icon={mdiCalendarBlankOutline} size="1.5rem" class="mt-0.5 shrink-0" />
                  <div>
                    <p class="font-medium">
                      {DateTime.fromISO(asset.capturedAt ?? asset.createdAt).toLocaleString(DateTime.DATE_FULL)}
                    </p>
                    <p class="text-sm text-gray-500">
                      {DateTime.fromISO(asset.capturedAt ?? asset.createdAt).toLocaleString(DateTime.TIME_SIMPLE)}
                    </p>
                  </div>
                </div>
              {/if}

              <!-- File -->
              <div class="flex gap-4 py-2">
                <Icon icon={mdiImageOutline} size="1.5rem" class="mt-0.5 shrink-0" />
                <div class="min-w-0">
                  <p class="break-all">{filename}</p>
                  <div class="flex gap-2 text-sm text-gray-500">
                    {#if megapixels > 0}<span>{megapixels} MP</span>{/if}
                    {#if asset.width && asset.height}<span>{asset.width} × {asset.height}</span>{/if}
                    {#if detail}<span>{formatBytes(detail.fileSize)}</span>{/if}
                  </div>
                </div>
              </div>

              <!-- Camera -->
              {#if camera}
                <div class="flex gap-4 py-2">
                  <Icon icon={mdiCamera} size="1.5rem" class="mt-0.5 shrink-0" />
                  <div>
                    <p>{camera}</p>
                  </div>
                </div>
              {/if}

              <!-- Lens -->
              {#if detail?.exif?.lens}
                <div class="flex gap-4 py-2">
                  <Icon icon={mdiCameraIris} size="1.5rem" class="mt-0.5 shrink-0" />
                  <div>
                    <p class="line-clamp-2">{detail.exif.lens}</p>
                  </div>
                </div>
              {/if}

              <!-- Location -->
              {#if latlng}
                <div class="flex gap-4 py-2">
                  <Icon icon={mdiMapMarkerOutline} size="1.5rem" class="mt-0.5 shrink-0" />
                  <div>
                    <p>{latlng.lat}, {latlng.lng}</p>
                    <a
                      href="https://www.openstreetmap.org/?mlat={latlng.lat}&mlon={latlng.lng}#map=15/{latlng.lat}/{latlng.lng}"
                      target="_blank"
                      rel="noreferrer noopener"
                      class="text-primary text-sm hover:underline"
                    >
                      Open in OpenStreetMap
                    </a>
                  </div>
                </div>
              {/if}
            </div>
          </section>
        </aside>
      {/if}
    </div>
  </div>
{/if}

{#if editing && asset && imageProxyUrl}
  <PhotoEditor
    src={imageProxyUrl(asset.id)}
    filename={asset.originalFilename ?? 'photo.jpg'}
    onCancel={() => (editing = false)}
    onSave={saveEdit}
  />
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

  /* The info panel is a light surface, so undo the white-on-dark override for
     everything inside it — buttons and links inherit the panel's own colour. */
  .viewer :global(#info-panel button),
  .viewer :global(#info-panel a) {
    color: inherit;
  }

  .viewer :global(#info-panel button:hover:not(:disabled)) {
    background-color: rgba(128, 128, 128, 0.15);
    color: inherit;
  }
</style>
