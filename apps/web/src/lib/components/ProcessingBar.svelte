<script lang="ts">
  // Per-event pipeline progress. Counts come from the database rather than the
  // queues, so they stay accurate after a restart and after BullMQ trims its
  // completed-job history.
  import type { ProcessingStatus } from '$lib/api';
  import { Button, Icon } from '@immich/ui';
  import { mdiCheckCircleOutline, mdiFaceRecognition, mdiRefresh } from '@mdi/js';

  interface Props {
    status: ProcessingStatus;
    canManage?: boolean;
    onReprocess?: () => void;
  }

  let { status, canManage = false, onReprocess }: Props = $props();

  const { assets, faces } = $derived(status);
  const busy = $derived(assets.pendingMedia > 0 || assets.pendingDetection > 0);
  const detectionDone = $derived(assets.images - assets.pendingDetection);
  const detectionPercent = $derived(assets.images > 0 ? Math.round((detectionDone / assets.images) * 100) : 100);
</script>

{#if assets.total > 0}
  <div class="mb-5 rounded-2xl border border-gray-200 p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2 text-sm">
        <Icon
          icon={busy ? mdiFaceRecognition : mdiCheckCircleOutline}
          size="1.25rem"
          class={busy ? 'text-immich-primary animate-pulse' : 'text-green-600'}
        />
        <span class="font-medium">
          {#if busy}
            Processing photos…
          {:else}
            All photos processed
          {/if}
        </span>
      </div>

      {#if canManage && assets.pendingDetection > 0}
        <Button size="tiny" variant="outline" leadingIcon={mdiRefresh} onclick={onReprocess}>
          Run face detection
        </Button>
      {/if}
    </div>

    <div class="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4">
      <div>
        <p class="text-gray-500">Thumbnails</p>
        <p class="mt-0.5 text-sm font-semibold">
          {assets.processed} / {assets.total}
          {#if assets.failed > 0}<span class="ms-1 font-normal text-red-600">({assets.failed} failed)</span>{/if}
        </p>
      </div>
      <div>
        <p class="text-gray-500">Face detection</p>
        <p class="mt-0.5 text-sm font-semibold">
          {detectionDone} / {assets.images}
          {#if assets.pendingDetection > 0}
            <span class="ms-1 font-normal text-amber-600">({assets.pendingDetection} pending)</span>
          {/if}
        </p>
      </div>
      <div>
        <p class="text-gray-500">Faces found</p>
        <p class="mt-0.5 text-sm font-semibold">
          {faces.total}
          {#if faces.unassigned > 0}
            <span class="ms-1 font-normal text-gray-400">({faces.unassigned} unclustered)</span>
          {/if}
        </p>
      </div>
      <div>
        <p class="text-gray-500">People</p>
        <p class="mt-0.5 text-sm font-semibold">{faces.people}</p>
      </div>
    </div>

    {#if assets.pendingDetection > 0}
      <div class="mt-3 h-1 overflow-hidden rounded bg-gray-100">
        <div class="bg-immich-primary h-full transition-all duration-500" style="width: {detectionPercent}%"></div>
      </div>
    {/if}
  </div>
{/if}
