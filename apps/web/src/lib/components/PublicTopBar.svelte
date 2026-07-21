<script lang="ts">
  // Top bar for the guest-facing pages (selfie submission and the tokenized
  // gallery). Same 4rem height, sticky behaviour and border as the app's
  // TopBar so the two feel like one product: EventLens on the left, the
  // organiser's details on the right.
  import HelpDialog from '$lib/components/HelpDialog.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import { IconButton } from '@immich/ui';
  import { mdiHelpCircleOutline } from '@mdi/js';

  interface Props {
    // Null while the event is still loading, or if the org could not be read.
    orgName?: string | null;
    eventName?: string | null;
    // Included on the ticket so a support message arrives with its context.
    eventId?: string;
  }

  let { orgName = null, eventName = null, eventId }: Props = $props();

  let helpOpen = $state(false);
</script>

<header class="bg-immich-bg sticky top-0 z-30 h-16 w-full border-b border-gray-200">
  <div class="mx-auto flex h-full items-center justify-between gap-3 px-3 sm:px-6">
    <a href="/" class="flex shrink-0 items-center gap-2">
      <Logo />
      <span class="text-primary text-lg font-semibold">EventLens</span>
    </a>

    <div class="flex min-w-0 items-center gap-2">
      {#if orgName}
        <!-- Truncates rather than wraps: the bar is a fixed 4rem, and a long
             organiser name must not push the height around on a phone. -->
        <span class="min-w-0 text-end">
          <span class="block truncate text-sm font-medium">{orgName}</span>
          {#if eventName}
            <span class="block truncate text-xs text-gray-500">{eventName}</span>
          {/if}
        </span>
      {/if}

      <IconButton
        icon={mdiHelpCircleOutline}
        aria-label="Help"
        title="Help"
        shape="round"
        variant="ghost"
        color="secondary"
        size="medium"
        onclick={() => (helpOpen = true)}
      />
    </div>
  </div>
</header>

{#if helpOpen}
  <HelpDialog variant="public" {eventId} onClose={() => (helpOpen = false)} />
{/if}
