<script lang="ts">
  // Memories: adapted from Immich's MemoryViewer
  // (immich/web/src/routes/(user)/memory/[[photos=photos]]/[[assetId=id]]/MemoryViewer.svelte).
  //
  // Immich's "memory" is a server-computed bucket ("on this day" N years ago);
  // ours is simpler and event-shaped, per spec: opening an event's glimpse
  // card picks a random 10-15 photo highlight reel from that event and
  // auto-advances through it, with the event's full gallery scrollable below.
  // Previous/next here move between *events* (using the same ordering as the
  // sidebar's Events list and the Photos-tab glimpse strip) rather than
  // between days.
  import { goto } from '$app/navigation';
  import { api, uploadAsset, type AssetItem } from '$lib/api';
  import PhotoTimeline from '$lib/components/PhotoTimeline.svelte';
  import PhotoViewer from '$lib/components/PhotoViewer.svelte';
  import { shellStore } from '$lib/shell.svelte';
  import { Icon, IconButton, LoadingSpinner } from '@immich/ui';
  import {
    mdiChevronDown,
    mdiChevronLeft,
    mdiChevronRight,
    mdiClose,
    mdiImageSearch,
    mdiPause,
    mdiPlay,
  } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onDestroy, onMount } from 'svelte';

  let { data } = $props();
  const eventId = $derived(data.event.id);
  const canManage = $derived(
    data.me.isSuperAdmin ||
      ['owner', 'admin'].includes(data.me.organizations.find((org) => org.id === data.event.orgId)?.role ?? ''),
  );

  // --- adjacent events (previous/next memory), same order as the sidebar ---
  const eventIndex = $derived(shellStore.events.findIndex((event) => event.id === eventId));
  const previousEvent = $derived(eventIndex > 0 ? shellStore.events[eventIndex - 1] : null);
  const nextEvent = $derived(
    eventIndex >= 0 && eventIndex < shellStore.events.length - 1 ? shellStore.events[eventIndex + 1] : null,
  );

  // --- slideshow: a fixed random sample, picked once per visit ---
  let slideshow = $state<AssetItem[]>([]);
  let slideshowLoading = $state(true);
  let assetIndex = $state(0);
  const currentAsset = $derived(slideshow[assetIndex]);

  const PHOTO_DURATION_MS = 5000;
  let paused = $state(false);
  let progress = $state(0); // 0..1 through the current photo
  let progressTimer: ReturnType<typeof setInterval> | undefined;

  function startProgressTimer() {
    stopProgressTimer();
    progressTimer = setInterval(() => {
      if (paused) {
        return;
      }
      progress = Math.min(1, progress + 50 / PHOTO_DURATION_MS);
      if (progress >= 1) {
        advance(1);
      }
    }, 50);
  }

  function stopProgressTimer() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = undefined;
    }
  }

  function advance(direction: 1 | -1) {
    const next = assetIndex + direction;
    if (next < 0) {
      return;
    }
    if (next >= slideshow.length) {
      // ran out of the highlight reel — hand off to the next event's memory
      if (nextEvent) {
        void goto(`/memories/${nextEvent.id}`);
      }
      return;
    }
    assetIndex = next;
    progress = 0;
  }

  function jumpTo(index: number) {
    assetIndex = index;
    progress = 0;
  }

  // --- gallery scroll cue: pauses the slideshow once it's scrolled away ---
  let galleryEl = $state<HTMLElement | null>(null);
  let stageEl = $state<HTMLElement | null>(null);
  let galleryInView = $state(false);

  $effect(() => {
    if (!galleryEl) {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => (galleryInView = entry.isIntersecting), {
      rootMargin: '0px 0px -200px 0px',
    });
    observer.observe(galleryEl);
    return () => observer.disconnect();
  });

  $effect(() => {
    paused = galleryInView;
  });

  // --- full gallery below (reuses the event page's own pagination) ---
  let galleryAssets = $state<AssetItem[]>([]);
  let galleryCursor = $state<string | null>(null);
  let galleryLoading = $state(true);
  let viewerIndex = $state(-1);

  async function loadSlideshow() {
    slideshowLoading = true;
    assetIndex = 0;
    progress = 0;
    slideshow = await api.assets.random(eventId, 15).catch(() => []);
    slideshowLoading = false;
    startProgressTimer();
  }

  async function loadGalleryFirstPage() {
    galleryLoading = true;
    const result = await api.assets.list(eventId).catch(() => ({ assets: [], nextCursor: null }));
    galleryAssets = result.assets;
    galleryCursor = result.nextCursor;
    galleryLoading = false;
  }

  async function loadGalleryMore() {
    if (!galleryCursor) {
      return;
    }
    const result = await api.assets.list(eventId, galleryCursor);
    galleryAssets = [...galleryAssets, ...result.assets];
    galleryCursor = result.nextCursor;
  }

  async function deleteAsset(assetId: string) {
    if (!confirm('Delete this photo? It will be removed from all galleries.')) {
      return;
    }
    await api.assets.remove(eventId, [assetId]);
    viewerIndex = -1;
    await loadGalleryFirstPage();
  }

  // Re-run whenever the eventId param changes (prev/next-event navigation
  // keeps this component mounted rather than remounting it).
  $effect(() => {
    const id = eventId;
    stopProgressTimer();
    void loadSlideshow();
    void loadGalleryFirstPage();
    return () => stopProgressTimer();
  });

  function onKeydown(event: KeyboardEvent) {
    if (viewerIndex >= 0) {
      return; // the full-detail viewer owns the keyboard while open
    }
    switch (event.key) {
      case 'ArrowRight': {
        advance(1);
        break;
      }
      case 'ArrowLeft': {
        advance(-1);
        break;
      }
      case 'Escape': {
        void goto('/photos');
        break;
      }
    }
  }

  onDestroy(() => stopProgressTimer());
</script>

<svelte:head><title>{data.event.name} — EventLens</title></svelte:head>
<svelte:window onkeydown={onKeydown} />

<!-- Cancels the page shell's padding, the same trick the Map page uses, so
     the slideshow fills the content area edge-to-edge. -->
<div class="-m-4 -my-5 sm:-mx-6 lg:-mx-8 lg:-my-6">
  <section class="dark bg-immich-dark-gray relative w-full text-white" bind:this={stageEl}>
    <!-- header: close + title + progress segments + play/pause -->
    <div class="grid grid-cols-1 gap-3 p-3 sm:grid-cols-[1fr_2fr_1fr] sm:p-4">
      <div class="flex items-center gap-2 sm:gap-4">
        <IconButton
          icon={mdiClose}
          aria-label="Close"
          shape="round"
          variant="ghost"
          color="secondary"
          size="large"
          onclick={() => goto('/photos')}
        />
        <p class="truncate text-lg">{data.event.name}</p>
      </div>

      <div class="flex items-center justify-center gap-2">
        {#if !slideshowLoading && slideshow.length > 0}
          <IconButton
            icon={paused ? mdiPlay : mdiPause}
            aria-label={paused ? 'Play' : 'Pause'}
            shape="round"
            variant="ghost"
            color="secondary"
            onclick={() => (paused = !paused)}
          />
          {#each slideshow as _, index (index)}
            <button
              type="button"
              aria-label="Go to photo {index + 1}"
              onclick={() => jumpTo(index)}
              class="relative grow py-2"
            >
              <span class="absolute inset-x-0 h-0.5 w-full rounded-full bg-white/30"></span>
              <span
                class="absolute start-0 h-0.5 rounded-full bg-white"
                style:width="{index < assetIndex ? 100 : index > assetIndex ? 0 : progress * 100}%"
              ></span>
            </button>
          {/each}
          <span class="shrink-0 text-sm text-white/70">{assetIndex + 1} / {slideshow.length}</span>
        {/if}
      </div>

      <div></div>
    </div>

    {#if slideshowLoading}
      <div class="flex h-[50vh] items-center justify-center"><LoadingSpinner size="giant" /></div>
    {:else if slideshow.length === 0}
      <div class="flex h-[50vh] flex-col items-center justify-center gap-2 px-6 text-center text-white/70">
        <p class="text-lg">No processed photos yet</p>
        <p class="text-sm">Once photos finish processing, this event's memory reel appears here.</p>
      </div>
    {:else}
      <!-- stage: previous-event peek | current photo | next-event peek -->
      <!-- Real viewport height rather than a fixed 60vh: the photo should be
           limited by whichever dimension actually binds on this screen, and a
           short fixed stage left a portrait shrunk with unused space above and
           below it. dvh so mobile browser chrome does not clip it. -->
      <div
        class="mx-auto flex h-[calc(100dvh-11rem)] min-h-[18rem] max-w-7xl items-center justify-center gap-3 overflow-hidden px-3 pb-6 sm:gap-6 sm:px-6"
      >
        <button
          type="button"
          aria-label="Previous event"
          disabled={!previousEvent}
          onclick={() => previousEvent && goto(`/memories/${previousEvent.id}`)}
          class="hidden h-1/2 w-[16vw] shrink-0 overflow-hidden rounded-2xl transition sm:block
            {previousEvent ? 'opacity-25 hover:opacity-70' : 'opacity-0'}"
        >
          {#if previousEvent?.coverUrl}
            <img src={previousEvent.coverUrl} alt="" class="h-full w-full object-cover" />
          {/if}
        </button>

        <!-- No black plate behind the image: with the frame sized to the
             viewport, a letterbox box just draws bars around a photo that is
             already centred on the dark stage. -->
        <div class="relative flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden">
          {#if currentAsset}
            {#key currentAsset.id}
              {#if currentAsset.previewUrl}
                <!-- max-* rather than h-full/w-full: the image keeps its own
                     aspect and is bounded by the frame, so a portrait fits to
                     height and a landscape to width without ever cropping. -->
                <img
                  src={currentAsset.previewUrl}
                  alt=""
                  class="max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
                />
              {/if}
            {/key}
          {/if}

          <div class="pointer-events-none absolute inset-x-4 top-3 text-sm font-medium text-white/90">
            {#if currentAsset?.capturedAt}
              <p>{DateTime.fromISO(currentAsset.capturedAt).toLocaleString(DateTime.DATE_FULL)}</p>
            {/if}
          </div>

          <!-- view in timeline: deep-links into the real gallery at this photo -->
          {#if currentAsset}
            <div class="absolute end-2 bottom-2">
              <IconButton
                icon={mdiImageSearch}
                aria-label="View in timeline"
                shape="round"
                variant="ghost"
                color="secondary"
                onclick={() => goto(`/events/${eventId}?asset=${currentAsset.id}`)}
              />
            </div>
          {/if}

          {#if assetIndex > 0}
            <button
              type="button"
              aria-label="Previous photo"
              onclick={() => advance(-1)}
              class="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60"
            >
              <Icon icon={mdiChevronLeft} size="1.75rem" />
            </button>
          {/if}
          {#if assetIndex < slideshow.length - 1 || nextEvent}
            <button
              type="button"
              aria-label="Next photo"
              onclick={() => advance(1)}
              class="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60"
            >
              <Icon icon={mdiChevronRight} size="1.75rem" />
            </button>
          {/if}
        </div>

        <button
          type="button"
          aria-label="Next event"
          disabled={!nextEvent}
          onclick={() => nextEvent && goto(`/memories/${nextEvent.id}`)}
          class="hidden h-1/2 w-[16vw] shrink-0 overflow-hidden rounded-2xl transition sm:block
            {nextEvent ? 'opacity-25 hover:opacity-70' : 'opacity-0'}"
        >
          {#if nextEvent?.coverUrl}
            <img src={nextEvent.coverUrl} alt="" class="h-full w-full object-cover" />
          {/if}
        </button>
      </div>
    {/if}

    <!-- scroll cue -->
    <div class="flex justify-center pb-3 transition-opacity {galleryInView ? 'opacity-0' : 'opacity-100'}">
      <IconButton
        icon={mdiChevronDown}
        aria-label="Show full gallery"
        shape="round"
        variant="ghost"
        color="secondary"
        onclick={() => galleryEl?.scrollIntoView({ behavior: 'smooth' })}
      />
    </div>
  </section>

  <!-- full event gallery -->
  <section bind:this={galleryEl} class="px-4 py-6 sm:px-6 lg:px-8">
    <h2 class="md-title-large mb-4">All photos from {data.event.name}</h2>
    {#if galleryLoading}
      <div class="flex justify-center py-16"><LoadingSpinner size="giant" /></div>
    {:else if galleryAssets.length === 0}
      <p class="py-10 text-center text-gray-500">No photos yet.</p>
    {:else}
      <PhotoTimeline assets={galleryAssets} onOpen={(index) => (viewerIndex = index)} />
      {#if galleryCursor}
        <div class="mt-6 flex justify-center">
          <button
            type="button"
            onclick={loadGalleryMore}
            class="hover:bg-subtle rounded-full border border-gray-300 px-4 py-2 text-sm transition"
          >
            Load more
          </button>
        </div>
      {/if}
    {/if}
  </section>
</div>

{#if viewerIndex >= 0 && galleryAssets[viewerIndex]}
  <PhotoViewer
    assets={galleryAssets}
    index={viewerIndex}
    downloadUrl={(assetId) => api.assets.downloadUrl(eventId, assetId)}
    loadDetail={(assetId) => api.assets.get(eventId, assetId)}
    canDelete={canManage}
    canEdit={canManage}
    imageProxyUrl={(assetId) => api.assets.imageUrl(eventId, assetId)}
    onEditSave={async (file) => {
      await uploadAsset(eventId, file, () => {});
      await loadGalleryFirstPage();
    }}
    onRefreshFaces={canManage ? (assetId) => api.assets.runJob(eventId, assetId, 'faceDetection', true) : undefined}
    onViewInTimeline={(assetId) => {
      viewerIndex = -1;
      goto(`/events/${eventId}?asset=${assetId}`);
    }}
    onViewSimilar={(assetId) => goto(`/events/${eventId}/similar/${assetId}`)}
    onClose={() => (viewerIndex = -1)}
    onIndexChange={(index) => (viewerIndex = index)}
    onDelete={deleteAsset}
  />
{/if}
