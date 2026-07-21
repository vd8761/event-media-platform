<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import UploadPanel from '$lib/components/UploadPanel.svelte';
  import { shellStore } from '$lib/shell.svelte';
  import { uploadStore } from '$lib/uploads.svelte';

  let { data, children } = $props();

  // Mobile: the rail collapses into a dismissable drawer (MD3 modal nav drawer).
  let drawerOpen = $state(false);

  // A super admin administers organizations but has no access to the events
  // inside them, so the event-side nav is driven purely by real memberships —
  // which a super admin normally has none of.
  const activeOrgId = $derived(data.me.organizations[0]?.id ?? null);

  // Sidebar events and the storage footer load once per organization rather
  // than per route, so moving between pages does not re-flash the shell.
  $effect(() => {
    void shellStore.load(activeOrgId);
  });

  // The queue survives client-side navigation on its own — it lives outside
  // every component. A real page unload is the one thing that still kills it,
  // so that is the only case worth interrupting the user for.
  function guardUnload(event: BeforeUnloadEvent) {
    if (uploadStore.hasActive) {
      event.preventDefault();
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    await goto('/login');
  }
</script>

<div class="bg-immich-bg flex min-h-screen flex-col">
  <!-- Top bar spans the full width; the sidebar sits beneath it, matching
       Immich's layout. -->
  <TopBar me={data.me} onOpenDrawer={() => (drawerOpen = true)} onSignOut={logout} />

  <div class="relative flex min-h-0 flex-1">
    <!-- scrim behind the mobile drawer (starts below the top bar) -->
    {#if drawerOpen}
      <button
        data-md-raw
        class="fixed inset-x-0 bottom-0 top-16 z-20 bg-black/40 lg:hidden"
        aria-label="Close navigation"
        onclick={() => (drawerOpen = false)}
      ></button>
    {/if}

    <!-- Off-canvas below lg, pinned open from lg up. Sits under the top bar and
         stays put while the main column scrolls (sticky, own scroll). The
         hide/show uses plain `-translate-x-full` + `lg:translate-x-0`: the
         ltr:/rtl: variants are emitted after the lg: media query, so they win
         at every width and left the rail off-screen on desktop. -->
    <aside
      class="bg-light fixed bottom-0 start-0 top-16 z-30 flex w-[min(100vw,16rem)] flex-col border-e border-gray-200
        lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:w-64
        transition-transform duration-300 lg:translate-x-0
        {drawerOpen ? 'translate-x-0' : '-translate-x-full'}"
    >
      <Sidebar me={data.me} onNavigate={() => (drawerOpen = false)} onSignOut={logout} />
    </aside>

    <main class="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      {@render children()}
    </main>
  </div>
</div>

<!-- Rendered from the layout, not from the event page: uploads continue across
     navigation, so the panel has to outlive the route that started them. -->
<UploadPanel uploads={uploadStore.items} duplicates={uploadStore.duplicates} onDismiss={() => uploadStore.dismiss()} />

<svelte:window onbeforeunload={guardUnload} />
