<script lang="ts">
  // Org-wide Map: every geotagged photo across the organization's live events,
  // clustered on a MapLibre canvas (Immich's Map route, adapted — see
  // $lib/components/Map.svelte for what changed and why).
  import { api, type MapMarker } from '$lib/api';
  import MapComponent from '$lib/components/Map.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { shellStore } from '$lib/shell.svelte';
  import { Heading, LoadingSpinner } from '@immich/ui';
  import { mdiMapMarkerOffOutline } from '@mdi/js';

  let markers = $state<MapMarker[]>([]);
  let loading = $state(true);

  let started = $state(false);
  $effect(() => {
    const orgId = shellStore.orgId;
    if (orgId && !started) {
      started = true;
      api.orgs
        .mapMarkers(orgId)
        .then((rows) => (markers = rows))
        .finally(() => (loading = false));
    }
  });
</script>

<svelte:head><title>Map — EventLens</title></svelte:head>

<!-- Cancels the page shell's padding so the map fills the viewport below the
     top bar, the way Immich's map route does. -->
<div class="-m-4 -my-5 h-[calc(100vh-4rem)] sm:-mx-6 lg:-mx-8 lg:-my-6">
  {#if loading}
    <div class="flex h-full items-center justify-center">
      <LoadingSpinner size="giant" />
    </div>
  {:else if markers.length === 0}
    <EmptyState
      fillHeight
      icon={mdiMapMarkerOffOutline}
      title="No locations yet"
      description="Photos with location data show up here as pins once your events are geotagged."
    />
  {:else}
    <MapComponent {markers} />
  {/if}
</div>
