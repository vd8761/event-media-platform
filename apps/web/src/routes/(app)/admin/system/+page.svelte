<script lang="ts">
  import { api, type QueueCounts } from '$lib/api';
  import { Badge, Button, Heading, LoadingSpinner } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';

  let stats = $state<{ organizations: number; users: number; events: number; assets: number; storageBytes: number; participants: number } | null>(null);
  let queues = $state<Record<string, QueueCounts>>({});
  let loading = $state(true);
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh() {
    [stats, queues] = await Promise.all([api.admin.stats(), api.admin.queues()]);
    loading = false;
  }

  async function action(queue: string, name: string) {
    await api.admin.queueAction(queue, name);
    await refresh();
  }

  function formatBytes(bytes: number) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
  }

  onMount(() => {
    void refresh();
    timer = setInterval(() => void refresh(), 5000);
  });
  onDestroy(() => timer && clearInterval(timer));
</script>

<svelte:head><title>System — EventLens</title></svelte:head>

<Heading size="large" class="mb-6">System</Heading>

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else}
  {#if stats}
    <div class="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {#each [
        { label: 'Organizations', value: stats.organizations },
        { label: 'Users', value: stats.users },
        { label: 'Events', value: stats.events },
        { label: 'Assets', value: stats.assets },
        { label: 'Participants', value: stats.participants },
        { label: 'Storage', value: formatBytes(stats.storageBytes) },
      ] as stat (stat.label)}
        <div class="rounded-2xl border border-gray-200 p-4">
          <p class="text-xs text-gray-500">{stat.label}</p>
          <p class="mt-1 text-2xl font-semibold">{stat.value}</p>
        </div>
      {/each}
    </div>
  {/if}

  <Heading size="small" class="mb-3">Queues</Heading>
  <div class="overflow-x-auto rounded-2xl border border-gray-200">
    <table class="w-full text-sm">
      <thead class="bg-immich-gray text-xs text-gray-500">
        <tr>
          <th class="px-4 py-3 text-start font-medium">Queue</th>
          <th class="px-3 py-3 text-end font-medium">Active</th>
          <th class="px-3 py-3 text-end font-medium">Waiting</th>
          <th class="px-3 py-3 text-end font-medium">Delayed</th>
          <th class="px-3 py-3 text-end font-medium">Failed</th>
          <th class="px-4 py-3 text-end font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each Object.entries(queues) as [name, counts] (name)}
          <tr class="border-t border-gray-100">
            <td class="px-4 py-2.5 font-mono text-xs">
              {name}
              {#if counts.isPaused}<Badge color="warning" size="small">paused</Badge>{/if}
            </td>
            <td class="px-3 py-2.5 text-end">{counts.active}</td>
            <td class="px-3 py-2.5 text-end">{counts.waiting}</td>
            <td class="px-3 py-2.5 text-end">{counts.delayed}</td>
            <td class="px-3 py-2.5 text-end {counts.failed > 0 ? 'font-semibold text-red-600' : ''}">{counts.failed}</td>
            <td class="px-4 py-2.5">
              <div class="flex justify-end gap-1">
                {#if counts.isPaused}
                  <Button size="tiny" variant="ghost" onclick={() => action(name, 'resume')}>Resume</Button>
                {:else}
                  <Button size="tiny" variant="ghost" onclick={() => action(name, 'pause')}>Pause</Button>
                {/if}
                {#if counts.failed > 0}
                  <Button size="tiny" variant="ghost" onclick={() => action(name, 'retry-failed')}>Retry</Button>
                  <Button size="tiny" variant="ghost" color="danger" onclick={() => action(name, 'clear-failed')}>Clear</Button>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
