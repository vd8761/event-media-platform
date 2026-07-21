<script lang="ts">
  // Super-admin support inbox. Messages arrive from the organiser Help dialog
  // and from the public event pages; both land here, and the email is only a
  // notification on top of this list.
  import { api, type SupportTicket } from '$lib/api';
  import { Badge, Button, Heading, LoadingSpinner } from '@immich/ui';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';

  let tickets = $state<SupportTicket[]>([]);
  let loading = $state(true);
  let filter = $state<'all' | 'open' | 'resolved'>('open');
  let busyId = $state('');

  async function refresh() {
    loading = true;
    tickets = await api.admin.supportTickets(filter === 'all' ? undefined : filter).catch(() => []);
    loading = false;
  }

  async function setStatus(ticket: SupportTicket, status: 'open' | 'resolved') {
    busyId = ticket.id;
    await api.admin.updateSupportTicket(ticket.id, status);
    busyId = '';
    await refresh();
  }

  const formatWhen = (value: string) => DateTime.fromISO(value).toLocaleString(DateTime.DATETIME_MED);

  onMount(() => void refresh());
</script>

<svelte:head><title>Support — EventLens</title></svelte:head>

<Heading size="large" class="mb-1">Support</Heading>
<p class="md-body-medium mb-6 text-gray-500">Messages from organisers and from public event pages.</p>

<div class="mb-4 flex flex-wrap gap-2">
  {#each ['open', 'resolved', 'all'] as option (option)}
    <Button
      size="small"
      shape="round"
      variant={filter === option ? 'filled' : 'outline'}
      color={filter === option ? 'primary' : 'secondary'}
      onclick={() => {
        filter = option as typeof filter;
        void refresh();
      }}
    >
      {option[0].toUpperCase() + option.slice(1)}
    </Button>
  {/each}
</div>

{#if loading}
  <div class="flex justify-center py-16"><LoadingSpinner /></div>
{:else if tickets.length === 0}
  <p class="md-body-medium py-16 text-center text-gray-500">Nothing here.</p>
{:else}
  <div class="flex flex-col gap-3">
    {#each tickets as ticket (ticket.id)}
      <article class="md-surface p-4">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <Badge color={ticket.source === 'organization' ? 'primary' : 'secondary'} size="small">
            {ticket.source === 'organization' ? 'Organiser' : 'Public'}
          </Badge>
          {#if ticket.status === 'resolved'}
            <Badge color="success" size="small">Resolved</Badge>
          {/if}
          <span class="md-label-medium text-gray-500">{formatWhen(ticket.createdAt)}</span>
        </div>

        <!-- Message is user-supplied text, so it stays plain and wraps as
             written rather than being rendered as markup. -->
        <p class="md-body-medium whitespace-pre-wrap break-words">{ticket.message}</p>

        <div class="md-label-medium mt-3 flex flex-wrap gap-x-4 gap-y-1 text-gray-500">
          <span>
            {ticket.userName ?? ticket.name ?? 'Anonymous'}
            {#if ticket.userEmail ?? ticket.email}
              · <a class="hover:underline" href="mailto:{ticket.userEmail ?? ticket.email}">
                {ticket.userEmail ?? ticket.email}
              </a>
            {/if}
          </span>
          {#if ticket.orgName}<span>Org: {ticket.orgName}</span>{/if}
          {#if ticket.eventName}<span>Event: {ticket.eventName}</span>{/if}
        </div>

        <div class="mt-3 flex gap-2">
          {#if ticket.status === 'open'}
            <Button
              size="small"
              shape="round"
              variant="outline"
              loading={busyId === ticket.id}
              onclick={() => setStatus(ticket, 'resolved')}
            >
              Mark resolved
            </Button>
          {:else}
            <Button
              size="small"
              shape="round"
              variant="outline"
              color="secondary"
              loading={busyId === ticket.id}
              onclick={() => setStatus(ticket, 'open')}
            >
              Reopen
            </Button>
          {/if}
          {#if ticket.userEmail ?? ticket.email}
            <Button size="small" shape="round" variant="ghost" href="mailto:{ticket.userEmail ?? ticket.email}">
              Reply by email
            </Button>
          {/if}
        </div>
      </article>
    {/each}
  </div>
{/if}
