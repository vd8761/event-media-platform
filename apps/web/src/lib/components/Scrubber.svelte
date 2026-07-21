<script lang="ts">
  // Timeline date scrubber — a faithful port of Immich's Scrubber.svelte
  // (immich/web/src/lib/components/timeline/Scrubber.svelte): the same 60px
  // desktop rail with font-mono year labels + dots, the same hover/drag date
  // tooltip, the same scroll-position indicator line, and the same 20px mobile
  // pill that only appears while scrolling — markup, classes and responsiveness
  // copied verbatim.
  //
  // Immich drives it from a virtualising TimelineManager; this app's timeline
  // scrolls the window and renders every asset, so instead of that manager the
  // month segments are measured off the rendered DOM (the day-groups
  // PhotoTimeline tags with data-month / data-month-title) and scroll is the
  // document's own. The mapping maths and the segment label/dot picking are
  // otherwise Immich's.
  import { Icon } from '@immich/ui';
  import { mdiPlay } from '@mdi/js';
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  interface Props {
    /** The timeline root whose day-groups are measured for month geometry. */
    timelineElement: HTMLElement | null;
    /** Sticky-header height to offset scroll targets by (top bar = 64px). */
    topOffset?: number;
    /** Bump to force a re-measure after content changes (e.g. assets.length). */
    revision?: number;
  }

  let { timelineElement, topOffset = 64, revision = 0 }: Props = $props();

  // --- sizing constants, copied from Immich ---
  const MOBILE_WIDTH = 20;
  const DESKTOP_WIDTH = 60;
  const HOVER_DATE_HEIGHT = 31.75;
  const MIN_YEAR_LABEL_DISTANCE = 16;
  const MIN_DOT_DISTANCE = 8;

  let usingMobileDevice = $state(false);
  const PADDING_TOP = $derived(usingMobileDevice ? 25 : HOVER_DATE_HEIGHT);
  const PADDING_BOTTOM = $derived(usingMobileDevice ? 25 : 10);

  let railHeight = $state(0);
  let isHover = $state(false);
  let isDragging = $state(false);
  let hoverY = $state(0);
  let scrolling = $state(false);
  let scrollY = $state(0);
  let scrollBar: HTMLElement | undefined = $state();

  const usable = $derived(Math.max(0, railHeight - (PADDING_TOP + PADDING_BOTTOM)));
  const toScrollY = (percent: number) => percent * usable;
  const toTimelineY = (px: number) => (usable > 0 ? px / usable : 0);

  const width = $derived.by(() => {
    if (isDragging) {
      return '100vw';
    }
    if (usingMobileDevice) {
      return scrolling ? MOBILE_WIDTH + 'px' : '0px';
    }
    return DESKTOP_WIDTH + 'px';
  });

  // --- measured month geometry --------------------------------------------
  interface MonthGeo {
    year: number;
    month: number;
    title: string;
    top: number; // px offset within the timeline
    height: number; // px height within the timeline
    count: number;
  }
  let timelineTop = $state(0); // document coords
  let timelineHeight = $state(0);
  let months = $state<MonthGeo[]>([]);

  function measure() {
    const root = timelineElement;
    if (!root) {
      months = [];
      timelineHeight = 0;
      return;
    }
    const rootRect = root.getBoundingClientRect();
    timelineTop = rootRect.top + window.scrollY;
    timelineHeight = root.offsetHeight;

    const sections = [...root.querySelectorAll<HTMLElement>('section[data-day-group]')];
    const byMonth = new Map<string, MonthGeo>();
    const order: string[] = [];
    for (const section of sections) {
      const key = section.dataset.month ?? 'undated';
      const rect = section.getBoundingClientRect();
      const top = rect.top + window.scrollY - timelineTop;
      const height = section.offsetHeight;
      const count = Number(section.dataset.count ?? '0');
      const existing = byMonth.get(key);
      if (existing) {
        existing.height = top + height - existing.top;
        existing.count += count;
      } else {
        const [year, month] = key === 'undated' ? [0, 0] : key.split('-').map(Number);
        byMonth.set(key, {
          year,
          month,
          title: section.dataset.monthTitle ?? '',
          top,
          height,
          count,
        });
        order.push(key);
      }
    }
    months = order.map((key) => byMonth.get(key)!);
  }

  // --- segment labels/dots (Immich calculateSegments) ---------------------
  interface Segment extends MonthGeo {
    railHeight: number;
    hasLabel: boolean;
    hasDot: boolean;
  }

  const segments = $derived.by<Segment[]>(() => {
    if (timelineHeight <= 0 || usable <= 0) {
      return [];
    }
    let verticalSpanWithoutLabel = 0;
    let verticalSpanWithoutDot = 0;
    let previousLabeled: Segment | undefined;
    const out: Segment[] = [];

    // Process newest-last (Immich reverses, picks, reverses back).
    const reversed = [...months].reverse();
    for (const m of reversed) {
      const seg: Segment = {
        ...m,
        railHeight: toScrollY(m.height / timelineHeight),
        hasLabel: false,
        hasDot: false,
      };
      if (previousLabeled) {
        if (previousLabeled.year !== seg.year && verticalSpanWithoutLabel > MIN_YEAR_LABEL_DISTANCE) {
          verticalSpanWithoutLabel = 0;
          seg.hasLabel = true;
          previousLabeled = seg;
        }
        if (seg.railHeight > 5 && verticalSpanWithoutDot > MIN_DOT_DISTANCE) {
          seg.hasDot = true;
          verticalSpanWithoutDot = 0;
        }
      } else {
        seg.hasDot = true;
        seg.hasLabel = true;
        previousLabeled = seg;
      }
      verticalSpanWithoutLabel += seg.railHeight;
      verticalSpanWithoutDot += seg.railHeight;
      out.push(seg);
    }
    out.reverse();
    return out;
  });

  // --- current scroll position → rail Y ------------------------------------
  const contentScroll = $derived(
    Math.min(Math.max(scrollY + topOffset - timelineTop, 0), Math.max(0, timelineHeight)),
  );
  const scrollRailY = $derived(timelineHeight > 0 ? toScrollY(contentScroll / timelineHeight) : 0);

  function monthAtContentScroll(cs: number): MonthGeo | undefined {
    for (const m of months) {
      if (cs < m.top + m.height) {
        return m;
      }
    }
    return months.at(-1);
  }

  const scrollLabel = $derived(monthAtContentScroll(contentScroll)?.title ?? '');
  const hoverLabel = $derived.by(() => {
    const cs = toTimelineY(hoverY) * timelineHeight;
    return monthAtContentScroll(cs)?.title ?? '';
  });

  // --- interaction ---------------------------------------------------------
  function scrubToClientY(clientY: number) {
    if (!scrollBar || timelineHeight <= 0) {
      return;
    }
    const rect = scrollBar.getBoundingClientRect();
    hoverY = Math.min(Math.max(clientY - rect.top - PADDING_TOP, 0), usable);
    const cs = toTimelineY(hoverY) * timelineHeight;
    window.scrollTo({ top: timelineTop + cs - topOffset });
  }

  function onWindowMouseMove(event: MouseEvent) {
    if (!isDragging && !isHover) {
      return;
    }
    if (scrollBar) {
      const rect = scrollBar.getBoundingClientRect();
      hoverY = Math.min(Math.max(event.clientY - rect.top - PADDING_TOP, 0), usable);
    }
    if (isDragging) {
      scrubToClientY(event.clientY);
    }
  }

  function onWindowMouseDown(event: MouseEvent) {
    if (isHover) {
      isDragging = true;
      scrubToClientY(event.clientY);
    }
  }

  function onWindowMouseUp() {
    isDragging = false;
  }

  // Touch (mobile): dragging the rail scrubs.
  function onTouchStart(event: TouchEvent) {
    if (!scrollBar || event.touches.length !== 1) {
      return;
    }
    const touch = event.touches[0];
    const rect = scrollBar.getBoundingClientRect();
    if (touch.clientX < rect.left) {
      return; // touch began left of the rail — leave it to the page
    }
    isDragging = true;
    scrubToClientY(touch.clientY);
  }

  function onTouchMove(event: TouchEvent) {
    if (isDragging && event.touches.length === 1) {
      scrubToClientY(event.touches[0].clientY);
    }
  }

  function onTouchEnd() {
    isDragging = false;
  }

  // --- lifecycle: window scroll, resize, content growth --------------------
  let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined;
  function onScroll() {
    scrollY = window.scrollY;
    scrolling = true;
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => (scrolling = false), 1000);
  }

  onMount(() => {
    const mql = globalThis.matchMedia('(pointer: coarse)');
    usingMobileDevice = mql.matches;
    const onMql = (event: MediaQueryListEvent) => (usingMobileDevice = event.matches);
    mql.addEventListener('change', onMql);

    scrollY = window.scrollY;
    void tick().then(measure);

    const onResize = () => measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    let observer: ResizeObserver | undefined;
    if (timelineElement) {
      observer = new ResizeObserver(() => measure());
      observer.observe(timelineElement);
    }

    return () => {
      mql.removeEventListener('change', onMql);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      observer?.disconnect();
      clearTimeout(scrollIdleTimer);
    };
  });

  // Re-measure when the caller signals a content change.
  $effect(() => {
    void revision;
    void railHeight;
    void tick().then(measure);
  });
</script>

<svelte:window
  onmousemove={onWindowMouseMove}
  onmousedown={onWindowMouseDown}
  onmouseup={onWindowMouseUp}
/>

<div
  bind:this={scrollBar}
  bind:clientHeight={railHeight}
  transition:fly={{ x: 50, duration: 250 }}
  role="scrollbar"
  aria-controls="time-label"
  aria-valuetext={hoverLabel}
  aria-valuenow={scrollRailY + PADDING_TOP}
  aria-valuemax={toScrollY(1)}
  aria-valuemin={0}
  tabindex="0"
  data-id="scrubber"
  class="fixed end-0 z-30 select-none hover:cursor-row-resize"
  style:top="{topOffset}px"
  style:height="calc(100vh - {topOffset}px)"
  style:width
  style:padding-top="{PADDING_TOP}px"
  style:padding-bottom="{PADDING_BOTTOM}px"
  onmouseenter={() => (isHover = true)}
  onmouseleave={() => (isHover = false)}
  draggable="false"
>
  <!-- desktop hover/drag date tooltip -->
  {#if !usingMobileDevice && hoverLabel && (isHover || isDragging)}
    <div
      id="time-label"
      class={[
        { 'border-b-2': isDragging },
        { 'rounded-bl-md': !isDragging },
        'pointer-events-none absolute end-0 z-1 w-fit max-w-64 min-w-20 truncate rounded-ss-md border-b-2 border-primary bg-light p-1 text-sm font-medium opacity-85 shadow-[0_0_8px_rgba(0,0,0,0.25)]',
      ]}
      style:top="{hoverY + 2}px"
    >
      {hoverLabel}
    </div>
  {/if}

  <!-- mobile pill -->
  {#if usingMobileDevice && ((scrolling && scrollLabel) || isHover || isDragging)}
    <div
      id="time-label"
      class="w-8 rounded-s-full bg-immich-primary ps-2 text-immich-bg select-none hover:cursor-pointer"
      style:top="{PADDING_TOP + (scrollRailY - 50 / 2)}px"
      style:height="50px"
      style:right="0"
      style:position="absolute"
      in:fade={{ duration: 200 }}
      out:fade={{ duration: 200 }}
    >
      <Icon icon={mdiPlay} size="20" class="relative -inset-e-0.5 top-2.25 -rotate-90" />
      <Icon icon={mdiPlay} size="20" class="relative -inset-e-0.5 top-px rotate-90" />
      {#if (scrolling && scrollLabel) || isHover || isDragging}
        <p
          transition:fade={{ duration: 200 }}
          style:bottom="{50 / 2 - 30 / 2}px"
          style:right="36px"
          style:width="fit-content"
          class="pointer-events-none absolute w-8 truncate rounded-full bg-immich-primary/90 px-4 py-2 text-sm font-semibold text-immich-bg select-none hover:cursor-pointer"
        >
          {scrollLabel}
        </p>
      {/if}
    </div>
  {/if}

  <!-- desktop scroll-position indicator line -->
  {#if !usingMobileDevice && !isDragging}
    <div class="absolute end-0 h-0.5 w-10 bg-primary" style:top="{scrollRailY + PADDING_TOP - 2}px">
      {#if scrolling && scrollLabel && !isHover}
        <p
          transition:fade={{ duration: 200 }}
          class="pointer-events-none absolute end-0 bottom-0 z-1 w-fit max-w-64 min-w-20 truncate rounded-tl-md border-b-2 border-primary bg-subtle/90 p-1 text-sm font-medium shadow-[0_0_8px_rgba(0,0,0,0.25)] dark:text-immich-dark-fg"
        >
          {scrollLabel}
        </p>
      {/if}
    </div>
  {/if}

  <!-- segments: year labels + dots, sized proportionally to each month -->
  {#each segments as segment (segment.year + '-' + segment.month)}
    <div class="relative" style:height="{segment.railHeight}px">
      {#if !usingMobileDevice}
        {#if segment.hasLabel}
          <div class="absolute end-5 bottom-0 font-mono text-[13px] dark:text-immich-dark-fg">
            {segment.year}
          </div>
        {/if}
        {#if segment.hasDot}
          <div class="absolute end-3 bottom-0 size-1 rounded-full bg-gray-300"></div>
        {/if}
      {/if}
    </div>
  {/each}
</div>
