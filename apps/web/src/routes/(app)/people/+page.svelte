<script lang="ts">
  // Org-wide People grid, in Immich's People layout: circular portraits laid
  // out in a responsive grid, name (or "Add a name") beneath, most-photographed
  // first. People are event-scoped, so a card links into its event's person
  // page where naming, merging and cover-picking already live.
  import { goto } from '$app/navigation';
  import { api, type OrgPerson } from '$lib/api';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { shellStore } from '$lib/shell.svelte';
  import { Heading, LoadingSpinner } from '@immich/ui';
  import { mdiAccountOutline } from '@mdi/js';

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

  // Unnamed people are hidden. Face clustering produces a long tail of one-off
  // groups — a stranger in the background of one photo — and showing them all
  // buries the handful of people who actually matter. They are still reachable
  // from inside an event, which is where naming happens.
  const named = $derived(people.filter((person) => person.name));

  const filtered = $derived(
    query.trim()
      ? named.filter((person) => (person.name ?? '').toLowerCase().includes(query.trim().toLowerCase()))
      : named,
  );

  // Grouped by event, events alphabetical, people alphabetical within each.
  // A flat name-sorted list mixes events together, and the same person appears
  // once per event they were detected in — which reads as duplicates.
  const groups = $derived.by(() => {
    const byEvent = new Map<string, { eventId: string; eventName: string; people: OrgPerson[] }>();
    for (const person of filtered) {
      const group = byEvent.get(person.eventId) ?? {
        eventId: person.eventId,
        eventName: person.eventName,
        people: [],
      };
      group.people.push(person);
      byEvent.set(person.eventId, group);
    }
    for (const group of byEvent.values()) {
      group.people.sort(comparePeople);
    }
    return [...byEvent.values()].sort((a, b) => a.eventName.localeCompare(b.eventName));
  });

  // Named before unnamed, then most-photographed, then alphabetical. The tie
  // break matters: without it two people with equal counts reorder on every
  // load, because the server's ordering is not stable.
  function comparePeople(a: OrgPerson, b: OrgPerson) {
    const aNamed = a.name ? 1 : 0;
    const bNamed = b.name ? 1 : 0;
    if (aNamed !== bNamed) {
      return bNamed - aNamed;
    }
    if (a.faceCount !== b.faceCount) {
      return b.faceCount - a.faceCount;
    }
    return (a.name ?? '').localeCompare(b.name ?? '');
  }

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
  <EmptyState
    icon={mdiAccountOutline}
    title="No people yet"
    description="As photos are processed, everyone recognised across your events appears here."
  />
{:else}
  {#each groups as group (group.eventId)}
    <section class="mb-8">
      <h2 class="md-title-medium mb-3">{group.eventName}</h2>
      <!-- Smaller tiles and more columns than before: these are identification
           aids, not portraits to admire, and the old size fit barely a dozen on
           screen. -->
      <div class="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
        {#each group.people as person (person.id)}
          <button
            type="button"
            onclick={() => goto(`/events/${person.eventId}/people/${person.id}`)}
            title={person.name}
            class="group flex flex-col items-center gap-2 text-center"
          >
            <div
              class="relative aspect-square w-full overflow-hidden rounded-[4px] bg-subtle ring-1 ring-black/5 transition group-hover:ring-2 group-hover:ring-immich-primary"
            >
              {#if person.thumbnailUrl}
                <img src={person.thumbnailUrl} alt="" loading="lazy" class="h-full w-full object-cover" />
              {:else}
                <span class="text-primary flex h-full w-full items-center justify-center text-sm font-semibold">
                  {initials(person.name)}
                </span>
              {/if}
            </div>
            <span class="block w-full truncate text-sm font-medium">{person.name}</span>
          </button>
        {/each}
      </div>
    </section>
  {:else}
    <div class="md-surface p-10 text-center">
      <p class="md-title-medium mb-1">
        {query.trim() ? `No one matches "${query}"` : 'No named people yet'}
      </p>
      <p class="md-body-medium text-gray-500">
        {query.trim()
          ? 'Try a different name.'
          : 'Open an event and name the people you recognise — they will appear here.'}
      </p>
    </div>
  {/each}
{/if}
