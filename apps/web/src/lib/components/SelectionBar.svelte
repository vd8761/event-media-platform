<script lang="ts">
  // Floating action bar for multi-select, shown while selection mode is on.
  // Mirrors Immich's asset-selection header: count on the left, actions right.
  import { Button, Icon, IconButton } from '@immich/ui';
  import { mdiClose, mdiDelete, mdiDownload, mdiSelectAll } from '@mdi/js';

  interface Props {
    count: number;
    total: number;
    downloading?: boolean;
    canDelete?: boolean;
    onSelectAll: () => void;
    onClear: () => void;
    onDownload: () => void;
    onDelete?: () => void;
  }

  let {
    count,
    total,
    downloading = false,
    canDelete = false,
    onSelectAll,
    onClear,
    onDownload,
    onDelete,
  }: Props = $props();
</script>

<div
  class="sticky top-0 z-30 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur"
>
  <div class="flex items-center gap-2">
    <IconButton icon={mdiClose} aria-label="Exit selection" size="small" variant="ghost" color="secondary" onclick={onClear} />
    <span class="text-sm font-medium">
      {count === 0 ? 'Select photos' : `${count} selected`}
    </span>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <Button size="tiny" variant="ghost" color="secondary" onclick={onSelectAll}>
      <Icon icon={mdiSelectAll} size="1.05rem" class="me-1" />
      Select all {total}
    </Button>
    {#if canDelete && onDelete}
      <Button size="tiny" variant="ghost" color="danger" leadingIcon={mdiDelete} disabled={count === 0} onclick={onDelete}>
        Delete
      </Button>
    {/if}
    <Button size="tiny" leadingIcon={mdiDownload} disabled={count === 0} loading={downloading} onclick={onDownload}>
      Download{count > 0 ? ` (${count})` : ''}
    </Button>
  </div>
</div>
