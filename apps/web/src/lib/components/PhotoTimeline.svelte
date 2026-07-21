<script lang="ts">
  // Google-Photos/Immich-style timeline: day-grouped justified rows, aspect
  // ratios preserved, thumbhash placeholders cross-fading into real
  // thumbnails. Selection behaviour is ported from Immich's own
  // Thumbnail.svelte + Month.svelte (immich/web/src/lib/components/assets/
  // thumbnail/Thumbnail.svelte, .../timeline/Month.svelte):
  //   - hovering a tile reveals a checkbox in its top-left corner; clicking it
  //     starts a selection without opening the photo.
  //   - once anything is selected, clicking any *other* unselected tile adds
  //     it to the selection instead of opening the viewer; clicking an
  //     already-selected tile removes it.
  //   - shift-click extends the selection from the last-clicked tile through
  //     the clicked one.
  //   - each day header gets its own select-all circle, revealed on hover of
  //     that day's row and left solid once the whole day is selected.
  //   - while selecting, a small magnifier on hover still opens the photo
  //     without toggling it.
  import { justifiedLayout, type TimelineAsset } from '$lib/justified';
  import { Icon, LoadingSpinner } from '@immich/ui';
  import { mdiCheckCircle, mdiCircleOutline, mdiMagnifyPlusOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { thumbHashToDataURL } from 'thumbhash';

  interface Props {
    assets: TimelineAsset[];
    onOpen: (index: number) => void;
    onImageError?: () => void;
    targetRowHeight?: number;
    /** Bindable — the caller reads `.size` for its own selection toolbar. */
    selected?: Set<string>;
    /** Forces selection UI on even with nothing selected yet (a "Select"
     * button entry point for touch devices, which have no hover). */
    selectMode?: boolean;
    /** Hides every selection affordance — pure browse, e.g. a guest without
     * download permission on the public gallery. */
    readonly?: boolean;
  }

  let {
    assets,
    onOpen,
    onImageError,
    targetRowHeight = 235,
    selected = $bindable(new Set()),
    selectMode = false,
    readonly = false,
  }: Props = $props();

  const selectionActive = $derived(!readonly && (selectMode || selected.size > 0));

  let containerWidth = $state(0);
  const GAP = 2;

  // group by calendar day of capturedAt (createdAt fallback); undated last.
  // Each group also carries its month, which the Scrubber reads off the DOM
  // (data-month / data-month-title) to build its segments.
  const groups = $derived.by(() => {
    const byDay = new Map<
      string,
      { label: string; monthKey: string; monthTitle: string; items: { asset: TimelineAsset; index: number }[] }
    >();
    for (const [index, asset] of assets.entries()) {
      const iso = asset.capturedAt ?? asset.createdAt ?? null;
      const day = iso ? DateTime.fromISO(iso) : null;
      const key = day ? day.toISODate()! : 'undated';
      const label = day
        ? day.toLocaleString({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
        : 'Recently added';
      const monthKey = day ? day.toFormat('yyyy-MM') : 'undated';
      const monthTitle = day ? day.toLocaleString({ month: 'long', year: 'numeric' }) : 'Recently added';
      if (!byDay.has(key)) {
        byDay.set(key, { label, monthKey, monthTitle, items: [] });
      }
      byDay.get(key)!.items.push({ asset, index });
    }
    return [...byDay.values()].map((group) => ({ ...group, key: group.label }));
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

  // --- selection ------------------------------------------------------------
  let hoveredId = $state<string | null>(null);
  let lastClickedIndex = $state<number | null>(null);

  function toggle(assetId: string) {
    const next = new Set(selected);
    if (next.has(assetId)) {
      next.delete(assetId);
    } else {
      next.add(assetId);
    }
    selected = next;
  }

  function rangeSelect(fromIndex: number, toIndex: number) {
    const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
    const next = new Set(selected);
    for (let i = start; i <= end; i++) {
      const asset = assets[i];
      if (asset) {
        next.add(asset.id);
      }
    }
    selected = next;
  }

  function onTileClick(asset: TimelineAsset, index: number, event: MouseEvent) {
    if (readonly) {
      onOpen(index);
      return;
    }
    if (event.shiftKey && lastClickedIndex !== null) {
      rangeSelect(lastClickedIndex, index);
      lastClickedIndex = index;
      return;
    }
    if (selected.has(asset.id)) {
      toggle(asset.id);
      lastClickedIndex = index;
      return;
    }
    if (selectionActive) {
      toggle(asset.id);
      lastClickedIndex = index;
      return;
    }
    onOpen(index);
  }

  function onCheckboxClick(asset: TimelineAsset, index: number, event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    toggle(asset.id);
    lastClickedIndex = index;
  }

  // Day-select: fills in whatever is missing, or clears the whole day if it
  // was already fully selected — same toggle semantics as Immich's Month.svelte.
  function toggleDay(items: { asset: TimelineAsset; index: number }[]) {
    const allSelected = items.every(({ asset }) => selected.has(asset.id));
    const next = new Set(selected);
    for (const { asset } of items) {
      if (allSelected) {
        next.delete(asset.id);
      } else {
        next.add(asset.id);
      }
    }
    selected = next;
  }

  let hoveredDay = $state<string | null>(null);
</script>

<div bind:clientWidth={containerWidth} class="w-full">
  {#if containerWidth > 0}
    {#each groups as group, groupIndex (group.key)}
      {@const daySelected = group.items.every(({ asset }) => selected.has(asset.id))}
      <section data-day-group data-month={group.monthKey} data-month-title={group.monthTitle} data-count={group.items.length}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex h-6 items-center gap-1 pb-3 text-sm font-medium text-immich-fg/90 dark:text-immich-dark-fg {groupIndex ===
        0
          ? 'pt-0'
          : 'pt-5'}"
        onmouseenter={() => (hoveredDay = group.key)}
        onmouseleave={() => (hoveredDay = null)}
      >
        {#if selectionActive}
          <button
            type="button"
            aria-label={daySelected ? 'Deselect day' : 'Select day'}
            onclick={() => toggleDay(group.items)}
            class="w-0 overflow-hidden transition-all duration-200 ease-out
              {hoveredDay === group.key || daySelected ? 'w-6' : ''}"
          >
            {#if daySelected}
              <Icon icon={mdiCheckCircle} size="1.35rem" class="text-immich-primary" />
            {:else}
              <Icon icon={mdiCircleOutline} size="1.35rem" class="text-gray-400" />
            {/if}
          </button>
        {/if}
        <span>{group.label}</span>
      </div>

      <div class="relative" style="height: {layouts[groupIndex]?.containerHeight ?? 0}px">
        {#each group.items as { asset, index }, itemIndex (asset.id)}
          {@const box = layouts[groupIndex]?.boxes[itemIndex]}
          {#if box}
            {@const isSelected = selected.has(asset.id)}
            {@const isHovered = hoveredId === asset.id}
            <div
              class="group absolute overflow-hidden transition-transform
                {isSelected ? 'scale-[0.85] rounded-xl bg-immich-primary/10' : ''}"
              style="top: {box.top}px; left: {box.left}px; width: {box.width}px; height: {box.height}px;"
              onmouseenter={() => (hoveredId = asset.id)}
              onmouseleave={() => (hoveredId = null)}
              role="none"
            >
              <button
                type="button"
                data-asset-index={index}
                class="absolute inset-0 focus:outline-2 focus:-outline-offset-2 focus:outline-immich-primary
                  {isSelected ? 'rounded-xl' : ''}"
                style={placeholder(asset) ? `background-image: url('${placeholder(asset)}'); background-size: cover;` : ''}
                onclick={(event) => onTileClick(asset, index, event)}
              >
                {#if asset.thumbUrl}
                  <img
                    src={asset.thumbUrl}
                    alt=""
                    loading="lazy"
                    class="h-full w-full object-cover {isSelected ? 'rounded-xl' : ''}"
                    onerror={onImageError}
                  />
                {:else}
                  <div class="flex h-full w-full items-center justify-center text-gray-400">
                    <LoadingSpinner size="small" />
                  </div>
                {/if}

                <!-- Immich hover treatment: top-to-bottom gradient -->
                <div
                  class="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/25 to-transparent opacity-0 transition-opacity group-hover:opacity-100 {isSelected
                    ? 'rounded-t-xl'
                    : ''}"
                ></div>
              </button>

              <!-- selection checkbox: top-left, revealed on hover, sticky once selected -->
              {#if !readonly && (isHovered || isSelected || selectionActive)}
                <button
                  type="button"
                  aria-label={isSelected ? 'Deselect photo' : 'Select photo'}
                  aria-checked={isSelected}
                  role="checkbox"
                  onclick={(event) => onCheckboxClick(asset, index, event)}
                  class="absolute start-1 top-1 z-10 rounded-full p-0.5"
                >
                  {#if isSelected}
                    <div class="rounded-full bg-white dark:bg-neutral-800">
                      <Icon icon={mdiCheckCircle} size="1.35rem" class="text-immich-primary" />
                    </div>
                  {:else}
                    <Icon icon={mdiCheckCircle} size="1.35rem" class="text-white/80 drop-shadow hover:text-white" />
                  {/if}
                </button>
              {/if}

              <!-- peek at the photo without toggling selection -->
              {#if selectionActive && !isSelected && isHovered}
                <button
                  type="button"
                  aria-label="Preview photo"
                  onclick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onOpen(index);
                  }}
                  class="absolute end-1 bottom-1 z-10 rounded-full bg-black/40 p-1.5 text-white transition hover:bg-black/60"
                >
                  <Icon icon={mdiMagnifyPlusOutline} size="1.1rem" />
                </button>
              {/if}

              {#if asset.status && asset.status !== 'processed'}
                <span
                  class="absolute bottom-1.5 start-1.5 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white"
                >
                  {asset.status === 'failed' ? 'failed' : 'processing…'}
                </span>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
      </section>
    {/each}
  {/if}
</div>
