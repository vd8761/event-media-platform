<script lang="ts">
  // Participant gallery: a real gallery shell with a sidebar, not a bare grid.
  // "Your photos" is always there; "Event photos" only appears when the
  // organiser has shared the whole event.
  import { page } from '$app/state';
  import {
    api,
    asExpiredEvent,
    downloadSelectionZip,
    saveBlob,
    type ExpiredEventInfo,
    type GalleryAsset,
    type GalleryResponse,
  } from '$lib/api';
  import PhotoTimeline from '$lib/components/PhotoTimeline.svelte';
  import PhotoViewer from '$lib/components/PhotoViewer.svelte';
  import PublicTopBar from '$lib/components/PublicTopBar.svelte';
  import Scrubber from '$lib/components/Scrubber.svelte';
  import SelectionBar from '$lib/components/SelectionBar.svelte';
  import { Button, Icon, LoadingSpinner } from '@immich/ui';
  import {
    mdiAccountBox,
    mdiCheckCircleOutline,
    mdiDownload,
    mdiImageMultiple,
    mdiImageOff,
    mdiPartyPopper,
  } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';

  const token = page.params.token!;

  let gallery = $state<GalleryResponse | null>(null);
  let notFound = $state(false);
  let expired = $state<ExpiredEventInfo | null>(null);
  let viewerIndex = $state(-1);
  let timelineEl = $state<HTMLElement | null>(null);
  let refreshedOnce = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  type Tab = 'mine' | 'event' | 'person';
  let tab = $state<Tab>('mine');
  let eventAssets = $state<GalleryAsset[]>([]);
  let eventCursor = $state<string | null>(null);
  let eventLoading = $state(false);

  // set when a face is tapped — only reachable while the event is shared
  let personView = $state<{ id: string; name: string; assets: GalleryAsset[] } | null>(null);

  async function openPerson(personId: string) {
    try {
      const result = await api.public.person(token, personId);
      personView = { id: result.person.id, name: result.person.name, assets: result.assets };
      tab = 'person';
      viewerIndex = -1;
      clearSelection();
    } catch {
      // sharing turned off between render and tap — stay put
    }
  }

  let selected = $state(new Set<string>());
  let selectMode = $state(false);
  const selecting = $derived(selected.size > 0 || selectMode);
  let downloading = $state(false);

  const showAll = $derived(gallery?.event.showAllPhotos ?? false);
  const canDownloadAll = $derived(gallery?.event.canDownloadAllPhotos ?? false);
  // Their own photos are always downloadable; the event tab depends on the
  // organiser's second toggle.
  const canDownloadCurrent = $derived(tab === 'mine' || canDownloadAll);
  const assets = $derived(
    tab === 'mine' ? (gallery?.assets ?? []) : tab === 'person' ? (personView?.assets ?? []) : eventAssets,
  );
  const stillWorking = $derived(gallery?.status === 'processing' || gallery?.status === 'pending_match');

  async function refresh() {
    try {
      gallery = await api.public.gallery(token);
      notFound = false;
      expired = null;
    } catch (error) {
      // An expired event is a different story from a bad link: the guest's
      // link was real, so tell them what happened instead of implying they
      // mistyped something.
      expired = asExpiredEvent(error);
      notFound = expired === null;
    }
  }

  async function loadEventAssets(more = false) {
    if (eventLoading || (more && !eventCursor)) {
      return;
    }
    eventLoading = true;
    try {
      const result = await api.public.eventAssets(token, more ? (eventCursor ?? undefined) : undefined);
      eventAssets = more ? [...eventAssets, ...result.assets] : result.assets;
      eventCursor = result.nextCursor;
    } catch {
      eventAssets = [];
    } finally {
      eventLoading = false;
    }
  }

  async function selectTab(next: 'mine' | 'event') {
    tab = next;
    personView = null;
    clearSelection();
    if (next === 'event' && eventAssets.length === 0) {
      await loadEventAssets();
    }
  }

  function clearSelection() {
    selectMode = false;
    selected = new Set();
  }

  async function downloadSelected() {
    downloading = true;
    try {
      await downloadSelectionZip(
        api.public.galleryDownloadAllUrl(token),
        [...selected],
        `${gallery?.event.name ?? 'photos'}.zip`,
      );
    } finally {
      downloading = false;
    }
  }

  async function downloadAll() {
    downloading = true;
    try {
      const response = await fetch(api.public.galleryDownloadAllUrl(token));
      await saveBlob(response, `${gallery?.event.name ?? 'photos'}.zip`);
    } finally {
      downloading = false;
    }
  }

  // presigned URLs expire after 1h — on image error refetch the listing once,
  // with backoff (docs/plan/10 §5, risk R10)
  async function onImageError() {
    if (refreshedOnce) {
      return;
    }
    refreshedOnce = true;
    await refresh();
    setTimeout(() => (refreshedOnce = false), 60_000);
  }

  onMount(() => {
    void refresh();
    // the gallery is live — keep it fresh while processing continues
    pollTimer = setInterval(() => void refresh(), 30_000);
  });
  onDestroy(() => pollTimer && clearInterval(pollTimer));
</script>

<svelte:head><title>Your photos — EventLens</title></svelte:head>

<!-- Shared guest top bar: EventLens on the left, the organiser on the right.
     Rendered outside the branches so it is present on the expired and
     not-found states too, which are otherwise unbranded dead ends. -->
<PublicTopBar
  orgName={gallery?.organization.name ?? null}
  eventName={gallery?.event.name ?? null}
  eventId={gallery?.event.id}
/>

{#if expired}
  <div class="bg-immich-bg flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
    <div class="md-surface w-full max-w-md p-8 text-center">
      <p class="md-title-large mb-2">{expired.eventName} has closed</p>
      <p class="md-body-medium text-gray-600">
        {#if expired.expiredAt}
          This gallery was available until {new Date(expired.expiredAt).toLocaleDateString(undefined, {
            dateStyle: 'long',
          })} and is no longer open.
        {:else}
          This gallery is no longer open.
        {/if}
      </p>
      <p class="md-body-small mt-4 text-gray-500">
        {#if expired.purged}
          The event photos have been deleted.
        {:else}
          If you still need your photos, contact the event organiser.
        {/if}
      </p>
    </div>
  </div>
{:else if notFound}
  <div class="bg-immich-bg flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
    <p class="text-gray-500">This gallery link is invalid or has expired.</p>
  </div>
{:else if !gallery}
  <div class="bg-immich-bg flex min-h-[calc(100vh-4rem)] items-center justify-center"><LoadingSpinner size="giant" /></div>
{:else}
  <div class="bg-immich-bg flex min-h-[calc(100vh-4rem)]">
    <!-- sidebar (desktop) -->
    <aside class="bg-immich-gray fixed bottom-0 top-16 start-0 z-10 hidden w-64 flex-col border-e border-gray-100 px-3 py-5 md:flex">
      <div class="mb-8 px-3">
        <p class="md-title-large truncate">{gallery.event.name}</p>
      </div>

      <nav class="flex flex-1 flex-col gap-1">
        <button
          class="md-label-large flex min-h-14 items-center gap-3 rounded-full px-4 transition
            {tab === 'mine' ? 'bg-immich-primary/15 text-immich-primary' : 'text-gray-700 hover:bg-gray-200/60'}"
          onclick={() => selectTab('mine')}
        >
          <Icon icon={mdiAccountBox} size="1.375rem" />
          Your photos
          <span class="md-label-medium ms-auto opacity-70">{gallery.assets.length}</span>
        </button>

        {#if showAll}
          <button
            class="md-label-large flex min-h-14 items-center gap-3 rounded-full px-4 transition
              {tab === 'event' || tab === 'person'
              ? 'bg-immich-primary/15 text-immich-primary'
              : 'text-gray-700 hover:bg-gray-200/60'}"
            onclick={() => selectTab('event')}
          >
            <Icon icon={mdiImageMultiple} size="1.375rem" />
            Event photos
          </button>
        {/if}
      </nav>

      {#if gallery.assets.length > 0}
        <div class="border-t border-gray-200 pt-3">
          <Button fullWidth size="large" leadingIcon={mdiDownload} loading={downloading} onclick={downloadAll}>
            Download all
          </Button>
        </div>
      {/if}
    </aside>

    <main class="min-h-[calc(100vh-4rem)] min-w-0 flex-1 px-4 py-5 sm:px-6 md:ms-64 md:px-8 md:py-6">
      <!-- mobile: brand + segmented tabs -->
      <div class="mb-4 md:hidden">
        <p class="md-title-medium truncate">{gallery.event.name}</p>
      </div>
      {#if showAll}
        <div class="mb-4 flex gap-2 md:hidden">
          <button
            class="md-label-large min-h-10 rounded-full px-4 {tab === 'mine'
              ? 'bg-immich-primary text-immich-bg'
              : 'bg-gray-100 text-gray-700'}"
            onclick={() => selectTab('mine')}
          >
            Your photos
          </button>
          <button
            class="md-label-large min-h-10 rounded-full px-4 {tab === 'event' || tab === 'person'
              ? 'bg-immich-primary text-immich-bg'
              : 'bg-gray-100 text-gray-700'}"
            onclick={() => selectTab('event')}
          >
            Event photos
          </button>
        </div>
      {/if}

      <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="md-headline-small">
            {#if tab === 'person'}
              {personView?.name || 'Unnamed person'}
            {:else}
              {tab === 'mine' ? 'Your photos' : 'Event photos'}
            {/if}
          </h1>
          <p class="md-body-medium mt-1 text-gray-500">
            {#if tab === 'person'}
              {personView?.assets.length ?? 0} photo{(personView?.assets.length ?? 0) === 1 ? '' : 's'} from this event.
              <button data-md-raw class="text-immich-primary underline" onclick={() => selectTab('event')}>
                Back to event photos
              </button>
            {:else if tab === 'mine'}
              {#if stillWorking && gallery.assets.length === 0}
                We're still looking through {gallery.event.name}.
              {:else}
                {gallery.assets.length} photo{gallery.assets.length === 1 ? '' : 's'} of you at {gallery.event.name} — this
                page updates as more are processed.
              {/if}
            {:else}
              Every photo from {gallery.event.name}.
              {#if !canDownloadAll}<span class="text-gray-400">View only.</span>{/if}
            {/if}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          {#if assets.length > 0 && canDownloadCurrent && !selecting}
            <Button size="small" variant="outline" leadingIcon={mdiCheckCircleOutline} onclick={() => (selectMode = true)}>
              Select
            </Button>
          {/if}
          {#if tab === 'mine' && gallery.assets.length > 0}
            <!-- filled chip, always visible on mobile where the sidebar is hidden -->
            <Button size="small" leadingIcon={mdiDownload} loading={downloading} onclick={downloadAll} class="md:hidden">
              Download all
            </Button>
          {/if}
        </div>
      </div>

      {#if selecting}
        <SelectionBar
          count={selected.size}
          total={assets.length}
          {downloading}
          onSelectAll={() => (selected = new Set(assets.map((asset) => asset.id)))}
          onClear={clearSelection}
          onDownload={downloadSelected}
        />
      {/if}

      <div bind:this={timelineEl} class="md:pe-[60px]">
      {#if tab === 'mine' && gallery.assets.length === 0}
        <div class="rounded-2xl border border-dashed border-gray-300 p-16 text-center">
          {#if stillWorking}
            <LoadingSpinner size="giant" />
            <p class="mt-4 font-medium">We're still looking for you</p>
            <p class="mt-1 text-sm text-gray-500">
              Your selfie is being checked against the event photos. This page updates on its own — leave it open, or
              come back to this link any time.
            </p>
          {:else if gallery.status === 'no_face'}
            <Icon icon={mdiImageOff} size="2.5rem" class="mx-auto mb-3 text-gray-300" />
            <p class="font-medium">We couldn't find a face in your selfie</p>
            <p class="mt-1 text-sm text-gray-500">Submit a clearer, well-lit photo of just your face to try again.</p>
          {:else}
            <Icon icon={mdiImageOff} size="2.5rem" class="mx-auto mb-3 text-gray-300" />
            <p class="font-medium">No photos of you yet</p>
            <p class="mt-1 text-sm text-gray-500">As more event photos are uploaded, they'll appear here.</p>
          {/if}
        </div>
      {:else if tab === 'mine'}
        {#if !stillWorking}
          <div class="mb-5 flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">
            <Icon icon={mdiPartyPopper} size="1.25rem" />
            We found you in {gallery.assets.length} photo{gallery.assets.length === 1 ? '' : 's'}.
          </div>
        {/if}
        <PhotoTimeline
          assets={gallery.assets}
          bind:selected
          {selectMode}
          onOpen={(index) => (viewerIndex = index)}
          {onImageError}
        />
      {:else if tab === 'person'}
        {#if (personView?.assets.length ?? 0) === 0}
          <div class="md-surface p-12 text-center text-gray-500">No photos of this person.</div>
        {:else}
          <PhotoTimeline
            assets={personView?.assets ?? []}
            bind:selected
            {selectMode}
            readonly={!canDownloadAll}
            onOpen={(index) => (viewerIndex = index)}
            {onImageError}
          />
        {/if}
      {:else if eventLoading && eventAssets.length === 0}
        <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
      {:else if eventAssets.length === 0}
        <div class="md-surface border-dashed p-12 text-center text-gray-500">No event photos yet.</div>
      {:else}
        <PhotoTimeline
          assets={eventAssets}
          bind:selected
          {selectMode}
          readonly={!canDownloadAll}
          onOpen={(index) => (viewerIndex = index)}
          {onImageError}
        />
        {#if eventCursor}
          <div class="mt-6 flex justify-center">
            <Button variant="outline" loading={eventLoading} onclick={() => loadEventAssets(true)}>Load more</Button>
          </div>
        {/if}
      {/if}
      </div>

      <Scrubber timelineElement={timelineEl} revision={assets.length} topOffset={0} />
    </main>
  </div>
{/if}

{#if viewerIndex >= 0 && assets[viewerIndex]}
  <PhotoViewer
    {assets}
    index={viewerIndex}
    canDownload={canDownloadCurrent}
    downloadUrl={(assetId) => api.public.galleryDownloadUrl(token, assetId)}
    loadFaces={async (assetId) => (await api.public.assetFaces(token, assetId)).faces}
    onOpenPerson={showAll ? openPerson : undefined}
    onClose={() => (viewerIndex = -1)}
    onIndexChange={(index) => (viewerIndex = index)}
  />
{/if}
