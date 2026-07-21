<script lang="ts">
  // Jobs dashboard, modelled on Immich's admin jobs page: one card per queue
  // with live counts, what it is working on right now, throughput and controls.
  import { api, type JobQueue, type SystemStatus } from '$lib/api';
  import { Badge, Button, Icon, LoadingSpinner } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiChevronDown,
    mdiDeleteSweep,
    mdiMemory,
    mdiPause,
    mdiPlay,
    mdiRefresh,
    mdiServerNetwork,
  } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';

  let queues = $state<JobQueue[]>([]);
  let system = $state<SystemStatus | null>(null);
  let loading = $state(true);
  let error = $state('');
  let expanded = $state<Record<string, boolean>>({});
  let failedJobs = $state<Record<string, { id: string; name: string; reason: string }[]>>({});
  let timer: ReturnType<typeof setInterval> | undefined;

  const totals = $derived.by(() => {
    let active = 0;
    let waiting = 0;
    let failed = 0;
    for (const queue of queues) {
      active += queue.counts.active;
      waiting += queue.counts.waiting + queue.counts.delayed + queue.counts.paused;
      failed += queue.counts.failed;
    }
    return { active, waiting, failed };
  });

  async function refresh() {
    try {
      const [jobs, status] = await Promise.all([api.admin.jobs(), api.admin.system()]);
      queues = jobs.queues;
      system = status;
      error = '';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load job status';
    } finally {
      loading = false;
    }
  }

  async function act(queue: string, action: string) {
    await api.admin.queueAction(queue, action);
    await refresh();
  }

  async function toggle(queue: JobQueue) {
    expanded[queue.name] = !expanded[queue.name];
    if (expanded[queue.name] && queue.counts.failed > 0 && !failedJobs[queue.name]) {
      failedJobs[queue.name] = await api.admin.failedJobs(queue.name);
    }
  }

  function formatBytes(bytes: number) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unit = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024));
    return `${(bytes / 1024 ** unit).toFixed(1)} ${units[unit]}`;
  }

  function formatDuration(seconds: number) {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    if (seconds < 3600) {
      return `${Math.round(seconds / 60)}m`;
    }
    if (seconds < 86_400) {
      return `${Math.round(seconds / 3600)}h`;
    }
    return `${Math.round(seconds / 86_400)}d`;
  }

  onMount(() => {
    void refresh();
    timer = setInterval(() => void refresh(), 3000);
  });
  onDestroy(() => timer && clearInterval(timer));
</script>

<svelte:head><title>Jobs — EventLens</title></svelte:head>

<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
  <h1 class="md-headline-small">Jobs</h1>
  <Button variant="ghost" leadingIcon={mdiRefresh} onclick={refresh}>Refresh</Button>
</div>

{#if error}
  <div class="mb-4 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
    <Icon icon={mdiAlertCircleOutline} size="1.25rem" />
    {error}
  </div>
{/if}

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else}
  <!-- headline counters -->
  <div class="mb-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-3 sm:gap-4">
    <div class="md-surface p-4">
      <p class="md-label-medium text-gray-600">Active</p>
      <p class="md-display-small mt-1 {totals.active > 0 ? 'text-immich-primary' : ''}">{totals.active}</p>
    </div>
    <div class="md-surface p-4">
      <p class="md-label-medium text-gray-600">Pending</p>
      <p class="md-display-small mt-1">{totals.waiting}</p>
    </div>
    <div class="md-surface p-4">
      <p class="md-label-medium text-gray-600">Failed</p>
      <p class="md-display-small mt-1 {totals.failed > 0 ? 'text-red-600' : ''}">{totals.failed}</p>
    </div>
  </div>

  <!-- system status -->
  {#if system}
    <div class="mb-6 grid gap-4 lg:grid-cols-2">
      <div class="md-surface p-4">
        <div class="mb-3 flex items-center gap-2">
          <Icon icon={mdiMemory} size="1.15rem" class="text-gray-400" />
          <h2 class="md-title-medium">Machine learning</h2>
          <Badge color={system.machineLearning.device === 'cuda' ? 'success' : 'secondary'} size="small">
            {system.machineLearning.device.toUpperCase()}
          </Badge>
        </div>
        <p class="mb-3 text-xs text-gray-400">
          Device is read from configuration (EL_ML_DEVICE), not probed from the sidecar.
        </p>

        {#if !system.machineLearning.usedByThisProcess}
          <!-- This API host runs api/ingest and never does inference; the GPU
               box reaches its own sidecar over a network this process is not
               on. Showing a failed health check here would be a permanent red
               light on a healthy deployment. -->
          <p class="text-xs text-gray-500">
            Not used by this process — inference runs on the <span class="font-mono">media</span> worker, which reaches
            its own sidecar directly. See the machine list below for that worker's status.
          </p>
        {/if}

        <div class="space-y-2">
          {#each system.machineLearning.servers as server (server.url)}
            <div class="flex items-center justify-between gap-3 text-xs">
              <span class="truncate font-mono">{server.url}</span>
              <span class="flex shrink-0 items-center gap-2">
                {#if server.latencyMs !== null}<span class="text-gray-500">{server.latencyMs} ms</span>{/if}
                <Badge color={server.healthy ? 'success' : 'danger'} size="small">
                  {server.healthy ? 'healthy' : 'unreachable'}
                </Badge>
              </span>
            </div>
          {/each}
        </div>
      </div>

      <div class="md-surface p-4">
        <div class="mb-3 flex items-center gap-2">
          <Icon icon={mdiServerNetwork} size="1.15rem" class="text-gray-400" />
          <h2 class="md-title-medium">Server</h2>
        </div>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div class="col-span-2">
            <dt class="text-gray-500">CPU · {system.host.cpuCount} cores</dt>
            <dd class="mt-1 flex items-center gap-2">
              <div class="h-1.5 flex-1 overflow-hidden rounded bg-gray-100">
                <div
                  class="h-full transition-all {system.host.cpuPercent > 85 ? 'bg-red-500' : 'bg-immich-primary'}"
                  style="width: {system.host.cpuPercent}%"
                ></div>
              </div>
              <span class="w-12 text-end font-medium">{system.host.cpuPercent}%</span>
            </dd>
            <dd class="mt-1 truncate text-gray-400">{system.host.cpuModel}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-gray-500">Memory</dt>
            <dd class="mt-1 flex items-center gap-2">
              <div class="h-1.5 flex-1 overflow-hidden rounded bg-gray-100">
                <div
                  class="bg-immich-primary h-full transition-all"
                  style="width: {Math.round((system.host.memoryUsed / system.host.memoryTotal) * 100)}%"
                ></div>
              </div>
              <span class="w-28 text-end font-medium">
                {formatBytes(system.host.memoryUsed)} / {formatBytes(system.host.memoryTotal)}
              </span>
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">Roles</dt>
            <dd class="font-medium">{system.process.workers.join(', ') || 'none'}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Uptime</dt>
            <dd class="font-medium">{formatDuration(system.process.uptimeSeconds)}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Database</dt>
            <dd class="font-medium">{system.database.version} · {system.database.vectorExtension}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Node</dt>
            <dd class="font-medium">{system.process.nodeVersion}</dd>
          </div>
        </dl>
      </div>
    </div>
  {/if}

  <!-- queue cards -->
  <div class="space-y-3">
    {#each queues as queue (queue.name)}
      {@const running = queue.counts.active > 0}
      <div class="md-surface {running ? 'border-immich-primary/60' : ''}">
        <div class="flex flex-wrap items-start justify-between gap-4 p-4">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="md-title-medium">{queue.label}</h2>
              {#if queue.isPaused}
                <Badge color="warning" size="small">paused</Badge>
              {:else if running}
                <Badge color="primary" size="small">running</Badge>
              {/if}
              {#if queue.counts.failed > 0}
                <Badge color="danger" size="small">{queue.counts.failed} failed</Badge>
              {/if}
              <span class="text-xs text-gray-400">{queue.role} · concurrency {queue.concurrency}</span>
            </div>
            <p class="md-body-medium mt-1 text-gray-600">{queue.description}</p>

            <!-- counts -->
            <div class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <span><span class="font-semibold">{queue.counts.active}</span> <span class="text-gray-500">active</span></span>
              <span><span class="font-semibold">{queue.counts.waiting}</span> <span class="text-gray-500">waiting</span></span>
              <span><span class="font-semibold">{queue.counts.delayed}</span> <span class="text-gray-500">delayed</span></span>
              <span><span class="font-semibold">{queue.counts.completed}</span> <span class="text-gray-500">completed</span></span>
              {#if queue.ratePerMinute > 0}
                <span class="text-immich-primary font-medium">{queue.ratePerMinute}/min</span>
              {/if}
              {#if queue.etaSeconds !== null}
                <span class="text-gray-500">~{formatDuration(queue.etaSeconds)} remaining</span>
              {/if}
            </div>

            {#if queue.pending > 0 && queue.counts.completed > 0}
              {@const total = queue.pending + queue.counts.completed}
              <div class="mt-2 h-1 overflow-hidden rounded bg-gray-100">
                <div
                  class="bg-immich-primary h-full transition-all duration-500"
                  style="width: {Math.round((queue.counts.completed / total) * 100)}%"
                ></div>
              </div>
            {/if}
          </div>

          <div class="flex shrink-0 items-center gap-1">
            {#if queue.isPaused}
              <Button size="small" variant="ghost" leadingIcon={mdiPlay} onclick={() => act(queue.name, 'resume')}>
                Resume
              </Button>
            {:else}
              <Button size="small" variant="ghost" leadingIcon={mdiPause} onclick={() => act(queue.name, 'pause')}>
                Pause
              </Button>
            {/if}
            {#if queue.counts.failed > 0}
              <Button size="small" variant="ghost" leadingIcon={mdiRefresh} onclick={() => act(queue.name, 'retry-failed')}>
                Retry
              </Button>
              <Button
                size="small"
                variant="ghost"
                color="danger"
                leadingIcon={mdiDeleteSweep}
                onclick={() => act(queue.name, 'clear-failed')}
              >
                Clear
              </Button>
            {/if}
            <Button size="small" variant="ghost" color="secondary" onclick={() => toggle(queue)}>
              <Icon icon={mdiChevronDown} size="1.1rem" class={expanded[queue.name] ? 'rotate-180' : ''} />
            </Button>
          </div>
        </div>

        {#if expanded[queue.name]}
          <div class="border-t border-gray-100 px-4 py-3">
            <p class="mb-2 text-xs font-medium text-gray-500">Job types</p>
            <div class="mb-4 flex flex-wrap gap-1.5">
              {#each queue.jobs as job (job)}
                <span class="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[11px]">{job}</span>
              {/each}
            </div>

            {#if queue.active.length > 0}
              <p class="mb-2 text-xs font-medium text-gray-500">Running now</p>
              <div class="mb-4 space-y-1">
                {#each queue.active as job, jobIndex (jobIndex)}
                  <div class="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-1.5 text-xs">
                    <span class="font-mono">{job.name}</span>
                    <span class="truncate text-gray-500">{JSON.stringify(job.data)}</span>
                    {#if job.startedAt}
                      <span class="shrink-0 text-gray-400">
                        {formatDuration(Math.max(0, Math.round((Date.now() - job.startedAt) / 1000)))}
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            {#if failedJobs[queue.name]?.length}
              <p class="mb-2 text-xs font-medium text-gray-500">Recent failures</p>
              <div class="space-y-1">
                {#each failedJobs[queue.name] as job (job.id)}
                  <div class="rounded-lg bg-red-50 px-3 py-1.5 text-xs">
                    <span class="font-mono">{job.name}</span>
                    <p class="mt-0.5 break-words text-red-700">{job.reason}</p>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
