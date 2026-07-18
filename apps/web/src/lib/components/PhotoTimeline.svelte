<script lang="ts">
  // Google-Photos-style timeline (the Immich look, docs/plan/10 §3):
  // day-grouped justified rows, aspect ratios preserved, thumbhash
  // placeholders that cross-fade into the real thumbnail.
  import { justifiedLayout, type TimelineAsset } from '$lib/justified';
  import { LoadingSpinner } from '@immich/ui';
  import { DateTime } from 'luxon';
  import { thumbHashToDataURL } from 'thumbhash';

  interface Props {
    assets: TimelineAsset[];
    onOpen: (index: number) => void;
    onImageError?: () => void;
    targetRowHeight?: number;
  }

  let { assets, onOpen, onImageError, targetRowHeight = 235 }: Props = $props();

  let containerWidth = $state(0);
  const GAP = 2;

  // group by calendar day of capturedAt (createdAt fallback); undated last
  const groups = $derived.by(() => {
    const byDay = new Map<string, { label: string; items: { asset: TimelineAsset; index: number }[] }>();
    for (const [index, asset] of assets.entries()) {
      const iso = asset.capturedAt ?? asset.createdAt ?? null;
      const day = iso ? DateTime.fromISO(iso) : null;
      const key = day ? day.toISODate()! : 'undated';
      const label = day
        ? day.toLocaleString({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
        : 'Recently added';
      if (!byDay.has(key)) {
        byDay.set(key, { label, items: [] });
      }
      byDay.get(key)!.items.push({ asset, index });
    }
    return [...byDay.values()];
  });

  const layouts = $derived.by(() => {
    if (containerWidth <= 0) {
      return [];
    }
    return groups.map((group) => {
      const ratios = group.items.map(({ asset }) =>
        asset.width && asset.height ? Math.max(0.4, Math.min(asset.width / asset.height, 3)) : 1,
      );
      return justifiedLayout(ratios, { containerWidth, targetRowHeight, gap: GAP });
    });
  });

  const placeholders = new Map<string, string>();
  function placeholder(asset: TimelineAsset): string | null {
    if (!asset.thumbhash) {
      return null;
    }
    let url = placeholders.get(asset.id);
    if (!url) {
      try {
        url = thumbHashToDataURL(Uint8Array.from(atob(asset.thumbhash), (char) => char.charCodeAt(0)));
        placeholders.set(asset.id, url);
      } catch {
        return null;
      }
    }
    return url;
  }
</script>

<div bind:clientWidth={containerWidth} class="w-full">
  {#if containerWidth > 0}
    {#each groups as group, groupIndex (group.label)}
      <h2 class="pt-5 pb-3 text-sm font-medium text-immich-fg/90 first:pt-0 dark:text-immich-dark-fg">
        {group.label}
      </h2>
      <div class="relative" style="height: {layouts[groupIndex]?.containerHeight ?? 0}px">
        {#each group.items as { asset, index }, itemIndex (asset.id)}
          {@const box = layouts[groupIndex]?.boxes[itemIndex]}
          {#if box}
            <button
              class="group absolute overflow-hidden bg-gray-100 focus:z-10 focus:outline-2 focus:outline-immich-primary"
              style="top: {box.top}px; left: {box.left}px; width: {box.width}px; height: {box.height}px;
                {placeholder(asset) ? `background-image: url('${placeholder(asset)}'); background-size: cover;` : ''}"
              onclick={() => onOpen(index)}
            >
              {#if asset.thumbUrl}
                <img
                  src={asset.thumbUrl}
                  alt=""
                  loading="lazy"
                  class="h-full w-full object-cover"
                  onerror={onImageError}
                />
              {:else}
                <div class="flex h-full w-full items-center justify-center text-gray-400">
                  <LoadingSpinner size="small" />
                </div>
              {/if}
              <!-- Immich hover treatment: top gradient, no zoom -->
              <div
                class="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/25 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
              ></div>
              {#if asset.status && asset.status !== 'processed'}
                <span
                  class="absolute bottom-1.5 start-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white"
                >
                  {asset.status === 'failed' ? 'failed' : 'processing…'}
                </span>
              {/if}
            </button>
          {/if}
        {/each}
      </div>
    {/each}
  {/if}
</div>
