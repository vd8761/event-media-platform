<script lang="ts">
  import { api, type GpuStatusResponse } from '$lib/api';
  import { Badge, Button, Heading, LoadingSpinner } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';

  let status = $state<GpuStatusResponse | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setInterval> | undefined;

  // Local copy so a field being edited is not clobbered by the poll.
  let form = $state<{
    enabled: boolean;
    pendingThreshold: number;
    maxPendingAgeMinutes: number;
    idleShutdownMinutes: number;
    startWebhookUrl: string;
    stopWebhookUrl: string;
    webhookAuthHeader: string;
  } | null>(null);

  async function refresh() {
    status = await api.admin.gpu();
    form ??= { ...status.config };
    loading = false;
  }

  async function run(action: () => Promise<unknown>) {
    busy = true;
    error = null;
    try {
      await action();
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const stateColor = (state: string) =>
    state === 'running' ? 'success' : state === 'off' ? 'secondary' : 'warning';

  function formatAge(seconds: number | null) {
    if (seconds === null) return '—';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  onMount(() => {
    void refresh();
    timer = setInterval(() => void refresh(), 5000);
  });
  onDestroy(() => timer && clearInterval(timer));
</script>

<svelte:head><title>GPU worker — EventLens</title></svelte:head>

<Heading size="large" class="mb-6">GPU worker</Heading>

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else if status}
  {#if error}
    <div class="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
  {/if}

  <!-- Status + the manual override. "Process all" is the headline action:
       wake the box now regardless of the thresholds. -->
  <div class="md-surface mb-8 p-5">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div class="mb-1 flex items-center gap-2">
          <Badge color={stateColor(status.state.state)}>{status.state.state}</Badge>
          {#if status.workerOnline}
            <Badge color="success" size="small">worker reporting</Badge>
          {:else}
            <Badge color="secondary" size="small">no worker heartbeat</Badge>
          {/if}
          {#if !status.config.enabled}
            <Badge color="warning" size="small">autostart off</Badge>
          {/if}
        </div>
        <p class="md-body-medium text-gray-600">{status.trigger.reason}</p>
        {#if status.state.lastError}
          <p class="md-body-small mt-1 text-red-600">Last error: {status.state.lastError}</p>
        {/if}
      </div>

      <div class="flex gap-2">
        <Button
          disabled={busy || status.pending === 0}
          onclick={() => run(() => api.admin.startGpu())}
          title={status.pending === 0 ? 'Nothing is queued' : 'Start the GPU box and work through the queue'}
        >
          Process all ({status.pending})
        </Button>
        <Button
          variant="outline"
          color="danger"
          disabled={busy || status.state.state === 'off'}
          onclick={() => run(() => api.admin.stopGpu())}
        >
          Stop now
        </Button>
      </div>
    </div>

    <dl class="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
      <div><dt class="text-gray-600">Pending jobs</dt><dd class="md-title-medium">{status.pending}</dd></div>
      <div>
        <dt class="text-gray-600">Oldest waiting</dt>
        <dd class="md-title-medium">{formatAge(status.oldestPendingAgeSeconds)}</dd>
      </div>
      <div>
        <dt class="text-gray-600">Wakes at</dt>
        <dd class="md-title-medium">{status.config.pendingThreshold} jobs</dd>
      </div>
      <div>
        <dt class="text-gray-600">…or after</dt>
        <dd class="md-title-medium">{status.config.maxPendingAgeMinutes}m</dd>
      </div>
    </dl>
  </div>

  <Heading size="small" class="mb-3">Pending work</Heading>
  <div class="md-surface mb-8 overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="bg-immich-gray text-xs text-gray-500">
        <tr>
          <th class="px-4 py-3 text-start font-medium">Queue</th>
          <th class="px-3 py-3 text-end font-medium">Waiting</th>
          <th class="px-3 py-3 text-end font-medium">Active</th>
          <th class="px-3 py-3 text-end font-medium">Delayed</th>
          <th class="px-3 py-3 text-end font-medium">Failed</th>
          <th class="px-4 py-3 text-end font-medium">Oldest waiting</th>
        </tr>
      </thead>
      <tbody>
        {#each status.queues as queue (queue.name)}
          <tr class="border-t border-gray-100">
            <td class="px-4 py-2.5 font-mono text-xs">{queue.name}</td>
            <td class="px-3 py-2.5 text-end">{queue.waiting}</td>
            <td class="px-3 py-2.5 text-end {queue.active > 0 ? 'font-semibold text-green-700' : ''}">{queue.active}</td>
            <td class="px-3 py-2.5 text-end">{queue.delayed}</td>
            <td class="px-3 py-2.5 text-end {queue.failed > 0 ? 'font-semibold text-red-600' : ''}">{queue.failed}</td>
            <td class="px-4 py-2.5 text-end">{formatAge(queue.oldestWaitingAgeSeconds)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if form}
    <Heading size="small" class="mb-3">Autostart</Heading>
    <div class="md-surface p-5">
      <label class="mb-4 flex items-center gap-3">
        <input type="checkbox" bind:checked={form.enabled} class="h-4 w-4" />
        <span class="md-label-large">Start the GPU box automatically</span>
      </label>

      <div class="grid gap-4 md:grid-cols-3">
        <label class="block">
          <span class="md-label-medium text-gray-600">Start at this many pending jobs</span>
          <input type="number" min="1" bind:value={form.pendingThreshold} class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
        </label>
        <label class="block">
          <span class="md-label-medium text-gray-600">…or when a job has waited (min)</span>
          <input type="number" min="1" bind:value={form.maxPendingAgeMinutes} class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
          <span class="md-body-small text-gray-500">Rescues a single job stuck below the threshold.</span>
        </label>
        <label class="block">
          <span class="md-label-medium text-gray-600">Shut down after idle (min)</span>
          <input type="number" min="1" bind:value={form.idleShutdownMinutes} class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
        </label>
      </div>

      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <label class="block">
          <span class="md-label-medium text-gray-600">Start webhook URL</span>
          <input type="url" bind:value={form.startWebhookUrl} placeholder="https://…" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
        </label>
        <label class="block">
          <span class="md-label-medium text-gray-600">Stop webhook URL</span>
          <input type="url" bind:value={form.stopWebhookUrl} placeholder="https://…" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
        </label>
      </div>

      <label class="mt-4 block">
        <span class="md-label-medium text-gray-600">Authorization header sent to both</span>
        <input type="password" bind:value={form.webhookAuthHeader} placeholder="Bearer …" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
      </label>

      <div class="mt-5 flex justify-end">
        <Button disabled={busy} onclick={() => form && run(() => api.admin.updateGpuConfig(form!))}>Save</Button>
      </div>
    </div>
  {/if}
{/if}
