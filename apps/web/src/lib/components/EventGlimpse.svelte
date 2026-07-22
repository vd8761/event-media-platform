<script lang="ts">
  // The "memories" strip Immich shows above the Photos timeline: a horizontally
  // scrollable row of tall rounded cover cards, one per event, with a dark
  // bottom gradient and the event name overlaid. Clicking a card opens that
  // event's auto-advancing Memories slideshow (see routes/(app)/memories).
  import { Icon } from '@immich/ui';
  import { mdiChevronLeft, mdiChevronRight, mdiImageAlbum } from '@mdi/js';
  import type { SidebarEvent } from '$lib/api';

  interface Props {
    events: SidebarEvent[];
    onOpen: (eventId: string) => void;
  }

  let { events, onOpen }: Props = $props();

  // A slideshow needs enough material to be worth starting. Below this an
  // event is a handful of photos the organiser has already seen — the strip
  // would be advertising a three-slide "memory". Events still appear
  // everywhere else; this only governs the memories rail.
  const MIN_ASSETS_FOR_MEMORIES = 5;
  const shown = $derived(events.filter((event) => event.assetCount > MIN_ASSETS_FOR_MEMORIES));

  let rail = $state<HTMLElement | null>(null);

  function scrollBy(direction: 1 | -1) {
    rail?.scrollBy({ left: direction * Math.max(rail.clientWidth * 0.8, 240), behavior: 'smooth' });
  }
</script>

{#if shown.length > 0}
  <section aria-label="Events" class="group/strip relative -mx-1">
    <!-- edge scroll buttons, revealed on hover (desktop only) -->
    <button
      type="button"
      aria-label="Scroll left"
      onclick={() => scrollBy(-1)}
      class="absolute start-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition group-hover/strip:opacity-100 hover:bg-black/60 md:block"
    >
      <Icon icon={mdiChevronLeft} size="1.5rem" />
    </button>
    <button
      type="button"
      aria-label="Scroll right"
      onclick={() => scrollBy(1)}
      class="absolute end-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition group-hover/strip:opacity-100 hover:bg-black/60 md:block"
    >
      <Icon icon={mdiChevronRight} size="1.5rem" />
    </button>

    <div
      bind:this={rail}
      class="flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {#each shown as event (event.id)}
        <button
          type="button"
          onclick={() => onOpen(event.id)}
          title="{event.name} — {event.assetCount} photo{event.assetCount === 1 ? '' : 's'}"
          class="group/card relative aspect-[3/4] w-28 shrink-0 snap-start overflow-hidden rounded-2xl bg-subtle transition sm:w-32 md:w-36
            focus:outline-2 focus:outline-immich-primary"
        >
          {#if event.coverUrl}
            <img
              src={event.coverUrl}
              alt=""
              loading="lazy"
              class="h-full w-full object-cover transition duration-500 group-hover/card:scale-105"
            />
          {:else}
            <div class="flex h-full w-full items-center justify-center text-gray-400">
              <Icon icon={mdiImageAlbum} size="2rem" />
            </div>
          {/if}
          <!-- bottom gradient + title, like Immich's memory cards -->
          <div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent p-2.5 pt-8 text-start">
            <span class="line-clamp-2 text-sm font-medium leading-tight text-white">{event.name}</span>
          </div>
        </button>
      {/each}
    </div>
  </section>
{/if}
