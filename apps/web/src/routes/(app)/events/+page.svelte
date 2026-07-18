<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { Alert, Badge, Button, Heading, Input, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiPlus } from '@mdi/js';
  import { DateTime } from 'luxon';

  let { data } = $props();

  let showCreate = $state(false);
  let name = $state('');
  let slug = $state('');
  let orgId = $state('');
  let error = $state('');
  let creating = $state(false);

  const creatableOrgs = $derived(
    data.me.isSuperAdmin
      ? data.me.organizations
      : data.me.organizations.filter((org) => org.role === 'owner' || org.role === 'admin'),
  );

  function slugify(value: string) {
    return value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '');
  }

  function openCreate() {
    name = '';
    slug = '';
    orgId = creatableOrgs[0]?.id ?? '';
    error = '';
    showCreate = true;
  }

  async function create() {
    error = '';
    creating = true;
    try {
      await api.events.create(orgId, { name, slug });
      showCreate = false;
      await invalidateAll();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to create event';
    } finally {
      creating = false;
    }
  }

  const statusColor: Record<string, 'success' | 'warning' | 'secondary'> = {
    active: 'success',
    draft: 'warning',
    closed: 'secondary',
  };
</script>

<svelte:head><title>Events — EventLens</title></svelte:head>

<div class="mb-6 flex items-center justify-between">
  <Heading size="large">Events</Heading>
  {#if creatableOrgs.length > 0}
    <Button leadingIcon={mdiPlus} onclick={openCreate}>New event</Button>
  {/if}
</div>

{#if data.events.length === 0}
  <div class="rounded-2xl border border-dashed border-gray-300 p-16 text-center text-gray-500">
    No events yet{creatableOrgs.length > 0 ? ' — create your first one.' : '.'}
  </div>
{:else}
  <div class="grid grid-auto-fill-72 gap-4">
    {#each data.events as event (event.id)}
      <a
        href={`/events/${event.id}`}
        class="rounded-2xl border border-gray-200 p-5 transition hover:border-immich-primary/50 hover:shadow-md"
      >
        <div class="mb-2 flex items-start justify-between gap-2">
          <h2 class="text-lg font-semibold">{event.name}</h2>
          <Badge color={statusColor[event.status] ?? 'secondary'}>{event.status}</Badge>
        </div>
        {#if event.orgName}<p class="text-xs text-gray-400">{event.orgName}</p>{/if}
        <p class="mt-2 text-sm text-gray-500">
          {event.startsAt ? DateTime.fromISO(event.startsAt).toLocaleString(DateTime.DATE_MED) : 'No date set'}
        </p>
        <p class="mt-1 text-xs text-gray-400">/e/{event.slug}</p>
      </a>
    {/each}
  </div>
{/if}

{#if showCreate}
  <Modal title="New event" size="small" onClose={() => (showCreate = false)}>
    <ModalBody>
    {#if error}
      <div class="mb-3"><Alert color="danger" title={error} /></div>
    {/if}
    <div class="flex flex-col gap-4">
      {#if creatableOrgs.length > 1}
        <div>
          <label for="org" class="immich-form-label mb-1 block text-sm">Organization</label>
          <select id="org" bind:value={orgId} class="immich-form-input">
            {#each creatableOrgs as org (org.id)}
              <option value={org.id}>{org.name}</option>
            {/each}
          </select>
        </div>
      {/if}
      <div>
        <label for="event-name" class="immich-form-label mb-1 block text-sm">Name</label>
        <Input
          id="event-name"
          bind:value={name}
          oninput={() => (slug = slugify(name))}
          placeholder="Summer Gala 2026"
        />
      </div>
      <div>
        <label for="event-slug" class="immich-form-label mb-1 block text-sm">Public link slug</label>
        <Input id="event-slug" bind:value={slug} placeholder="summer-gala-2026" />
        <p class="mt-1 text-xs text-gray-400">Participants will use /e/{slug || '…'}</p>
      </div>
    </div>
    </ModalBody>
    <ModalFooter>
      <Button fullWidth disabled={creating || !name || !slug || !orgId} loading={creating} onclick={create}>
        Create event
      </Button>
    </ModalFooter>
  </Modal>
{/if}
