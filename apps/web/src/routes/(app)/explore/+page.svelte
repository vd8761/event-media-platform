<script lang="ts">
  // Explore, in Immich's layout: a "People" preview row across the top, then a
  // grid of square "place" tiles — which for an event platform are the events
  // themselves, each a labelled cover. It's a jumping-off surface; the real
  // browsing lives in People and each event.
  import { goto } from '$app/navigation';
  import { api, type OrgPerson } from '$lib/api';
  import { shellStore } from '$lib/shell.svelte';
  import { Heading, Icon, LoadingSpinner } from '@immich/ui';
  import { mdiChevronRight, mdiImageAlbum } from '@mdi/js';

  let people = $state<OrgPerson[]>([]);
  let loading = $state(true);

  let started = $state(false);
  $effect(() => {
    const orgId = shellStore.orgId;
    if (orgId && !started) {
      started = true;
      api.orgs
        .people(orgId)
        .then((rows) => (people = rows))
        .finally(() => (loading = false));
    }
  });

  // First faces only — the row is a teaser that links through to People.
  const preview = $derived(people.slice(0, 14));
</script>

<svelte:head><title>Explore — EventLens</title></svelte:head>

<Heading size="large" class="mb-6">Explore</Heading>

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else}
  <!-- People -->
  {#if people.length > 0}
    <section class="mb-8">
      <a href="/people" class="mb-3 flex w-fit items-center gap-1 text-lg font-semibold hover:text-immich-primary">
        People
        <Icon icon={mdiChevronRight} size="1.25rem" />
      </a>
      <div class="flex flex-wrap gap-x-4 gap-y-5">
        {#each preview as person (person.id)}
          <button
            type="button"
            onclick={() => goto(`/events/${person.eventId}/people/${person.id}`)}
            title="{person.name ?? 'Unnamed'} · {person.eventName}"
            class="group flex w-20 shrink-0 flex-col items-center gap-1.5 text-center"
          >
            <div
              class="aspect-square w-full overflow-hidden rounded-full bg-subtle ring-1 ring-black/5 transition group-hover:ring-2 group-hover:ring-immich-primary"
            >
              {#if person.thumbnailUrl}
                <img src={person.thumbnailUrl} alt="" loading="lazy" class="h-full w-full object-cover" />
              {/if}
            </div>
            <span class="block w-full truncate text-xs {person.name ? 'font-medium' : 'text-gray-400'}">
              {person.name ?? 'Unnamed'}
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Events, as place-style tiles -->
  <section>
    <h2 class="mb-3 text-lg font-semibold">Events</h2>
    {#if shellStore.events.length === 0}
      <div class="md-surface p-10 text-center">
        <p class="md-title-medium mb-1">Nothing to explore yet</p>
        <p class="md-body-medium text-gray-500">People and events show up here as your galleries fill in.</p>
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {#each shellStore.events as event (event.id)}
          <button
            type="button"
            onclick={() => goto(`/events/${event.id}`)}
            title={event.name}
            class="group relative aspect-square overflow-hidden rounded-xl bg-subtle focus:outline-2 focus:outline-immich-primary"
          >
            {#if event.coverUrl}
              <img
                src={event.coverUrl}
                alt=""
                loading="lazy"
                class="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
            {:else}
              <div class="flex h-full w-full items-center justify-center text-gray-400">
                <Icon icon={mdiImageAlbum} size="2rem" />
              </div>
            {/if}
            <div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pt-8 text-start">
              <span class="line-clamp-2 text-sm font-semibold leading-tight text-white">{event.name}</span>
              <span class="block text-xs text-white/80">
                {event.assetCount.toLocaleString()} photo{event.assetCount === 1 ? '' : 's'}
              </span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </section>
{/if}
