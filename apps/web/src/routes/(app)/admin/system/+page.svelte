<script lang="ts">
  import { api, type AdminStats, type QueueCounts, type SystemStatus } from '$lib/api';
  import { Badge, Button, Heading, LoadingSpinner } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';

  let stats = $state<AdminStats | null>(null);
  let queues = $state<Record<string, QueueCounts>>({});
  let system = $state<SystemStatus | null>(null);
  let loading = $state(true);
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh() {
    [stats, queues, system] = await Promise.all([api.admin.stats(), api.admin.queues(), api.admin.system()]);
    loading = false;
  }

  async function action(queue: string, name: string) {
    await api.admin.queueAction(queue, name);
    await refresh();
  }

  function formatDuration(seconds: number) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`;
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
        { label: 'Photos', value: stats.assets },
        { label: 'People', value: stats.people },
        { label: 'Storage', value: formatBytes(stats.storageBytes) },
      ] as stat (stat.label)}
        <div class="md-surface p-4">
          <p class="md-label-medium text-gray-600">{stat.label}</p>
          <p class="md-display-small mt-1">{stat.value}</p>
        </div>
      {/each}
    </div>

    <Heading size="small" class="mb-3">By organization</Heading>
    <!-- Counts only: events are never named here, because a super admin
         administers organizations without access to what is inside them. -->
    <div class="md-surface mb-8 overflow-x-auto">
      <table class="w-full min-w-3xl text-sm">
        <thead class="bg-immich-gray text-xs text-gray-500">
          <tr>
            <th class="px-4 py-3 text-start font-medium">Organization</th>
            <th class="px-3 py-3 text-end font-medium">Events</th>
            <th class="px-3 py-3 text-end font-medium">Photos</th>
            <th class="px-3 py-3 text-end font-medium">People</th>
            <th class="px-3 py-3 text-end font-medium">People / event</th>
            <th class="px-3 py-3 text-end font-medium">Participants</th>
            <th class="px-4 py-3 text-end font-medium">Storage</th>
          </tr>
        </thead>
        <tbody>
          {#each stats.byOrganization as org (org.orgId)}
            <tr class="border-t border-gray-100">
              <td class="px-4 py-2.5">
                <span class="font-medium">{org.name}</span>
                <span class="ms-2 font-mono text-xs text-gray-500">{org.slug}</span>
              </td>
              <td class="px-3 py-2.5 text-end">{org.eventCount}</td>
              <td class="px-3 py-2.5 text-end">{org.assetCount}</td>
              <td class="px-3 py-2.5 text-end">{org.personCount}</td>
              <td class="px-3 py-2.5 text-end">{org.personsPerEvent}</td>
              <td class="px-3 py-2.5 text-end">{org.participantCount}</td>
              <td class="px-4 py-2.5 text-end">{formatBytes(org.storageBytes)}</td>
            </tr>
          {:else}
            <tr class="border-t border-gray-100">
              <td colspan="7" class="px-4 py-6 text-center text-gray-500">No organizations yet.</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if system}
    <Heading size="small" class="mb-3">Machines</Heading>
    <!-- One card per process heartbeating into Redis. The GPU worker runs on a
         different host than the API, so its CPU/GPU figures can only get here
         via its own heartbeat. -->
    <div class="mb-8 grid gap-4 md:grid-cols-2">
      {#each system.instances as instance (instance.instanceId)}
        <div class="md-surface p-4">
          <div class="mb-3 flex items-start justify-between gap-3">
            <div>
              <p class="md-title-medium">{instance.hostname}</p>
              <p class="md-label-medium text-gray-600">{instance.cpuModel}</p>
            </div>
            <div class="flex flex-wrap justify-end gap-1">
              {#each instance.roles as role (role)}
                <Badge size="small">{role}</Badge>
              {/each}
            </div>
          </div>

          <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt class="text-gray-600">CPU</dt>
            <dd class="text-end">{instance.cpuPercent}% of {instance.cpuCount} cores</dd>
            <dt class="text-gray-600">Memory</dt>
            <dd class="text-end">{formatBytes(instance.memoryUsed)} / {formatBytes(instance.memoryTotal)}</dd>
            <dt class="text-gray-600">Process RSS</dt>
            <dd class="text-end">{formatBytes(instance.rssBytes)}</dd>
            <dt class="text-gray-600">Uptime</dt>
            <dd class="text-end">{formatDuration(instance.processUptimeSeconds)}</dd>
          </dl>

          {#if instance.gpus.length > 0}
            <div class="mt-3 border-t border-gray-100 pt-3">
              {#each instance.gpus as gpu (gpu.index)}
                <div class="mb-2 last:mb-0">
                  <div class="flex items-center justify-between gap-2">
                    <span class="md-label-large">GPU {gpu.index} · {gpu.name}</span>
                    <span class="text-sm">{gpu.utilizationPercent ?? '—'}%</span>
                  </div>
                  <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div class="bg-immich-primary h-full" style="width: {gpu.utilizationPercent ?? 0}%"></div>
                  </div>
                  <p class="mt-1 text-xs text-gray-600">
                    {gpu.memoryUsedMb ?? '—'} / {gpu.memoryTotalMb ?? '—'} MB
                    {#if gpu.temperatureC !== null}· {gpu.temperatureC}°C{/if}
                  </p>
                </div>
              {/each}
            </div>
          {:else if instance.gpuError}
            <p class="mt-3 border-t border-gray-100 pt-3 text-xs text-amber-700">GPU probe failed: {instance.gpuError}</p>
          {:else}
            <p class="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">No GPU on this machine.</p>
          {/if}
        </div>
      {:else}
        <div class="md-surface p-6 text-center text-gray-500">
          No machines are reporting. Heartbeats need Redis to be reachable.
        </div>
      {/each}
    </div>
  {/if}

  <Heading size="small" class="mb-3">Queues</Heading>
  <div class="md-surface overflow-x-auto">
    <table class="w-full min-w-3xl text-sm">
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
                  <Button size="small" variant="ghost" onclick={() => action(name, 'resume')}>Resume</Button>
                {:else}
                  <Button size="small" variant="ghost" onclick={() => action(name, 'pause')}>Pause</Button>
                {/if}
                {#if counts.failed > 0}
                  <Button size="small" variant="ghost" onclick={() => action(name, 'retry-failed')}>Retry</Button>
                  <Button size="small" variant="ghost" color="danger" onclick={() => action(name, 'clear-failed')}>Clear</Button>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
