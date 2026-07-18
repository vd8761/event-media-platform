<script lang="ts">
  import { api, ApiError, type Organization } from '$lib/api';
  import { Alert, Badge, Button, Heading, Input, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiPlus } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';

  let orgs = $state<Organization[]>([]);
  let showCreate = $state(false);
  let error = $state('');
  let creating = $state(false);

  let name = $state('');
  let slug = $state('');
  let ownerEmail = $state('');
  let ownerName = $state('');
  let ownerPassword = $state('');

  function slugify(value: string) {
    return value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '');
  }

  async function refresh() {
    orgs = await api.admin.listOrgs();
  }

  function openCreate() {
    name = slug = ownerEmail = ownerName = ownerPassword = '';
    error = '';
    showCreate = true;
  }

  async function create() {
    error = '';
    creating = true;
    try {
      await api.admin.createOrg({
        name,
        slug,
        owner: { email: ownerEmail, name: ownerName, password: ownerPassword || undefined },
      });
      showCreate = false;
      await refresh();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to create organization';
    } finally {
      creating = false;
    }
  }

  async function toggleSuspend(org: Organization) {
    const next = org.status === 'active' ? 'suspended' : 'active';
    if (!confirm(`Set ${org.name} to ${next}?`)) return;
    await api.admin.updateOrg(org.id, { status: next });
    await refresh();
  }

  onMount(() => void refresh());
</script>

<svelte:head><title>Organizations — EventLens</title></svelte:head>

<div class="mb-6 flex items-center justify-between">
  <Heading size="large">Organizations</Heading>
  <Button leadingIcon={mdiPlus} onclick={openCreate}>New organization</Button>
</div>

<div class="overflow-x-auto rounded-2xl border border-gray-200">
  <table class="w-full text-sm">
    <thead class="bg-immich-gray text-xs text-gray-500">
      <tr>
        <th class="px-4 py-3 text-start font-medium">Name</th>
        <th class="px-4 py-3 text-start font-medium">Slug</th>
        <th class="px-4 py-3 text-start font-medium">Status</th>
        <th class="px-4 py-3 text-start font-medium">Created</th>
        <th class="px-4 py-3 text-end font-medium">Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each orgs as org (org.id)}
        <tr class="border-t border-gray-100">
          <td class="px-4 py-3 font-medium">{org.name}</td>
          <td class="px-4 py-3 font-mono text-xs text-gray-500">{org.slug}</td>
          <td class="px-4 py-3">
            <Badge color={org.status === 'active' ? 'success' : 'danger'} size="small">{org.status}</Badge>
          </td>
          <td class="px-4 py-3 text-gray-500">{DateTime.fromISO(org.createdAt).toLocaleString(DateTime.DATE_MED)}</td>
          <td class="px-4 py-3 text-end">
            <Button size="small" variant="ghost" color={org.status === 'active' ? 'danger' : 'primary'} onclick={() => toggleSuspend(org)}>
              {org.status === 'active' ? 'Suspend' : 'Reactivate'}
            </Button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if showCreate}
  <Modal title="New organization" size="small" onClose={() => (showCreate = false)}>
    <ModalBody>
      {#if error}<div class="mb-3"><Alert color="danger" title={error} /></div>{/if}
      <div class="flex flex-col gap-4">
        <div>
          <label for="org-name" class="immich-form-label mb-1 block text-sm">Name</label>
          <Input id="org-name" bind:value={name} oninput={() => (slug = slugify(name))} />
        </div>
        <div>
          <label for="org-slug" class="immich-form-label mb-1 block text-sm">Slug</label>
          <Input id="org-slug" bind:value={slug} />
        </div>
        <p class="immich-form-label pt-2 text-sm">Initial owner</p>
        <div>
          <label for="owner-email" class="immich-form-label mb-1 block text-sm">Email</label>
          <Input id="owner-email" type="email" bind:value={ownerEmail} />
        </div>
        <div>
          <label for="owner-name" class="immich-form-label mb-1 block text-sm">Name</label>
          <Input id="owner-name" bind:value={ownerName} />
        </div>
        <div>
          <label for="owner-password" class="immich-form-label mb-1 block text-sm">Password (for new users)</label>
          <Input id="owner-password" type="password" bind:value={ownerPassword} placeholder="leave empty if the user exists" />
        </div>
      </div>
    </ModalBody>
    <ModalFooter>
      <Button fullWidth disabled={creating || !name || !slug || !ownerEmail || !ownerName} loading={creating} onclick={create}>
        Create organization
      </Button>
    </ModalFooter>
  </Modal>
{/if}
