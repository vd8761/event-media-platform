<script lang="ts">
  import { page } from '$app/state';
  import { Badge, Heading, IconButton } from '@immich/ui';
  import { mdiOpenInNew } from '@mdi/js';

  let { data, children } = $props();

  const tabs = $derived([
    { href: `/events/${data.event.id}`, label: 'Gallery', exact: true },
    { href: `/events/${data.event.id}/people`, label: 'People', exact: false },
    { href: `/events/${data.event.id}/participants`, label: 'Participants', exact: false },
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
  <div class="mb-1 flex items-center gap-3">
    <Heading size="large">{data.event.name}</Heading>
    <Badge color={statusColor[data.event.status] ?? 'secondary'}>{data.event.status}</Badge>
    {#if data.event.status === 'active' && data.event.participantPageEnabled}
      <IconButton
        icon={mdiOpenInNew}
        aria-label="Open public page"
        size="small"
        variant="ghost"
        href={`/e/${data.event.slug}`}
        target="_blank"
      />
    {/if}
  </div>

  <nav class="flex gap-1 border-b border-gray-200">
    {#each tabs as tab (tab.href)}
      <a
        href={tab.href}
        class="border-b-2 px-4 py-2.5 text-sm font-medium transition
          {isActive(tab)
          ? 'border-immich-primary text-immich-primary'
          : 'border-transparent text-gray-500 hover:text-gray-800'}"
      >
        {tab.label}
      </a>
    {/each}
  </nav>
</div>

{@render children()}
