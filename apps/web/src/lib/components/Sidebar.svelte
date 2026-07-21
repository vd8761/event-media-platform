<script lang="ts">
  // Primary navigation. Built from @immich/ui's Navbar primitives (the same
  // shared library Immich's own sidebar uses), so the rows render with Immich's
  // exact treatment: full-bleed `rounded-e-full` active pill, outline→filled
  // icon swap, and the expandable album-style group we use for Events.
  import type { Me } from '$lib/api';
  import { formatBytes, shellStore } from '$lib/shell.svelte';
  import { Icon, NavbarGroup, NavbarItem } from '@immich/ui';
  import {
    mdiAccount,
    mdiAccountOutline,
    mdiCloudOutline,
    mdiCog,
    mdiCogOutline,
    mdiDomain,
    mdiExpansionCard,
    mdiLifebuoy,
    mdiTextBoxOutline,
    mdiHarddisk,
    mdiImageAlbum,
    mdiImageMultiple,
    mdiImageMultipleOutline,
    mdiLogout,
    mdiMagnify,
    mdiMap,
    mdiMapOutline,
    mdiViewDashboard,
  } from '@mdi/js';

  interface Props {
    me: Me;
    onNavigate?: () => void;
    onSignOut: () => void;
  }

  let { me, onNavigate, onSignOut }: Props = $props();

  // Open by default — the events list is the main way people move around.
  let eventsExpanded = $state(true);

  const hasOrg = $derived(me.organizations.length > 0);
  const isOrgAdmin = $derived(me.organizations.some((org) => org.role === 'owner' || org.role === 'admin'));

  const quota = $derived(shellStore.quota);
  const storagePercent = $derived(
    quota && quota.storage.limitBytes > 0 ? (quota.storage.usedBytes / quota.storage.limitBytes) * 100 : 0,
  );
</script>

<nav id="sidebar" aria-label="Primary" class="flex h-full flex-col gap-1 overflow-y-auto pt-4 pe-3">
  <div class="flex flex-1 flex-col gap-1" onclick={onNavigate} role="none">
    {#if hasOrg}
      <NavbarItem title="Photos" href="/photos" icon={mdiImageMultipleOutline} activeIcon={mdiImageMultiple} />
      <NavbarItem title="Explore" href="/explore" icon={mdiMagnify} />
      <NavbarItem title="People" href="/people" icon={mdiAccountOutline} activeIcon={mdiAccount} />
      <NavbarItem title="Map" href="/map" icon={mdiMapOutline} activeIcon={mdiMap} />

      <!-- Events: the album-style expandable group. Its rows are covers, so it
           reads like Immich's Albums disclosure. -->
      <NavbarItem
        title="Events"
        href="/events"
        icon={{ icon: mdiImageAlbum, flipped: true }}
        bind:expanded={eventsExpanded}
      >
        {#snippet items()}
          <div class="mt-0.5 flex flex-col gap-0.5 ps-5">
            {#each shellStore.events as event (event.id)}
              <a
                href="/events/{event.id}"
                onclick={onNavigate}
                title="{event.name} — {event.assetCount} photo{event.assetCount === 1 ? '' : 's'}"
                class="hover:bg-subtle flex min-h-11 items-center gap-3 rounded-lg pe-3 ps-1 transition"
              >
                <div class="size-8 shrink-0 overflow-hidden rounded-md bg-subtle">
                  {#if event.coverUrl}
                    <img src={event.coverUrl} alt="" class="size-full object-cover" loading="lazy" />
                  {/if}
                </div>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm">{event.name}</span>
                  <span class="block truncate text-xs text-gray-500">
                    {event.assetCount.toLocaleString()}
                    {#if event.purgedAt}· deleted{:else if event.expiresAt && new Date(event.expiresAt) <= new Date()}· closed{/if}
                  </span>
                </span>
              </a>
            {:else}
              <p class="px-2 py-2 text-xs text-gray-500">No events yet.</p>
            {/each}
          </div>
        {/snippet}
      </NavbarItem>
    {/if}

    {#if isOrgAdmin}
      <NavbarItem title="Cloud accounts" href="/settings/cloud-accounts" icon={mdiCloudOutline} />
    {/if}

    {#if me.isSuperAdmin}
      <NavbarGroup title="Administration" size="tiny" />
      <NavbarItem title="Organizations" href="/admin/organizations" icon={mdiDomain} />
      <NavbarItem title="Jobs" href="/admin/jobs" icon={mdiCogOutline} activeIcon={mdiCog} />
      <NavbarItem title="GPU worker" href="/admin/gpu" icon={mdiExpansionCard} />
      <NavbarItem title="Logs" href="/admin/logs" icon={mdiTextBoxOutline} />
      <NavbarItem title="Support" href="/admin/support" icon={mdiLifebuoy} />
      <NavbarItem title="System" href="/admin/system" icon={mdiViewDashboard} />
    {/if}
  </div>

  <!-- Footer: storage, then identity + sign out. Mirrors Immich's BottomInfo /
       StorageSpace block at the foot of the rail. -->
  <div class="mt-2 flex flex-col gap-2 pb-4 ps-5">
    {#if hasOrg}
      <div class="me-1 rounded-lg bg-subtle p-4">
        <div class="mb-1 flex items-center justify-between gap-2 text-gray-600">
          <span class="flex items-center gap-2">
            <Icon icon={mdiHarddisk} size="1.125rem" />
            <span class="text-sm font-medium">Storage</span>
          </span>
          {#if quota}
            <!-- The plan is stated here rather than buried in settings: it is
                 the thing that explains the limit sitting right beside it. -->
            <span class="rounded-full bg-primary/15 px-2 py-0.5 text-[0.7rem] font-semibold uppercase text-primary">
              {quota.plan}
            </span>
          {/if}
        </div>

        {#if quota}
          <p class="text-sm text-gray-500">
            <span class="text-primary font-semibold">{formatBytes(quota.storage.usedBytes)}</span>
            of {formatBytes(quota.storage.limitBytes)}
          </p>
          <!-- Bar turns amber past 80% and red when full, so running out is
               visible before it blocks an upload mid-batch. -->
          <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-300/50">
            <div
              class="h-full rounded-full transition-all {storagePercent >= 100
                ? 'bg-red-500'
                : storagePercent >= 80
                  ? 'bg-amber-500'
                  : 'bg-primary'}"
              style="width: {Math.min(100, storagePercent)}%"
            ></div>
          </div>
          <p class="mt-2 text-xs text-gray-500">
            {quota.events.used} of {quota.events.limit} event{quota.events.limit === 1 ? '' : 's'} used
            {#if quota.events.remaining === 0}
              <span class="text-amber-600">· limit reached</span>
            {/if}
          </p>
          {#if quota.hasCustomLimits}
            <p class="mt-1 text-[0.7rem] text-gray-400">Custom limits</p>
          {/if}
        {:else}
          <!-- Quota unavailable: show real usage rather than an invented limit. -->
          <p class="text-sm text-gray-500">
            <span class="text-primary font-semibold">{formatBytes(shellStore.storage.bytes)}</span> ·
            {shellStore.storage.assets.toLocaleString()} photo{shellStore.storage.assets === 1 ? '' : 's'}
          </p>
        {/if}
      </div>
    {/if}

    <div class="flex items-center gap-3 pe-1">
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-xs font-bold text-primary"
      >
        {me.name
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase() ?? '')
          .join('')}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium">{me.name}</span>
        <span class="block truncate text-xs text-gray-500">{me.email}</span>
      </span>
      <button
        onclick={onSignOut}
        aria-label="Sign out"
        title="Sign out"
        class="hover:bg-subtle flex size-9 shrink-0 items-center justify-center rounded-full text-gray-600 transition"
      >
        <Icon icon={mdiLogout} size="1.25rem" />
      </button>
    </div>
  </div>
</nav>
