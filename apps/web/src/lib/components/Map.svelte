<script lang="ts">
  // Org-wide Map, adapted from Immich's shared Map.svelte
  // (immich/web/src/lib/components/shared-components/map/Map.svelte): a
  // MapLibre canvas with clustered GeoJSON markers, one per geotagged photo.
  //
  // Trimmed for what this app actually needs: no per-user settings modal, no
  // partner/album filters, and no pmtiles/RTL plugin (the tile style used here
  // is a plain vector style, not a self-hosted pmtiles archive). Style source
  // is OpenFreeMap (free, no key, no usage cap) rather than Immich's own
  // tiles.immich.cloud, which is infrastructure they run for their own app.
  import { goto } from '$app/navigation';
  import { themeStore } from '$lib/theme.svelte';
  import { Icon, IconButton } from '@immich/ui';
  import type { Feature, Point } from 'geojson';
  import { GlobeControl, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
  import {
    AttributionControl,
    GeoJSON,
    GeolocateControl,
    MapLibre,
    MarkerLayer,
    NavigationControl,
    ScaleControl,
    type LngLatBoundsLike,
  } from 'svelte-maplibre';
  import { mdiClose, mdiImageOff } from '@mdi/js';

  interface MarkerPoint {
    id: string;
    eventId: string;
    lat: number;
    lon: number;
    thumbUrl: string | null;
  }

  interface Props {
    markers: MarkerPoint[];
  }

  let { markers }: Props = $props();

  // OpenFreeMap's "liberty" style — free vector tiles, no API key, no request
  // cap. There is no separate dark variant; dark/OLED themes invert just the
  // map canvas (not the marker layer) via CSS below, the common trick for
  // giving a light-only vector style a passable dark mode.
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  const isDark = $derived(themeStore.value !== 'light');

  let map: MapLibreMap | undefined = $state();

  const bounds: LngLatBoundsLike | undefined = (() => {
    if (markers.length === 0) {
      return undefined;
    }
    let west = markers[0].lon;
    let east = markers[0].lon;
    let south = markers[0].lat;
    let north = markers[0].lat;
    for (const marker of markers) {
      west = Math.min(west, marker.lon);
      east = Math.max(east, marker.lon);
      south = Math.min(south, marker.lat);
      north = Math.max(north, marker.lat);
    }
    return [
      [west, south],
      [east, north],
    ];
  })();

  type MarkerFeature = Feature<Point, { id: string; eventId: string }>;

  const features = $derived<MarkerFeature[]>(
    markers.map((marker) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [marker.lon, marker.lat] },
      properties: { id: marker.id, eventId: marker.eventId },
    })),
  );

  const thumbById = $derived(new Map(markers.map((marker) => [marker.id, marker.thumbUrl])));

  // Clicking a cluster opens a panel listing that cluster's photos (Immich's
  // MapTimelinePanel). Tight clusters at low zoom would collapse into a single
  // pin if we panelled every click, so a still-splittable cluster zooms in
  // first and only opens the panel once it can't be split further.
  interface PanelItem {
    id: string;
    eventId: string;
    thumbUrl: string | null;
  }
  let panelItems = $state<PanelItem[]>([]);
  let panelOpen = $state(false);

  async function handleClusterClick(clusterId: number, coordinates: [number, number]) {
    if (!map) {
      return;
    }
    const source = map.getSource('markers') as GeoJSONSource;
    const currentZoom = map.getZoom();
    const expansionZoom = await source.getClusterExpansionZoom(clusterId);

    // Still room to spread the cluster out on the map — zoom instead of listing.
    if (expansionZoom > currentZoom && expansionZoom <= 18) {
      map.easeTo({ center: coordinates, zoom: expansionZoom });
      return;
    }

    const leaves = await source.getClusterLeaves(clusterId, 10_000, 0);
    panelItems = leaves.map((leaf) => {
      const id = leaf.properties?.id as string;
      return { id, eventId: leaf.properties?.eventId as string, thumbUrl: thumbById.get(id) ?? null };
    });
    panelOpen = true;
  }

  function openAsset(eventId: string, assetId: string) {
    void goto(`/events/${eventId}?asset=${assetId}`);
  }
</script>

<div class="relative h-full w-full overflow-hidden rounded-2xl {isDark ? 'dark-basemap' : ''}">
  <MapLibre
    style={STYLE_URL}
    class="h-full w-full"
    {bounds}
    fitBoundsOptions={{ padding: 50, maxZoom: 15 }}
    attributionControl={false}
    onload={(loaded) => loaded.addControl(new GlobeControl(), 'top-left')}
    bind:map
  >
    {#snippet children()}
      <NavigationControl position="top-left" />
      <GeolocateControl position="top-left" />
      <ScaleControl />
      <AttributionControl compact={false} />

      <GeoJSON id="markers" data={{ type: 'FeatureCollection', features }} cluster={{ radius: 50, maxZoom: 18 }}>
        <MarkerLayer
          applyToClusters
          asButton
          onclick={(event) =>
            void handleClusterClick(
              event.feature.properties?.cluster_id,
              (event.feature.geometry as Point).coordinates as [number, number],
            )}
        >
          {#snippet children({ feature })}
            <div
              class="flex size-10 items-center justify-center rounded-full bg-immich-primary text-sm font-bold text-immich-bg shadow-lg transition hover:scale-110"
            >
              {feature.properties?.point_count?.toLocaleString()}
            </div>
          {/snippet}
        </MarkerLayer>

        <MarkerLayer
          applyToClusters={false}
          asButton
          onclick={(event) => openAsset(event.feature.properties?.eventId, event.feature.properties?.id)}
        >
          {#snippet children({ feature })}
            {@const thumbUrl = thumbById.get(feature.properties?.id)}
            <div
              class="size-11 overflow-hidden rounded-full border-2 border-immich-primary bg-subtle shadow-lg transition hover:scale-125"
            >
              {#if thumbUrl}
                <img src={thumbUrl} alt="" class="h-full w-full object-cover" loading="lazy" />
              {:else}
                <div class="flex h-full w-full items-center justify-center text-gray-400">
                  <Icon icon={mdiImageOff} size="1.1rem" />
                </div>
              {/if}
            </div>
          {/snippet}
        </MarkerLayer>
      </GeoJSON>
    {/snippet}
  </MapLibre>

  <!-- Cluster panel (Immich's MapTimelinePanel): the photos under a cluster
       that can't be split further, as a justified thumbnail grid. -->
  {#if panelOpen}
    <aside
      class="absolute inset-x-0 bottom-0 z-10 max-h-[55%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-immich-bg p-3 shadow-2xl
        sm:inset-y-0 sm:end-0 sm:start-auto sm:w-80 sm:max-h-none sm:rounded-t-none sm:rounded-s-2xl sm:border-s sm:border-t-0"
    >
      <div class="mb-2 flex items-center justify-between">
        <p class="text-sm font-semibold">
          {panelItems.length} photo{panelItems.length === 1 ? '' : 's'}
        </p>
        <IconButton
          icon={mdiClose}
          aria-label="Close"
          shape="round"
          variant="ghost"
          color="secondary"
          size="small"
          onclick={() => (panelOpen = false)}
        />
      </div>
      <div class="grid grid-cols-3 gap-1 sm:grid-cols-2">
        {#each panelItems as item (item.id)}
          <button
            type="button"
            onclick={() => openAsset(item.eventId, item.id)}
            class="aspect-square overflow-hidden rounded-md bg-subtle transition hover:opacity-90 focus:outline-2 focus:outline-immich-primary"
          >
            {#if item.thumbUrl}
              <img src={item.thumbUrl} alt="" loading="lazy" class="h-full w-full object-cover" />
            {:else}
              <div class="flex h-full w-full items-center justify-center text-gray-400">
                <Icon icon={mdiImageOff} size="1.25rem" />
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </aside>
  {/if}
</div>

<style>
  /* Inverting only the tile canvas (not the marker DOM layer above it) gives a
     passable dark map from a light-only vector style — markers keep their
     real colours. */
  .dark-basemap :global(.maplibregl-canvas) {
    filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9);
  }

  /* MapLibre ships its controls as a hard-coded white button group, so on the
     dark and OLED themes a bright white cluster sat on top of the dark UI.
     The glyphs are background-image SVGs rather than currentColor, so they
     take the same invert treatment as the basemap instead of a colour. */
  .dark-basemap :global(.maplibregl-ctrl-group) {
    background-color: var(--color-gray-100);
  }

  .dark-basemap :global(.maplibregl-ctrl-group button + button) {
    border-top-color: var(--color-gray-300);
  }

  .dark-basemap :global(.maplibregl-ctrl-group button:hover) {
    background-color: var(--color-gray-200);
  }

  .dark-basemap :global(.maplibregl-ctrl-icon) {
    filter: invert(1);
  }

  /* Scale bar and attribution are plain text/borders, so they follow the
     theme tokens directly. */
  .dark-basemap :global(.maplibregl-ctrl-scale) {
    background-color: color-mix(in srgb, var(--color-gray-100) 70%, transparent);
    border-color: var(--color-gray-400);
    color: rgb(var(--immich-fg));
  }

  .dark-basemap :global(.maplibregl-ctrl-attrib) {
    background-color: color-mix(in srgb, var(--color-gray-100) 70%, transparent);
  }

  .dark-basemap :global(.maplibregl-ctrl-attrib a) {
    color: rgb(var(--immich-fg));
  }
</style>
