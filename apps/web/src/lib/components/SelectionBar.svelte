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
  class="md-surface sticky top-16 z-30 mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 shadow-sm backdrop-blur lg:top-0"
>
  <div class="flex min-w-0 items-center gap-1">
    <IconButton icon={mdiClose} aria-label="Exit selection" variant="ghost" color="secondary" onclick={onClear} />
    <span class="md-title-small truncate">
      {count === 0 ? 'Select photos' : `${count} selected`}
    </span>
  </div>

  <div class="flex flex-wrap items-center gap-1.5">
    <Button size="small" variant="ghost" color="secondary" onclick={onSelectAll}>
      <Icon icon={mdiSelectAll} size="1.15rem" class="me-1.5" />
      <span class="hidden sm:inline">Select all&nbsp;</span>{total}
    </Button>
    {#if canDelete && onDelete}
      <Button size="small" variant="ghost" color="danger" leadingIcon={mdiDelete} disabled={count === 0} onclick={onDelete}>
        Delete
      </Button>
    {/if}
    <Button size="small" leadingIcon={mdiDownload} disabled={count === 0} loading={downloading} onclick={onDownload}>
      Download{count > 0 ? ` (${count})` : ''}
    </Button>
  </div>
</div>
