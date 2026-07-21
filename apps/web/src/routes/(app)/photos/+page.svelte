<script lang="ts">
  // Org-wide Photos timeline: every event's photos in one stream, newest
  // first, grouped by capture date.
  //
  // Immich's own Timeline is ~2,000 lines across a virtualising manager, month
  // and day bucket classes and a websocket-driven store. Rather than drag that
  // whole subsystem in, this reuses the justified timeline this app already
  // has — the same visual result — and adds the two behaviours that matter at
  // this scale: infinite scroll and a month scrubber.
  import { goto } from '$app/navigation';
  import { api, type OrgTimelineAsset } from '$lib/api';
  import EventGlimpse from '$lib/components/EventGlimpse.svelte';
  import PhotoTimeline from '$lib/components/PhotoTimeline.svelte';
  import Scrubber from '$lib/components/Scrubber.svelte';
  import { shellStore } from '$lib/shell.svelte';
  import { Heading, Icon, LoadingSpinner } from '@immich/ui';
  import { mdiChevronDown } from '@mdi/js';

  let timelineTop = $state<HTMLElement | null>(null);
  let timelineEl = $state<HTMLElement | null>(null);

  let assets = $state<OrgTimelineAsset[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(true);
  let loadingMore = $state(false);
  let exhausted = $state(false);
  let sentinel = $state<HTMLElement | null>(null);

  async function loadMore() {
    const orgId = shellStore.orgId;
    if (!orgId || loadingMore || exhausted) {
      return;
    }
    loadingMore = true;
    try {
      const result = await api.orgs.assets(orgId, cursor ?? undefined);
      assets = [...assets, ...result.assets];
      cursor = result.nextCursor;
      exhausted = result.nextCursor === null;
    } finally {
      loadingMore = false;
      loading = false;
    }
  }

  // Opening a photo hands off to its own event's gallery, which already owns
  // the viewer; the org timeline stays a browsing surface.
  function open(index: number) {
    const asset = assets[index];
    if (asset) {
      void goto(`/events/${asset.eventId}?asset=${asset.id}`);
    }
  }

  // Driven by shellStore.orgId rather than onMount: the layout resolves the
  // active organization in an effect, which runs *after* a child's onMount, so
  // mounting-time code would read null and load nothing.
  let started = $state(false);
  $effect(() => {
    const orgId = shellStore.orgId;
    if (orgId && !started) {
      started = true;
      void loadMore();
    }
  });

  // Re-attaches whenever the sentinel element appears or is replaced. The
  // generous rootMargin fetches the next page before the user reaches the
  // bottom, so scrolling never visibly stalls.
  $effect(() => {
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });
</script>

<svelte:head><title>Photos — EventLens</title></svelte:head>

<!-- Memories-style event glimpse strip, above the timeline. -->
{#if shellStore.events.length > 0}
  <div class="mb-6">
    <EventGlimpse events={shellStore.events} onOpen={(id) => goto(`/memories/${id}`)} />
    <!-- Scroll cue down to the timeline, like Immich. -->
    <div class="flex justify-center">
      <button
        type="button"
        aria-label="Jump to timeline"
        onclick={() => timelineTop?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        class="mt-1 rounded-full p-1.5 text-gray-500 transition hover:bg-gray-200/60 hover:text-immich-primary"
      >
        <Icon icon={mdiChevronDown} size="1.5rem" />
      </button>
    </div>
  </div>
{/if}

<div bind:this={timelineTop} class="flex items-baseline justify-between gap-4 scroll-mt-20">
  <Heading size="large" class="mb-4">Photos</Heading>
  {#if assets.length > 0}
    <p class="md-body-medium text-gray-500">
      {assets.length.toLocaleString()}{exhausted ? '' : '+'} loaded
    </p>
  {/if}
</div>

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else if assets.length === 0}
  <div class="md-surface p-10 text-center">
    <p class="md-title-medium mb-1">No photos yet</p>
    <p class="md-body-medium text-gray-500">Photos from every event in your organization appear here.</p>
  </div>
{:else}
  <!-- Reserve the scrubber's rail width on the right so tiles never sit under
       it (Immich reserves scrubberWidth the same way). -->
  <div class="md:pe-[60px]">
    <div bind:this={timelineEl}>
      <PhotoTimeline {assets} onOpen={open} />
    </div>

    <div bind:this={sentinel} class="h-10"></div>
    {#if loadingMore}
      <div class="flex justify-center py-6"><LoadingSpinner /></div>
    {:else if exhausted}
      <p class="md-body-small py-6 text-center text-gray-500">That's everything.</p>
    {/if}
  </div>

  <Scrubber timelineElement={timelineEl} revision={assets.length} />
{/if}
