<script lang="ts">
  // Upload progress — a port of Immich's UploadPanel + UploadAssetPreview
  // (immich/web/src/routes/UploadPanel.svelte, UploadAssetPreview.svelte):
  // a floating bottom-right card that minimises to a circular badge, a
  // success/error/duplicate tally in the header, and one row per file with a
  // state icon and an inline progress bar carrying the percentage.
  import { Icon, IconButton } from '@immich/ui';
  import {
    mdiAlertCircle,
    mdiCheckCircle,
    mdiCircleOutline,
    mdiCloudUploadOutline,
    mdiClose,
    mdiLoading,
    mdiWindowMinimize,
  } from '@mdi/js';
  import { quartInOut } from 'svelte/easing';
  import { fade, scale } from 'svelte/transition';

  export type UploadState = 'pending' | 'hashing' | 'uploading' | 'done' | 'duplicate' | 'error';

  export interface UploadItem {
    id: number;
    name: string;
    state: UploadState;
    progress: number;
    error?: string;
  }

  interface Props {
    uploads: UploadItem[];
    // Reported separately because duplicate rows are removed from the list the
    // moment they are detected — nothing was uploaded, so there is nothing to
    // show progress for — but the outcome still needs stating.
    duplicates?: number;
    onDismiss: () => void;
  }

  let { uploads, duplicates: duplicatesProp = 0, onDismiss }: Props = $props();

  let showDetail = $state(true);

  const stats = $derived.by(() => {
    let success = 0;
    let errors = 0;
    let duplicates = duplicatesProp;
    let remaining = 0;
    for (const upload of uploads) {
      switch (upload.state) {
        case 'done': {
          success++;
          break;
        }
        case 'error': {
          errors++;
          break;
        }
        case 'duplicate': {
          duplicates++;
          break;
        }
        default: {
          remaining++;
        }
      }
    }
    return { success, errors, duplicates, remaining, total: uploads.length + duplicates };
  });

  const finished = $derived(stats.remaining === 0);

  // Re-open the panel whenever a fresh batch starts, so a minimised badge
  // doesn't hide a new upload.
  $effect(() => {
    if (stats.remaining > 0) {
      showDetail = true;
    }
  });
</script>

<!-- `|| duplicates` matters: a batch where every file was already in the event
     removes every row, and without this the panel would vanish and the user
     would be left wondering whether anything happened at all. -->
{#if uploads.length > 0 || duplicatesProp > 0}
  <div in:fade={{ duration: 250 }} out:fade={{ duration: 250 }} class="fixed end-6 bottom-6 z-60">
    {#if showDetail}
      <div
        in:scale={{ duration: 250, easing: quartInOut }}
        class="w-81 max-w-[calc(100vw-3rem)] rounded-xl border border-gray-200 bg-subtle p-4 text-sm shadow-lg dark:border-subtle"
      >
        <div class="mb-4 flex justify-between gap-2">
          <div class="flex flex-col gap-1">
            <p class="immich-form-label">
              {#if finished}
                Upload complete
              {:else}
                {stats.total - stats.remaining} of {stats.total} uploaded
              {/if}
            </p>
            <p class="immich-form-label text-xs">
              Uploaded <span class="text-success">{stats.success}</span>
              - Errors <span class="text-danger">{stats.errors}</span>
              - Duplicates <span class="text-warning">{stats.duplicates}</span>
            </p>
          </div>

          <div class="flex shrink-0 items-start">
            <IconButton
              variant="ghost"
              shape="round"
              color="secondary"
              size="small"
              aria-label="Minimize"
              icon={mdiWindowMinimize}
              onclick={() => (showDetail = false)}
            />
            {#if finished}
              <IconButton
                variant="ghost"
                shape="round"
                color="secondary"
                size="small"
                aria-label="Dismiss"
                icon={mdiClose}
                onclick={onDismiss}
              />
            {/if}
          </div>
        </div>

        <div class="immich-scrollbar flex max-h-[400px] flex-col gap-2 overflow-y-auto rounded-lg">
          {#each uploads as upload (upload.id)}
            <div
              in:fade={{ duration: 250 }}
              out:fade={{ duration: 100 }}
              class="flex flex-col gap-1 rounded-xl border border-gray-300 bg-primary/10 p-2 text-xs dark:border-subtle"
            >
              <div class="flex items-center gap-2">
                <div class="flex shrink-0 items-center justify-center">
                  {#if upload.state === 'pending'}
                    <Icon icon={mdiCircleOutline} size="24" class="text-primary" title="Queued" />
                  {:else if upload.state === 'hashing' || upload.state === 'uploading'}
                    <Icon icon={mdiLoading} size="24" spin class="text-primary" title="Uploading" />
                  {:else if upload.state === 'error'}
                    <Icon icon={mdiAlertCircle} size="24" class="text-danger" title="Failed" />
                  {:else if upload.state === 'duplicate'}
                    <Icon icon={mdiAlertCircle} size="24" class="text-warning" title="Already here" />
                  {:else}
                    <Icon icon={mdiCheckCircle} size="24" class="text-success" title="Uploaded" />
                  {/if}
                </div>
                <span class="grow break-all">{upload.name}</span>
              </div>

              {#if upload.state === 'uploading' || upload.state === 'hashing'}
                <div class="relative mt-[5px] h-4.5 w-full rounded-md bg-gray-300">
                  <div
                    class="bg-immich-primary h-4.5 rounded-md transition-all"
                    style="width: {upload.state === 'hashing' ? 0 : upload.progress}%"
                  ></div>
                  <p class="absolute top-0.5 size-full text-center text-[10px] text-white">
                    {upload.state === 'hashing' ? 'Checking…' : `${upload.progress}%`}
                  </p>
                </div>
              {/if}

              {#if upload.state === 'error' && upload.error}
                <p class="text-danger w-full rounded-md text-justify">{upload.error}</p>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <!-- Minimised: a badge showing what's left, plus a red one for errors. -->
      <div class="relative rounded-full">
        {#if stats.remaining > 0}
          <button
            type="button"
            in:scale={{ duration: 250, easing: quartInOut }}
            onclick={() => (showDetail = true)}
            class="bg-primary text-light absolute -start-2 -top-2 z-1 flex size-8 place-content-center place-items-center rounded-full text-xs"
          >
            {stats.remaining}
          </button>
        {/if}
        {#if stats.errors > 0}
          <button
            type="button"
            in:scale={{ duration: 250, easing: quartInOut }}
            onclick={() => (showDetail = true)}
            class="bg-danger text-light absolute -end-2 -top-2 z-1 flex size-8 place-content-center place-items-center rounded-full text-xs"
          >
            {stats.errors}
          </button>
        {/if}
        <button
          type="button"
          in:scale={{ duration: 250, easing: quartInOut }}
          onclick={() => (showDetail = true)}
          aria-label="Show upload progress"
          class="bg-subtle text-primary flex size-16 place-content-center place-items-center rounded-full shadow-lg"
        >
          <div class={finished ? '' : 'animate-pulse'}>
            <Icon icon={finished ? mdiCheckCircle : mdiCloudUploadOutline} size="30" />
          </div>
        </button>
      </div>
    {/if}
  </div>
{/if}
