<script lang="ts">
  // Top navigation, laid out like Immich's NavigationBar: a two-column grid
  // whose first column matches the sidebar width, brand on the left, a centred
  // search bar, and the action cluster (upload, theme, notifications, account)
  // on the right. Built from the shared @immich/ui controls.
  import { goto } from '$app/navigation';
  import type { Me } from '$lib/api';
  import HelpDialog from '$lib/components/HelpDialog.svelte';
  import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte';
  import { formatBytes, shellStore } from '$lib/shell.svelte';
  import { Icon, IconButton } from '@immich/ui';
  import {
    mdiBellBadge,
    mdiChartBoxOutline,
    mdiBellOutline,
    mdiHelpCircleOutline,
    mdiLogout,
    mdiMagnify,
    mdiMenu,
    mdiTrayArrowUp,
    mdiTune,
  } from '@mdi/js';

  interface Props {
    me: Me;
    onOpenDrawer: () => void;
    onSignOut: () => void;
  }

  let { me, onOpenDrawer, onSignOut }: Props = $props();

  let query = $state('');
  let filtersOpen = $state(false);
  let panel = $state<'none' | 'notifications' | 'account'>('none');
  let helpOpen = $state(false);

  const org = $derived(me.organizations[0]);
  // Non-round brand mark: an organiser's logo is rarely a circle, and cropping
  // it to one mangles most brands.
  const initials = $derived(
    (org?.name ?? me.name)
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join(''),
  );

  function submitSearch(event: SubmitEvent) {
    event.preventDefault();
    if (query.trim()) {
      void goto(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  const hasUnread = $derived(shellStore.unread > 0);
  const toggle = (next: 'notifications' | 'account') => (panel = panel === next ? 'none' : next);
</script>

<svelte:window onclick={() => (panel = 'none')} />

<header class="bg-immich-bg sticky top-0 z-30 h-16 w-full border-b border-gray-200">
  <!-- Mobile sizes the brand cell to its content: pinning it to a fixed 3rem
       let the `shrink-0` logo link overflow on top of the hamburger (later in
       DOM order = painted above), which swallowed every tap on the menu
       button. From lg the cell is the rail's 16rem so the two line up. -->
  <div class="grid h-full grid-cols-[auto_1fr] items-center lg:grid-cols-[16rem_auto]">
    <!-- Brand cell — aligns to the rail width. -->
    <div class="mx-2 flex items-center gap-1 lg:mx-4">
      <IconButton
        icon={mdiMenu}
        aria-label="Main menu"
        shape="round"
        variant="ghost"
        color="secondary"
        size="medium"
        onclick={onOpenDrawer}
        class="lg:hidden"
      />
      <a href="/photos" class="flex shrink-0 items-center gap-2 px-1">
        <span class="bg-primary flex size-8 items-center justify-center rounded-xl text-xs font-bold text-immich-bg">
          EL
        </span>
        <span class="text-primary hidden text-lg font-semibold lg:inline">EventLens</span>
      </a>
    </div>

    <div class="flex items-center justify-between gap-4 pe-3 sm:pe-6 lg:gap-8">
      <!-- Search. Context search is out of scope for now; this filters by name
           and hands off to the search route. -->
      <form onsubmit={submitSearch} class="hidden w-full max-w-5xl flex-1 sm:block">
        <div class="relative flex items-center">
          <span class="pointer-events-none absolute start-4 text-gray-500">
            <Icon icon={mdiMagnify} size="1.25rem" />
          </span>
          <input
            bind:value={query}
            type="search"
            placeholder="Search your events and people"
            aria-label="Search"
            data-md-raw
            class="focus:ring-primary h-12 w-full rounded-full bg-subtle ps-12 pe-12 text-sm outline-none focus:bg-immich-bg focus:ring-2"
          />
          <button
            type="button"
            aria-label="Search filters"
            aria-expanded={filtersOpen}
            onclick={(event) => {
              event.stopPropagation();
              filtersOpen = !filtersOpen;
            }}
            class="hover:bg-gray-200/70 absolute end-2 flex size-9 items-center justify-center rounded-full text-gray-500 transition"
          >
            <Icon icon={mdiTune} size="1.125rem" />
          </button>
        </div>
      </form>

      <section class="flex w-full items-center justify-end gap-1 sm:w-auto md:gap-2">
        <IconButton
          icon={mdiMagnify}
          aria-label="Search"
          shape="round"
          variant="ghost"
          color="secondary"
          size="medium"
          onclick={() => goto('/search')}
          class="sm:hidden"
        />

        <IconButton
          icon={mdiTrayArrowUp}
          aria-label="Upload"
          title="Upload"
          shape="round"
          variant="ghost"
          color="secondary"
          size="medium"
          onclick={() => goto('/events')}
        />

        <ThemeSwitcher compact />

        <!-- Notifications -->
        <div class="relative">
          <IconButton
            icon={hasUnread ? mdiBellBadge : mdiBellOutline}
            aria-label="Notifications"
            shape="round"
            variant="ghost"
            color={hasUnread ? 'primary' : 'secondary'}
            size="medium"
            onclick={(event: MouseEvent) => {
              event.stopPropagation();
              toggle('notifications');
            }}
          />
          {#if panel === 'notifications'}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              onclick={(event) => event.stopPropagation()}
              class="md-surface absolute end-0 z-40 mt-2 max-h-96 w-80 overflow-y-auto p-2 shadow-lg"
            >
              <p class="px-2 py-1.5 text-sm font-semibold">Notifications</p>
              {#each shellStore.notifications as item (item.id)}
                <a
                  href="/events/{item.eventId}/settings"
                  onclick={() => (panel = 'none')}
                  class="hover:bg-subtle block rounded-2xl px-3 py-2.5 transition"
                >
                  <span class="flex items-start gap-2">
                    <span
                      class="mt-1.5 size-2 shrink-0 rounded-full {item.level === 'warning'
                        ? 'bg-amber-500'
                        : 'bg-gray-400'}"
                    ></span>
                    <span class="min-w-0">
                      <span class="block text-sm font-medium">{item.title}</span>
                      <span class="block text-xs text-gray-500">{item.body}</span>
                    </span>
                  </span>
                </a>
              {:else}
                <p class="px-3 py-6 text-center text-sm text-gray-500">Nothing needs your attention.</p>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Account -->
        <div class="relative">
          <button
            type="button"
            aria-label="Account"
            aria-expanded={panel === 'account'}
            onclick={(event) => {
              event.stopPropagation();
              toggle('account');
            }}
            class="bg-primary/15 text-primary hover:bg-primary/25 flex size-9 items-center justify-center rounded-xl text-xs font-bold transition"
          >
            {initials}
          </button>

          {#if panel === 'account'}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              onclick={(event) => event.stopPropagation()}
              class="md-surface absolute end-0 z-40 mt-2 w-72 p-2 shadow-lg"
            >
              <div class="flex items-center gap-3 px-3 py-2">
                <span
                  class="bg-primary/15 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                >
                  {initials}
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium">{me.name}</span>
                  <span class="block truncate text-xs text-gray-500">{me.email}</span>
                  {#if org}
                    <span class="block truncate text-xs text-gray-500">{org.name} · {org.role}</span>
                  {/if}
                </span>
              </div>

              <div class="my-1.5 border-t border-gray-200"></div>

              <div class="grid grid-cols-2 gap-2 px-3 py-2">
                <div>
                  <p class="text-xs text-gray-500">Storage</p>
                  <p class="text-sm font-semibold">{formatBytes(shellStore.storage.bytes)}</p>
                </div>
                <div>
                  <p class="text-xs text-gray-500">Photos</p>
                  <p class="text-sm font-semibold">{shellStore.storage.assets.toLocaleString()}</p>
                </div>
              </div>

              <div class="px-3 py-2">
                <p class="mb-1.5 text-xs text-gray-500">Theme</p>
                <ThemeSwitcher />
              </div>

              <div class="my-1.5 border-t border-gray-200"></div>

              <a
                href="/settings/usage"
                onclick={() => (panel = 'none')}
                class="hover:bg-subtle flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm text-gray-700 transition"
              >
                <Icon icon={mdiChartBoxOutline} size="1.25rem" />
                Account stats
              </a>
              <!-- Help is organiser-facing only: a super admin receives these
                   messages, so offering them the form would be circular. -->
              {#if !me.isSuperAdmin}
                <button
                  onclick={() => {
                    panel = 'none';
                    helpOpen = true;
                  }}
                  class="hover:bg-subtle flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm text-gray-700 transition"
                >
                  <Icon icon={mdiHelpCircleOutline} size="1.25rem" />
                  Help
                </button>
              {/if}
              <button
                onclick={onSignOut}
                class="hover:bg-subtle flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm text-gray-700 transition"
              >
                <Icon icon={mdiLogout} size="1.25rem" />
                Sign out
              </button>
            </div>
          {/if}
        </div>
      </section>
    </div>
  </div>
</header>

{#if filtersOpen}
  <!-- Filter shell. Wired to nothing yet — search is a later phase, and
       controls that silently do nothing are worse than saying so. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div onclick={(event) => event.stopPropagation()} class="border-b border-gray-200 bg-immich-bg px-4 py-3">
    <div class="mx-auto flex max-w-5xl flex-wrap gap-2">
      {#each ['People', 'Event', 'Date range', 'Media type'] as filter (filter)}
        <button
          type="button"
          disabled
          class="cursor-not-allowed rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-500 opacity-60"
        >
          {filter}
        </button>
      {/each}
      <span class="self-center text-xs text-gray-500">Filters arrive with search.</span>
    </div>
  </div>
{/if}

{#if helpOpen && org}
  <HelpDialog orgId={org.id} onClose={() => (helpOpen = false)} />
{/if}
