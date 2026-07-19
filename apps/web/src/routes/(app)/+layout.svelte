<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { Icon } from '@immich/ui';
  import {
    mdiCalendarMultiple,
    mdiCloudOutline,
    mdiDomain,
    mdiLogout,
    mdiSync,
    mdiViewDashboard,
  } from '@mdi/js';

  let { data, children } = $props();

  const isOrgAdmin = $derived(
    data.me.isSuperAdmin || data.me.organizations.some((org) => org.role === 'owner' || org.role === 'admin'),
  );

  const navItems = $derived([
    { href: '/events', label: 'Events', icon: mdiCalendarMultiple, show: true },
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

<div class="flex min-h-screen bg-immich-bg">
  <aside class="fixed inset-y-0 start-0 z-10 flex w-60 flex-col border-e border-gray-100 bg-immich-gray px-3 py-5">
    <a href="/events" class="mb-8 flex items-center gap-3 px-3">
      <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-immich-primary text-sm font-bold text-white">
        EL
      </div>
      <span class="text-lg font-semibold text-immich-primary">EventLens</span>
    </a>

    <nav class="flex flex-1 flex-col gap-1">
      {#each navItems.filter((item) => item.show) as item (item.href)}
        <a
          href={item.href}
          class="flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition
            {page.url.pathname.startsWith(item.href)
            ? 'bg-immich-primary/15 text-immich-primary'
            : 'text-gray-600 hover:bg-gray-200/60'}"
        >
          <Icon icon={item.icon} size="1.25rem" />
          {item.label}
        </a>
      {/each}
    </nav>

    <div class="border-t border-gray-200 pt-3">
      <div class="mb-2 px-4">
        <p class="truncate text-sm font-medium">{data.me.name}</p>
        <p class="truncate text-xs text-gray-500">{data.me.email}</p>
      </div>
      <button
        onclick={logout}
        class="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-200/60"
      >
        <Icon icon={mdiLogout} size="1.25rem" />
        Sign out
      </button>
    </div>
  </aside>

  <main class="ms-60 min-h-screen flex-1 px-8 py-6">
    {@render children()}
  </main>
</div>
