<script lang="ts">
  // "View similar photos" results — Immich's view-similar, as a similarity-
  // ranked grid (newest-first date grouping is deliberately NOT used here: the
  // order IS the ranking, most-similar first). Clicking opens the viewer over
  // the ranked set.
  import { goto } from '$app/navigation';
  import { api, uploadAsset, type AssetItem } from '$lib/api';
  import PhotoViewer from '$lib/components/PhotoViewer.svelte';
  import { Heading, Icon, IconButton, LoadingSpinner } from '@immich/ui';
  import { mdiArrowLeft, mdiImageSearchOutline } from '@mdi/js';
  import { thumbHashToDataURL } from 'thumbhash';

  let { data } = $props();
  const eventId = $derived(data.event.id);
  const sourceId = $derived(data.assetId);
  const canManage = $derived(
    data.me.isSuperAdmin ||
      ['owner', 'admin'].includes(data.me.organizations.find((org) => org.id === data.event.orgId)?.role ?? ''),
  );

  let results = $state<AssetItem[]>([]);
  let loading = $state(true);
  let viewerIndex = $state(-1);

  // Reload whenever the source asset changes (chaining "view similar" from
  // within the viewer keeps this component mounted).
  $effect(() => {
    const id = sourceId;
    loading = true;
    results = [];
    viewerIndex = -1;
    api.assets
      .similar(eventId, id)
      .then((rows) => (results = rows))
      .finally(() => (loading = false));
  });

  function placeholder(asset: AssetItem): string | null {
    if (!asset.thumbhash) {
      return null;
    }
    try {
      return thumbHashToDataURL(Uint8Array.from(atob(asset.thumbhash), (c) => c.charCodeAt(0)));
    } catch {
      return null;
    }
  }
</script>

<svelte:head><title>Similar photos — {data.event.name}</title></svelte:head>

<div class="mb-5 flex items-center gap-3">
  <IconButton
    icon={mdiArrowLeft}
    aria-label="Back"
    variant="ghost"
    color="secondary"
    onclick={() => goto(`/events/${eventId}`)}
  />
  <div>
    <Heading size="large">Similar photos</Heading>
    <p class="text-sm text-gray-500">Ranked by visual similarity</p>
  </div>
</div>

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else if results.length === 0}
  <div class="md-surface p-10 text-center">
    <Icon icon={mdiImageSearchOutline} size="2.5rem" class="mx-auto mb-3 text-gray-300" />
    <p class="md-title-medium mb-1">No similar photos found</p>
    <p class="md-body-medium text-gray-500">
      Similar search compares each photo's visual fingerprint. If this photo was just uploaded, its fingerprint may still
      be processing — check back shortly.
    </p>
  </div>
{:else}
  <div class="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
    {#each results as asset, index (asset.id)}
      <button
        type="button"
        onclick={() => (viewerIndex = index)}
        class="group relative aspect-square overflow-hidden rounded-md bg-subtle focus:outline-2 focus:outline-immich-primary"
        style={placeholder(asset) ? `background-image: url('${placeholder(asset)}'); background-size: cover;` : ''}
      >
        {#if asset.thumbUrl}
          <img src={asset.thumbUrl} alt="" loading="lazy" class="h-full w-full object-cover" />
        {/if}
        <div
          class="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/25 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
        ></div>
      </button>
    {/each}
  </div>
{/if}

{#if viewerIndex >= 0 && results[viewerIndex]}
  <PhotoViewer
    assets={results}
    index={viewerIndex}
    downloadUrl={(assetId) => api.assets.downloadUrl(eventId, assetId)}
    loadDetail={(assetId) => api.assets.get(eventId, assetId)}
    onOpenPerson={(personId) => goto(`/events/${eventId}/people/${personId}`)}
    canDelete={canManage}
    canEdit={canManage}
    imageProxyUrl={(assetId) => api.assets.imageUrl(eventId, assetId)}
    onEditSave={async (file) => {
      await uploadAsset(eventId, file, () => {});
    }}
    onRefreshFaces={canManage ? (assetId) => api.assets.runJob(eventId, assetId, 'faceDetection', true) : undefined}
    onViewInTimeline={(assetId) => goto(`/events/${eventId}?asset=${assetId}`)}
    onViewSimilar={(assetId) => goto(`/events/${eventId}/similar/${assetId}`)}
    onClose={() => (viewerIndex = -1)}
    onIndexChange={(index) => (viewerIndex = index)}
  />
{/if}
