<script lang="ts">
  // Audit trail (migration 0012). Live-tails while the page is open.
  //
  // Polling rather than SSE: at these volumes a 2s poll is indistinguishable
  // from a push, and it survives the Vercel rewrite and a Render restart with
  // no reconnect logic. The `after` cursor keeps it cheap — an idle poll sends
  // the newest timestamp on screen and gets back an empty array.
  import { api, type AuditEntry, type AuditLevel, type AuditSummary } from '$lib/api';
  import { Button, Icon, LoadingSpinner } from '@immich/ui';
  import { mdiAlertCircle, mdiAlertOutline, mdiDeleteSweepOutline, mdiInformationOutline, mdiPause, mdiPlay } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onDestroy, onMount } from 'svelte';

  const POLL_MS = 2000;
  const PAGE_SIZE = 100;

  // Kept bounded: a busy GPU day can write thousands of rows, and an unbounded
  // list would grow the DOM until the tab is unusable. Scrolling back past this
  // is what the "Load older" button is for.
  const MAX_ROWS = 1000;

  const CATEGORIES = ['gpu', 'job', 'auth', 'organization', 'event', 'retention', 'system'];

  const RETENTION_LABEL: Record<string, string> = {
    same_day: 'Same day',
    thirty_days: '30 days',
    never: 'Never',
  };

  let entries = $state<AuditEntry[]>([]);
  let summary = $state<AuditSummary | null>(null);
  let loading = $state(true);
  let live = $state(true);
  let category = $state('');
  let level = $state('');
  let error = $state('');
  let flushing = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const filters = $derived({
    category: category || undefined,
    level: level || undefined,
  });

  async function loadFresh() {
    loading = true;
    error = '';
    try {
      entries = await api.admin.audit({ ...filters, limit: PAGE_SIZE });
      summary = await api.admin.auditSummary();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load logs';
    } finally {
      loading = false;
    }
  }

  async function tail() {
    // Newest row we hold. Without it every poll would re-download the page.
    const newest = entries[0]?.createdAt;
    try {
      const fresh = await api.admin.audit({ ...filters, limit: PAGE_SIZE, after: newest });
      if (fresh.length > 0) {
        entries = [...fresh, ...entries].slice(0, MAX_ROWS);
      }
      error = '';
    } catch (err) {
      // Keep tailing through a blip — a failed poll is not worth tearing the
      // page down for, and the next one usually succeeds.
      error = err instanceof Error ? err.message : 'Poll failed';
    }
    schedule();
  }

  function schedule() {
    stop();
    if (!live || document.visibilityState !== 'visible') {
      return;
    }
    timer = setTimeout(() => void tail(), POLL_MS);
  }

  function stop() {
    if (timer) {
      clearTimeout(timer);
    }
    timer = null;
  }

  async function loadOlder() {
    const oldest = entries.at(-1)?.createdAt;
    if (!oldest) {
      return;
    }
    const older = await api.admin.audit({ ...filters, limit: PAGE_SIZE, before: oldest });
    entries = [...entries, ...older];
  }

  async function flush(retention?: string) {
    const scope = retention ? `all "${RETENTION_LABEL[retention]}" entries` : 'EVERY entry, including never-delete';
    if (!confirm(`Permanently delete ${scope}? This cannot be undone.`)) {
      return;
    }
    flushing = true;
    try {
      await api.admin.flushAudit(retention);
      await loadFresh();
    } finally {
      flushing = false;
    }
  }

  // A hidden tab must not keep polling — same reasoning as the guest progress
  // page. Coming back re-reads immediately rather than waiting out the tick.
  function onVisibility() {
    if (document.visibilityState === 'visible' && live) {
      void tail();
    } else {
      stop();
    }
  }

  // Refetch from scratch when a filter changes; the tail cursor is meaningless
  // across different filters.
  $effect(() => {
    void filters;
    void loadFresh().then(() => schedule());
  });

  onMount(() => document.addEventListener('visibilitychange', onVisibility));
  onDestroy(() => {
    stop();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  });

  const levelIcon = (value: AuditLevel) =>
    value === 'error' ? mdiAlertCircle : value === 'warning' ? mdiAlertOutline : mdiInformationOutline;

  const levelClass = (value: AuditLevel) =>
    value === 'error' ? 'text-red-500' : value === 'warning' ? 'text-amber-500' : 'text-gray-400';
</script>

<svelte:head><title>Logs — EventLens</title></svelte:head>

<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
  <div>
    <h1 class="md-headline-small">Logs</h1>
    <p class="md-body-medium text-gray-500">
      {#if summary}
        {summary.total} entries
        {#if summary.oldest}
          · oldest {DateTime.fromISO(summary.oldest).toRelative()}
        {/if}
      {:else}
        Audit trail
      {/if}
    </p>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <Button
      size="small"
      variant={live ? 'filled' : 'outline'}
      onclick={() => {
        live = !live;
        if (live) void tail();
        else stop();
      }}
    >
      <span class="flex items-center gap-1.5">
        <Icon icon={live ? mdiPause : mdiPlay} size="1rem" />
        {live ? 'Pause' : 'Resume'}
      </span>
    </Button>
  </div>
</div>

<!-- Filters -->
<div class="mb-4 flex flex-wrap items-center gap-2">
  <select bind:value={category} class="bg-subtle rounded-xl px-3 py-2 text-sm" aria-label="Filter by category">
    <option value="">All categories</option>
    {#each CATEGORIES as value (value)}
      <option {value}>{value}</option>
    {/each}
  </select>

  <select bind:value={level} class="bg-subtle rounded-xl px-3 py-2 text-sm" aria-label="Filter by level">
    <option value="">All levels</option>
    <option value="info">Info</option>
    <option value="warning">Warning</option>
    <option value="error">Error</option>
  </select>

  {#if summary}
    <span class="md-label-medium ms-auto flex flex-wrap items-center gap-2 text-gray-500">
      {#each Object.entries(summary.byRetention) as [key, count] (key)}
        <span class="bg-subtle rounded-full px-2.5 py-1">{RETENTION_LABEL[key]}: {count}</span>
      {/each}
    </span>
  {/if}
</div>

{#if error}
  <div class="mb-3 rounded-2xl bg-amber-500/10 px-4 py-2 text-sm text-amber-600">{error}</div>
{/if}

{#if loading && entries.length === 0}
  <div class="flex justify-center py-16"><LoadingSpinner size="giant" /></div>
{:else if entries.length === 0}
  <p class="py-16 text-center text-gray-500">No log entries match this filter.</p>
{:else}
  <div class="md-surface overflow-hidden">
    <!-- Wide content scrolls inside its own container rather than pushing the
         page sideways on a phone. -->
    <div class="overflow-x-auto">
      <table class="w-full min-w-[52rem] text-sm">
        <thead class="bg-subtle text-start">
          <tr>
            <th class="px-4 py-2.5 text-start font-medium">When</th>
            <th class="px-4 py-2.5 text-start font-medium">Category</th>
            <th class="px-4 py-2.5 text-start font-medium">Action</th>
            <th class="px-4 py-2.5 text-start font-medium">Message</th>
            <th class="px-4 py-2.5 text-start font-medium">Keep</th>
          </tr>
        </thead>
        <tbody>
          {#each entries as entry (entry.id)}
            <tr class="border-t border-gray-200/60 align-top">
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-500">
                <span title={DateTime.fromISO(entry.createdAt).toLocaleString(DateTime.DATETIME_FULL)}>
                  {DateTime.fromISO(entry.createdAt).toFormat('dd LLL HH:mm:ss')}
                </span>
              </td>
              <td class="px-4 py-2.5">
                <span class="bg-subtle rounded-full px-2 py-0.5 text-xs">{entry.category}</span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">{entry.action}</td>
              <td class="px-4 py-2.5">
                <span class="flex items-start gap-2">
                  <span class="mt-0.5 shrink-0 {levelClass(entry.level)}">
                    <Icon icon={levelIcon(entry.level)} size="1rem" />
                  </span>
                  <span class="min-w-0">
                    <span class="block">{entry.message}</span>
                    {#if entry.detail}
                      <!-- Collapsed by default: the detail is what you want at
                           3am and noise every other time. -->
                      <details class="mt-1">
                        <summary class="cursor-pointer text-xs text-gray-400">details</summary>
                        <pre class="bg-subtle mt-1 overflow-x-auto rounded-lg p-2 text-xs">{JSON.stringify(
                            entry.detail,
                            null,
                            2,
                          )}</pre>
                      </details>
                    {/if}
                  </span>
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">
                {RETENTION_LABEL[entry.retention] ?? entry.retention}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <div class="mt-4 flex justify-center">
    <Button size="small" variant="outline" onclick={loadOlder}>Load older</Button>
  </div>
{/if}

<!-- Manual flush. Kept at the bottom, away from the live view: these are
     irreversible, and "never delete" exists precisely so that clearing it has
     to be a deliberate act. -->
<div class="md-surface mt-8 p-5">
  <p class="md-title-medium mb-1">Flush logs</p>
  <p class="md-body-medium mb-4 text-gray-600">
    Same-day and 30-day entries are swept automatically. Never-delete entries — sign-ins, permission changes,
    deletions — are only ever removed here.
  </p>
  <div class="flex flex-wrap gap-2">
    <Button size="small" variant="outline" disabled={flushing} onclick={() => flush('same_day')}>
      Flush same-day
    </Button>
    <Button size="small" variant="outline" disabled={flushing} onclick={() => flush('thirty_days')}>
      Flush 30-day
    </Button>
    <Button size="small" variant="outline" color="danger" disabled={flushing} onclick={() => flush()}>
      <span class="flex items-center gap-1.5">
        <Icon icon={mdiDeleteSweepOutline} size="1rem" />
        Flush everything
      </span>
    </Button>
  </div>
</div>
