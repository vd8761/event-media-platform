<script lang="ts">
  import { page } from '$app/state';
  import { Badge, IconButton } from '@immich/ui';
  import { mdiOpenInNew } from '@mdi/js';

  let { data, children } = $props();

  const tabs = $derived([
    { href: `/events/${data.event.id}`, label: 'Gallery', exact: true },
    { href: `/events/${data.event.id}/people`, label: 'People', exact: false },
    { href: `/events/${data.event.id}/participants`, label: 'Participants', exact: false },
    { href: `/events/${data.event.id}/imports`, label: 'Imports', exact: false },
    { href: `/events/${data.event.id}/settings`, label: 'Settings', exact: false },
  ]);

  const isActive = (tab: { href: string; exact: boolean }) =>
    tab.exact ? page.url.pathname === tab.href : page.url.pathname.startsWith(tab.href);

  const statusColor: Record<string, 'success' | 'warning' | 'secondary'> = {
    active: 'success',
    draft: 'warning',
    closed: 'secondary',
  };
</script>

<div class="mb-6">
  <div class="mb-2 flex min-w-0 items-center gap-2 sm:gap-3">
    <h1 class="md-headline-small min-w-0 truncate">{data.event.name}</h1>
    <Badge color={statusColor[data.event.status] ?? 'secondary'}>{data.event.status}</Badge>
    {#if data.event.status === 'active' && data.event.participantPageEnabled}
      <IconButton
        icon={mdiOpenInNew}
        aria-label="Open public page"
        size="small"
        variant="ghost"
        color="secondary"
        href={`/e/${data.event.slug}`}
        target="_blank"
      />
    {/if}
  </div>

  <!-- scrollable tab strip so all five stay reachable on a phone -->
  <nav class="immich-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-gray-200 px-4 sm:mx-0 sm:px-0">
    {#each tabs as tab (tab.href)}
      <a
        href={tab.href}
        class="md-label-large flex min-h-12 shrink-0 items-center border-b-2 px-4 transition
          {isActive(tab)
          ? 'border-immich-primary text-immich-primary'
          : 'border-transparent text-gray-600 hover:text-gray-900'}"
      >
        {tab.label}
      </a>
    {/each}
  </nav>
</div>

{@render children()}
