<script lang="ts">
  import { page } from '$app/state';
  import { api, type GalleryResponse } from '$lib/api';
  import PhotoTimeline from '$lib/components/PhotoTimeline.svelte';
  import PhotoViewer from '$lib/components/PhotoViewer.svelte';
  import { Button, Heading, LoadingSpinner } from '@immich/ui';
  import { mdiDownload } from '@mdi/js';
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

  onMount(() => {
    void refresh();
    // the gallery is live — keep it fresh while processing continues
    pollTimer = setInterval(() => void refresh(), 30_000);
  });
  onDestroy(() => pollTimer && clearInterval(pollTimer));
</script>

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
      {#if gallery.assets.length > 0}
        <div class="mt-3">
          <Button size="small" variant="outline" leadingIcon={mdiDownload} href={api.public.galleryDownloadAllUrl(token)}>
            Download all
          </Button>
        </div>
      {/if}
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
  <PhotoViewer
    assets={gallery.assets}
    index={viewerIndex}
    downloadUrl={(assetId) => api.public.galleryDownloadUrl(token, assetId)}
    onClose={() => (viewerIndex = -1)}
    onIndexChange={(index) => (viewerIndex = index)}
  />
{/if}
