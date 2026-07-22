<script lang="ts">
  import { api, ApiError, type OrgSummary, type Organization } from '$lib/api';
  import { formatBytes } from '$lib/shell.svelte';
  import { Alert, Badge, Button, Heading, Input, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiPlus } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';

  let orgs = $state<OrgSummary[]>([]);
  let showCreate = $state(false);
  let error = $state('');
  let creating = $state(false);

  let name = $state('');
  let slug = $state('');
  let ownerEmail = $state('');
  let ownerName = $state('');
  let ownerPassword = $state('');

  // --- plan editing ---
  const GB = 1024 * 1024 * 1024;
  let planOrg = $state<Organization | null>(null);
  let planValue = $state<'starter' | 'pro' | 'enterprise'>('starter');
  let storageGb = $state('');
  let eventLimit = $state('');
  let planBusy = $state(false);
  let planError = $state('');

  function openPlan(org: Organization) {
    planOrg = org;
    planValue = org.plan;
    // Shown in GB because that is how the plans are sold; converted back on
    // save. Blank means "no override", which is not the same as zero.
    storageGb = org.storageLimitBytes === null ? '' : String(org.storageLimitBytes / GB);
    eventLimit = org.eventLimit === null ? '' : String(org.eventLimit);
    planError = '';
  }

  async function savePlan() {
    if (!planOrg) return;
    planBusy = true;
    planError = '';
    try {
      await api.admin.updatePlan(planOrg.id, {
        plan: planValue,
        // Only sent for Enterprise; the server clears them on any other plan
        // anyway, but sending them would be a confusing 400.
        ...(planValue === 'enterprise'
          ? {
              storageLimitBytes: storageGb.trim() === '' ? null : Math.round(Number(storageGb) * GB),
              eventLimit: eventLimit.trim() === '' ? null : Number(eventLimit),
            }
          : {}),
      });
      planOrg = null;
      await refresh();
    } catch (e) {
      planError = e instanceof ApiError ? e.message : 'Could not update the plan';
    } finally {
      planBusy = false;
    }
  }

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

  // --- password reset ---
  let resettingId = $state<string | null>(null);
  let resetNotice = $state('');

  async function resetPassword(org: OrgSummary) {
    if (!org.owner) {
      return;
    }
    // Spelled out because this is not undoable and locks the customer out
    // until they act on the email — an accidental click has a real cost at
    // the other end.
    if (
      !confirm(
        `Reset the password for ${org.owner.email}?\n\n` +
          `Their current password stops working immediately, they are signed out everywhere, ` +
          `and a one-time link is emailed to them. You will not see the new password.`,
      )
    ) {
      return;
    }
    resettingId = org.owner.id;
    resetNotice = '';
    error = '';
    try {
      await api.orgs.resetMemberPassword(org.id, org.owner.id);
      resetNotice = `Reset link sent to ${org.owner.email}.`;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not reset the password';
    } finally {
      resettingId = null;
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

<!-- Wraps rather than crushing the button against the heading on narrow
     screens; gap keeps them apart once wrapped. -->
<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
  <Heading size="large">Organizations</Heading>
  <Button leadingIcon={mdiPlus} onclick={openCreate}>New organization</Button>
</div>

{#if resetNotice}
  <div class="mb-4"><Alert color="success" title={resetNotice} /></div>
{/if}
{#if error && !showCreate}
  <div class="mb-4"><Alert color="danger" title={error} /></div>
{/if}

<div class="md-surface overflow-x-auto">
  <table class="w-full min-w-3xl text-sm">
    <thead class="bg-immich-gray text-xs text-gray-500">
      <tr>
        <th class="px-4 py-3 text-start font-medium">Organisation</th>
        <th class="px-4 py-3 text-start font-medium">Account holder</th>
        <th class="px-4 py-3 text-start font-medium">Status</th>
        <th class="px-4 py-3 text-start font-medium">Plan</th>
        <th class="px-4 py-3 text-start font-medium">Storage</th>
        <th class="px-4 py-3 text-start font-medium">Events</th>
        <th class="px-4 py-3 text-start font-medium">Created</th>
        <th class="px-4 py-3 text-end font-medium">Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each orgs as org (org.id)}
        {@const storage = org.usage.storage}
        {@const pct = storage.limitBytes > 0 ? (storage.usedBytes / storage.limitBytes) * 100 : 0}
        <tr class="border-t border-gray-100">
          <td class="px-4 py-3">
            <p class="font-medium">{org.name}</p>
            <p class="font-mono text-xs text-gray-500">{org.slug}</p>
          </td>
          <td class="px-4 py-3">
            {#if org.owner}
              <p>{org.owner.name}</p>
              <p class="text-xs text-gray-500">{org.owner.email}</p>
            {:else}
              <!-- Owner account deleted. Worth stating rather than leaving the
                   cell blank: this org has nobody who can sign in to it, which
                   is a thing to fix, not a rendering gap. -->
              <span class="text-xs text-amber-600">No active owner</span>
            {/if}
          </td>
          <td class="px-4 py-3">
            <Badge color={org.status === 'active' ? 'success' : 'danger'} size="small">{org.status}</Badge>
          </td>
          <td class="px-4 py-3">
            <span class="flex items-center gap-2">
              <Badge color={org.plan === 'enterprise' ? 'primary' : 'secondary'} size="small">{org.plan}</Badge>
              {#if org.storageLimitBytes !== null || org.eventLimit !== null}
                <span class="text-xs text-gray-500">custom</span>
              {/if}
            </span>
          </td>
          <!-- Used-of-allocated with the remainder spelled out. A bare
               percentage hides the number that actually matters when someone
               asks for more room. -->
          <td class="px-4 py-3">
            <p class="whitespace-nowrap">
              {formatBytes(storage.usedBytes)} <span class="text-gray-400">/ {formatBytes(storage.limitBytes)}</span>
            </p>
            <div class="mt-1 h-1 w-24 overflow-hidden rounded-full bg-gray-200">
              <div
                class="h-full rounded-full {pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-primary'}"
                style="width: {Math.min(100, pct)}%"
              ></div>
            </div>
            <p class="mt-0.5 text-xs text-gray-500">{formatBytes(storage.remainingBytes)} free</p>
          </td>
          <td class="px-4 py-3 whitespace-nowrap">
            {org.usage.events.used} <span class="text-gray-400">/ {org.usage.events.limit}</span>
            <p class="text-xs text-gray-500">{org.usage.events.remaining} left</p>
          </td>
          <td class="px-4 py-3 text-gray-500">{DateTime.fromISO(org.createdAt).toLocaleString(DateTime.DATE_MED)}</td>
          <td class="px-4 py-3 text-end">
            <Button size="small" variant="ghost" onclick={() => openPlan(org)}>Plan</Button>
            <Button size="small" variant="ghost" color={org.status === 'active' ? 'danger' : 'primary'} onclick={() => toggleSuspend(org)}>
              {org.status === 'active' ? 'Suspend' : 'Reactivate'}
            </Button>
            <!-- Only offered when there is an account holder to email — with no
                 owner there is no inbox to send the link to. -->
            {#if org.owner}
              <Button
                size="small"
                variant="ghost"
                disabled={resettingId === org.owner.id}
                onclick={() => resetPassword(org)}
              >
                {resettingId === org.owner.id ? 'Sending…' : 'Reset password'}
              </Button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if planOrg}
  <Modal title="Plan — {planOrg.name}" size="small" onClose={() => (planOrg = null)}>
    <ModalBody>
      {#if planError}<div class="mb-3"><Alert color="danger" title={planError} /></div>{/if}
      <div class="flex flex-col gap-4">
        <div>
          <label for="plan" class="immich-form-label mb-1 block text-sm">Plan</label>
          <select id="plan" bind:value={planValue} class="bg-subtle w-full rounded-xl px-3 py-2 text-sm">
            <option value="starter">Starter — 2 GB, 1 event</option>
            <option value="pro">Pro — 10 GB, 5 events</option>
            <option value="enterprise">Enterprise — negotiated</option>
          </select>
        </div>

        {#if planValue === 'enterprise'}
          <!-- Only shown for Enterprise: Starter and Pro are fixed products,
               and the server rejects overrides on them rather than silently
               ignoring the fields. -->
          <div>
            <label for="storage-gb" class="immich-form-label mb-1 block text-sm">Storage (GB)</label>
            <Input id="storage-gb" type="number" bind:value={storageGb} placeholder="50" />
            <p class="mt-1 text-xs text-gray-400">Blank uses the Enterprise default of 50 GB.</p>
          </div>
          <div>
            <label for="event-limit" class="immich-form-label mb-1 block text-sm">Events</label>
            <Input id="event-limit" type="number" bind:value={eventLimit} placeholder="10" />
            <p class="mt-1 text-xs text-gray-400">Blank uses the Enterprise default of 10.</p>
          </div>
        {:else}
          <p class="text-sm text-gray-500">
            Custom limits are Enterprise-only. Switching to Enterprise lets you set them; switching away clears
            any that were set.
          </p>
        {/if}
      </div>
    </ModalBody>
    <ModalFooter>
      <Button variant="outline" onclick={() => (planOrg = null)}>Cancel</Button>
      <Button disabled={planBusy} onclick={savePlan}>Save</Button>
    </ModalFooter>
  </Modal>
{/if}

{#if showCreate}
  <Modal title="New organization" size="small" onClose={() => (showCreate = false)}>
    <ModalBody>
      {#if error}<div class="mb-3"><Alert color="danger" title={error} /></div>{/if}
      <div class="flex flex-col gap-4">
        <div>
          <label for="org-name" class="immich-form-label mb-1 block text-sm">Organization name</label>
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
          <label for="owner-name" class="immich-form-label mb-1 block text-sm">Owner's full name</label>
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
