<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { Icon, IconButton } from '@immich/ui';
  import {
    mdiCalendarMultiple,
    mdiCloudOutline,
    mdiDomain,
    mdiLogout,
    mdiMenu,
    mdiSync,
    mdiViewDashboard,
  } from '@mdi/js';

  let { data, children } = $props();

  // Mobile: the rail collapses into a dismissable drawer (MD3 modal nav drawer).
  let drawerOpen = $state(false);

  // A super admin administers organizations but has no access to the events
  // inside them, so the event-side nav is driven purely by real memberships —
  // which a super admin normally has none of. Showing those links anyway would
  // lead to pages the API answers with 403.
  const isOrgAdmin = $derived(
    data.me.organizations.some((org) => org.role === 'owner' || org.role === 'admin'),
  );
  const hasOrgMembership = $derived(data.me.organizations.length > 0);
  const homeHref = $derived(hasOrgMembership ? '/events' : '/admin/organizations');

  const navItems = $derived([
    { href: '/events', label: 'Events', icon: mdiCalendarMultiple, show: hasOrgMembership },
    { href: '/settings/cloud-accounts', label: 'Cloud accounts', icon: mdiCloudOutline, show: isOrgAdmin },
    { href: '/admin/organizations', label: 'Organizations', icon: mdiDomain, show: data.me.isSuperAdmin },
    { href: '/admin/jobs', label: 'Jobs', icon: mdiSync, show: data.me.isSuperAdmin },
    { href: '/admin/system', label: 'System', icon: mdiViewDashboard, show: data.me.isSuperAdmin },
  ]);

  async function logout() {
    await api.logout().catch(() => undefined);
    await goto('/login');
  }
</script>

<div class="bg-immich-bg flex min-h-screen">
  <!-- scrim behind the mobile drawer -->
  {#if drawerOpen}
    <button
      data-md-raw
      class="fixed inset-0 z-20 bg-black/40 lg:hidden"
      aria-label="Close navigation"
      onclick={() => (drawerOpen = false)}
    ></button>
  {/if}

  <!-- Off-canvas below lg, pinned open from lg up. The hide/show uses plain
       `-translate-x-full` + `lg:translate-x-0`: the ltr:/rtl: variants are
       emitted after the lg: media query, so they win at every width and left
       the rail off-screen on desktop. -->
  <aside
    class="bg-immich-gray fixed inset-y-0 start-0 z-30 flex w-72 flex-col border-e border-gray-100 px-3 py-5
      transition-transform duration-300 lg:w-60 lg:translate-x-0
      {drawerOpen ? 'translate-x-0' : '-translate-x-full'}"
  >
    <a href={homeHref} class="mb-8 flex items-center gap-3 px-3" onclick={() => (drawerOpen = false)}>
      <div class="bg-immich-primary flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-bold text-white">
        EL
      </div>
      <span class="md-title-large text-immich-primary">EventLens</span>
    </a>

    <nav class="flex flex-1 flex-col gap-1">
      {#each navItems.filter((item) => item.show) as item (item.href)}
        <a
          href={item.href}
          onclick={() => (drawerOpen = false)}
          class="md-label-large flex min-h-14 items-center gap-3 rounded-full px-4 transition
            {page.url.pathname.startsWith(item.href)
            ? 'bg-immich-primary/15 text-immich-primary'
            : 'text-gray-700 hover:bg-gray-200/60'}"
        >
          <Icon icon={item.icon} size="1.375rem" />
          {item.label}
        </a>
      {/each}
    </nav>

    <div class="border-t border-gray-200 pt-3">
      <div class="mb-2 px-4">
        <p class="md-title-small truncate">{data.me.name}</p>
        <p class="md-body-medium truncate text-gray-500">{data.me.email}</p>
      </div>
      <button
        onclick={logout}
        class="md-label-large flex min-h-14 w-full items-center gap-3 rounded-full px-4 text-gray-700 transition hover:bg-gray-200/60"
      >
        <Icon icon={mdiLogout} size="1.375rem" />
        Sign out
      </button>
    </div>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col lg:ms-60">
    <!-- top app bar (mobile only) -->
    <header
      class="bg-immich-bg/95 sticky top-0 z-10 flex min-h-16 items-center gap-2 border-b border-gray-100 px-2 backdrop-blur lg:hidden"
    >
      <IconButton icon={mdiMenu} aria-label="Open navigation" variant="ghost" color="secondary" onclick={() => (drawerOpen = true)} />
      <span class="md-title-medium text-immich-primary">EventLens</span>
    </header>

    <main class="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      {@render children()}
    </main>
  </div>
</div>
