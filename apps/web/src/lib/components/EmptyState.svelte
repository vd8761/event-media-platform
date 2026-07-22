<script lang="ts">
  // The one way this app says "there is nothing here yet".
  //
  // Previously each page invented its own: the event gallery drew a dashed
  // box, Photos and People used a plain centred block, the map used a centred
  // block with no icon, and imports used a bordered surface. A dashed
  // container around an empty area draws a border around nothing — it makes
  // absence look like a broken component rather than a normal, expected state.
  //
  // So: no container. An icon, a line saying what is missing, and an optional
  // line saying how it gets filled, centred in whatever space the caller gives
  // us.
  import { Icon } from '@immich/ui';
  import type { Snippet } from 'svelte';

  interface Props {
    icon: string;
    title: string;
    // What would make this page have content. Omit when there is nothing
    // useful to say — a vague hint is worse than silence.
    description?: string;
    // Call to action, e.g. an upload button.
    action?: Snippet;
    // Fill the parent's height and centre vertically. Off by default because
    // most callers sit in a normal document flow where that would collapse.
    fillHeight?: boolean;
  }

  let { icon, title, description, action, fillHeight = false }: Props = $props();
</script>

<div
  class="flex flex-col items-center justify-center px-6 text-center {fillHeight ? 'h-full' : 'py-20'}"
>
  <Icon {icon} size="3rem" class="mb-4 text-gray-300 dark:text-gray-600" />
  <p class="md-title-medium mb-1">{title}</p>
  {#if description}
    <p class="md-body-medium max-w-sm text-gray-500">{description}</p>
  {/if}
  {#if action}
    <div class="mt-5">{@render action()}</div>
  {/if}
</div>
