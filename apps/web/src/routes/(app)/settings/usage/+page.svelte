<script lang="ts">
  // Account statistics, ported from Immich's UserUsageStatistic: headline
  // tiles for the organisation, then a per-event photo/video/size table.
  import { api, type OrgUsage } from '$lib/api';
  import { formatBytes } from '$lib/shell.svelte';
  import { Heading, LoadingSpinner, Table, TableBody, TableCell, TableHeader, TableHeading, TableRow } from '@immich/ui';
  import { Icon } from '@immich/ui';
  import { mdiCalendarMultiple, mdiHarddisk, mdiImageMultipleOutline, mdiPlayBoxMultipleOutline } from '@mdi/js';
  import { onMount } from 'svelte';

  let { data } = $props();

  const org = $derived(data.me.organizations[0]);

  let usage = $state<OrgUsage | null>(null);
  let loading = $state(true);

  onMount(async () => {
    if (org) {
      usage = await api.orgs.usage(org.id).catch(() => null);
    }
    loading = false;
  });

  const tiles = $derived(
    usage
      ? [
          { label: 'Events', value: usage.totals.events.toLocaleString(), icon: mdiCalendarMultiple },
          { label: 'Photos', value: usage.totals.photos.toLocaleString(), icon: mdiImageMultipleOutline },
          { label: 'Videos', value: usage.totals.videos.toLocaleString(), icon: mdiPlayBoxMultipleOutline },
          { label: 'Storage', value: formatBytes(usage.totals.bytes), icon: mdiHarddisk },
        ]
      : [],
  );
</script>

<svelte:head><title>Account stats · EventLens</title></svelte:head>

<section class="mx-auto w-full max-w-5xl p-4 sm:p-6">
  <Heading size="large">Account stats</Heading>
  <p class="md-body-medium mt-1 text-gray-500">
    {#if org}Usage for {org.name}.{:else}No organisation is linked to this account.{/if}
  </p>

  {#if loading}
    <div class="flex justify-center py-16"><LoadingSpinner /></div>
  {:else if !usage}
    <p class="md-body-medium py-16 text-center text-gray-500">Usage statistics are unavailable right now.</p>
  {:else}
    <!-- Headline tiles, mirroring Immich's usage cards. -->
    <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {#each tiles as tile (tile.label)}
        <div class="md-surface flex items-center gap-3 p-4">
          <span class="bg-primary/15 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
            <Icon icon={tile.icon} size="1.5rem" />
          </span>
          <span class="min-w-0">
            <span class="md-label-medium block text-gray-500">{tile.label}</span>
            <span class="md-title-medium block truncate font-semibold">{tile.value}</span>
          </span>
        </div>
      {/each}
    </div>

    <Heading size="tiny" class="mt-8">Per event</Heading>
    {#if usage.events.length === 0}
      <p class="md-body-medium py-10 text-center text-gray-500">No events yet.</p>
    {:else}
      <!-- Table scrolls on its own so narrow screens never scroll the page. -->
      <div class="mt-4 overflow-x-auto">
        <Table striped spacing="small" size="small">
          <TableHeader>
            <TableHeading class="w-2/5">Event</TableHeading>
            <TableHeading class="w-1/5">Photos</TableHeading>
            <TableHeading class="w-1/5">Videos</TableHeading>
            <TableHeading class="w-1/5">Storage</TableHeading>
          </TableHeader>
          <TableBody>
            {#each usage.events as event (event.eventId)}
              <TableRow>
                <TableCell class="w-2/5">
                  <a href="/events/{event.eventId}" class="hover:text-primary hover:underline">{event.eventName}</a>
                </TableCell>
                <TableCell class="w-1/5">{event.photos.toLocaleString()}</TableCell>
                <TableCell class="w-1/5">{event.videos.toLocaleString()}</TableCell>
                <TableCell class="w-1/5">{formatBytes(event.bytes)}</TableCell>
              </TableRow>
            {/each}
          </TableBody>
        </Table>
      </div>
    {/if}
  {/if}
</section>
