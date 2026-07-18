<script lang="ts">
  import { page } from '$app/state';
  import { api, type GalleryResponse } from '$lib/api';
  import PhotoTimeline from '$lib/components/PhotoTimeline.svelte';
  import { Heading, IconButton, LoadingSpinner } from '@immich/ui';
  import { mdiChevronLeft, mdiChevronRight, mdiClose, mdiDownload } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';

  const token = page.params.token!;

  let gallery = $state<GalleryResponse | null>(null);
  let notFound = $state(false);
  let viewerIndex = $state(-1);
  let refreshedOnce = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  async function refresh() {
    try {
      gallery = await api.public.gallery(token);
    } catch {
      notFound = true;
    }
  }

  // presigned URLs expire after 1h — on image error refetch the listing once,
  // with backoff (docs/plan/10 §5, risk R10)
  async function onImageError() {
    if (refreshedOnce) return;
    refreshedOnce = true;
    await refresh();
    setTimeout(() => (refreshedOnce = false), 60_000);
  }

  function onKeydown(event: KeyboardEvent) {
    if (viewerIndex < 0 || !gallery) return;
    if (event.key === 'Escape') viewerIndex = -1;
    if (event.key === 'ArrowRight' && viewerIndex < gallery.assets.length - 1) viewerIndex++;
    if (event.key === 'ArrowLeft' && viewerIndex > 0) viewerIndex--;
  }

  onMount(() => {
    void refresh();
    // the gallery is live — keep it fresh while processing continues
    pollTimer = setInterval(() => void refresh(), 30_000);
  });
  onDestroy(() => pollTimer && clearInterval(pollTimer));
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head><title>Your photos — EventLens</title></svelte:head>

<div class="min-h-screen bg-immich-bg">
  {#if notFound}
    <div class="flex min-h-screen items-center justify-center p-4">
      <p class="text-gray-500">This gallery link is invalid or has expired.</p>
    </div>
  {:else if !gallery}
    <div class="flex min-h-screen items-center justify-center"><LoadingSpinner size="giant" /></div>
  {:else}
    <header class="border-b border-gray-100 px-6 py-5 text-center">
      <Heading size="large">Your photos from {gallery.event.name}</Heading>
      <p class="mt-1 text-sm text-gray-500">
        {gallery.assets.length} photo{gallery.assets.length === 1 ? '' : 's'} — this gallery updates automatically as
        more photos are processed.
      </p>
    </header>

    <main class="mx-auto max-w-6xl p-4">
      {#if gallery.assets.length === 0}
        <div class="rounded-2xl border border-dashed border-gray-300 p-16 text-center text-gray-500">
          {#if gallery.status === 'processing'}
            We're still processing your selfie — check back in a minute.
          {:else}
            No photos of you yet. As more event photos are uploaded, they'll appear here.
          {/if}
        </div>
      {:else}
        <PhotoTimeline assets={gallery.assets} onOpen={(index) => (viewerIndex = index)} {onImageError} />
      {/if}
    </main>
  {/if}
</div>

{#if viewerIndex >= 0 && gallery?.assets[viewerIndex]}
  {@const current = gallery.assets[viewerIndex]}
  <div class="fixed inset-0 z-50 flex flex-col bg-black/95">
    <div class="flex items-center justify-end gap-1 p-4">
      <IconButton
        icon={mdiDownload}
        aria-label="Download"
        variant="ghost"
        color="secondary"
        href={api.public.galleryDownloadUrl(token, current.id)}
      />
      <IconButton icon={mdiClose} aria-label="Close" variant="ghost" color="secondary" onclick={() => (viewerIndex = -1)} />
    </div>
    <div class="relative flex flex-1 items-center justify-center overflow-hidden px-14 pb-6">
      {#if viewerIndex > 0}
        <button class="absolute start-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onclick={() => viewerIndex--}>
          <Icon icon={mdiChevronLeft} size="2rem" />
        </button>
      {/if}
      <img src={current.previewUrl ?? current.thumbUrl} alt="" class="max-h-full max-w-full object-contain" />
      {#if viewerIndex < (gallery?.assets.length ?? 0) - 1}
        <button class="absolute end-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onclick={() => viewerIndex++}>
          <Icon icon={mdiChevronRight} size="2rem" />
        </button>
      {/if}
    </div>
  </div>
{/if}
