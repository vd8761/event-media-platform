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
  <div class="md-surface mb-5 p-4 sm:p-5">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div class="md-title-small flex items-center gap-2">
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
        <Button size="small" variant="outline" leadingIcon={mdiRefresh} onclick={onReprocess}>
          Run face detection
        </Button>
      {/if}
    </div>

    <div class="md-label-medium grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      <div>
        <p class="text-gray-600">Thumbnails</p>
        <p class="md-title-medium mt-0.5">
          {assets.processed} / {assets.total}
          {#if assets.failed > 0}<span class="ms-1 font-normal text-red-600">({assets.failed} failed)</span>{/if}
        </p>
      </div>
      <div>
        <p class="text-gray-600">Face detection</p>
        <p class="md-title-medium mt-0.5">
          {detectionDone} / {assets.images}
          {#if assets.pendingDetection > 0}
            <span class="ms-1 font-normal text-amber-600">({assets.pendingDetection} pending)</span>
          {/if}
        </p>
      </div>
      <div>
        <p class="text-gray-600">Faces found</p>
        <p class="md-title-medium mt-0.5">
          {faces.total}
          {#if faces.unassigned > 0}
            <span class="ms-1 font-normal text-gray-400">({faces.unassigned} unclustered)</span>
          {/if}
        </p>
      </div>
      <div>
        <p class="text-gray-600">People</p>
        <p class="md-title-medium mt-0.5">{faces.people}</p>
      </div>
    </div>

    {#if assets.pendingDetection > 0}
      <div class="mt-3 h-1 overflow-hidden rounded bg-gray-100">
        <div class="bg-immich-primary h-full transition-all duration-500" style="width: {detectionPercent}%"></div>
      </div>
    {/if}
  </div>
{/if}
