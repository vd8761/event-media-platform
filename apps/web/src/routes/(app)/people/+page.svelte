<script lang="ts">
  // Org-wide People grid, in Immich's People layout: circular portraits laid
  // out in a responsive grid, name (or "Add a name") beneath, most-photographed
  // first. People are event-scoped, so a card links into its event's person
  // page where naming, merging and cover-picking already live.
  import { goto } from '$app/navigation';
  import { api, type OrgPerson } from '$lib/api';
  import { shellStore } from '$lib/shell.svelte';
  import { Heading, LoadingSpinner } from '@immich/ui';

  let people = $state<OrgPerson[]>([]);
  let loading = $state(true);
  let query = $state('');

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

  const filtered = $derived(
    query.trim()
      ? people.filter((person) => (person.name ?? '').toLowerCase().includes(query.trim().toLowerCase()))
      : people,
  );

  function initials(name: string | null): string {
    if (!name) {
      return '?';
    }
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');
  }
</script>

<svelte:head><title>People — EventLens</title></svelte:head>

<div class="mb-5 flex flex-wrap items-baseline justify-between gap-3">
  <Heading size="large">People</Heading>
  {#if people.length > 0}
    <input
      bind:value={query}
      type="search"
      placeholder="Search people"
      aria-label="Search people"
      class="focus:ring-primary h-10 w-full max-w-xs rounded-full bg-subtle px-4 text-sm outline-none focus:ring-2 sm:w-64"
    />
  {/if}
</div>

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else if people.length === 0}
  <div class="md-surface p-10 text-center">
    <p class="md-title-medium mb-1">No people yet</p>
    <p class="md-body-medium text-gray-500">
      As photos are processed, everyone recognised across your events appears here.
    </p>
  </div>
{:else}
  <div class="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8">
    {#each filtered as person (person.id)}
      <button
        type="button"
        onclick={() => goto(`/events/${person.eventId}/people/${person.id}`)}
        title="{person.name ?? 'Unnamed'} · {person.eventName}"
        class="group flex flex-col items-center gap-2 text-center"
      >
        <div
          class="relative aspect-square w-full overflow-hidden rounded-full bg-subtle ring-1 ring-black/5 transition group-hover:ring-2 group-hover:ring-immich-primary"
        >
          {#if person.thumbnailUrl}
            <img src={person.thumbnailUrl} alt="" loading="lazy" class="h-full w-full object-cover" />
          {:else}
            <span class="text-primary flex h-full w-full items-center justify-center text-lg font-semibold">
              {initials(person.name)}
            </span>
          {/if}
        </div>
        <span class="w-full min-w-0">
          <span class="block truncate text-sm font-medium {person.name ? '' : 'text-gray-400'}">
            {person.name ?? 'Add a name'}
          </span>
          <span class="block truncate text-xs text-gray-500">{person.eventName}</span>
        </span>
      </button>
    {:else}
      <p class="col-span-full py-10 text-center text-sm text-gray-500">No one matches "{query}".</p>
    {/each}
  </div>
{/if}
