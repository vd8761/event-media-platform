<script lang="ts">
  // Per-event pipeline progress. Counts come from the database rather than the
  // queues, so they stay accurate after a restart and after BullMQ trims its
  // completed-job history.
  //
  // The card is transient by design: it only appears while there is work in
  // flight or something failed. Once everything is processed it disappears
  // rather than sitting on the gallery repeating "all done".
  import type { ProcessingStatus } from '$lib/api';
  import { Button, Icon } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiFaceRecognition, mdiRefresh } from '@mdi/js';

  interface Props {
    status: ProcessingStatus;
    canManage?: boolean;
    onReprocess?: () => void;
  }

  let { status, canManage = false, onReprocess }: Props = $props();

  const { assets } = $derived(status);

  const busy = $derived(assets.pendingMedia > 0 || assets.pendingDetection > 0);
  const failed = $derived(assets.failed > 0);

  // Two stages per image (thumbnail, then face detection); videos only have the
  // first. Weighting them together keeps the bar monotonic across the pipeline.
  const totalSteps = $derived(assets.total + assets.images);
  const doneSteps = $derived(
    assets.processed - assets.failed + (assets.images - assets.pendingDetection),
  );
  const percent = $derived(totalSteps > 0 ? Math.min(100, Math.round((doneSteps / totalSteps) * 100)) : 100);

  const remaining = $derived(assets.pendingMedia + assets.pendingDetection);
</script>

{#if assets.total > 0 && (busy || failed)}
  <div class="md-surface mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
    <Icon
      icon={busy ? mdiFaceRecognition : mdiAlertCircleOutline}
      size="1.25rem"
      class={busy ? 'text-immich-primary animate-pulse shrink-0' : 'shrink-0 text-red-600'}
    />

    <div class="min-w-40 flex-1">
      <div class="md-label-medium flex items-center justify-between gap-2">
        <span class="font-medium">
          {#if busy}
            Processing {remaining}
            {remaining === 1 ? 'photo' : 'photos'}…
          {:else}
            Processing finished with errors
          {/if}
        </span>
        {#if busy}
          <span class="text-gray-600 tabular-nums">{percent}%</span>
        {/if}
      </div>

      {#if busy}
        <div class="mt-2 h-1 overflow-hidden rounded bg-gray-100">
          <div class="bg-immich-primary h-full transition-all duration-500" style="width: {percent}%"></div>
        </div>
      {/if}

      {#if failed}
        <p class="md-label-medium mt-0.5 text-red-600">
          {assets.failed}
          {assets.failed === 1 ? 'photo' : 'photos'} failed to process
        </p>
      {/if}
    </div>

    {#if canManage && assets.pendingDetection > 0}
      <Button size="small" variant="outline" leadingIcon={mdiRefresh} onclick={onReprocess}>
        Run face detection
      </Button>
    {/if}
  </div>
{/if}
