<script lang="ts">
  import { api, type ParticipantItem } from '$lib/api';
  import { Badge, IconButton, LoadingSpinner } from '@immich/ui';
  import { mdiAccountGroup, mdiDelete, mdiEmailSync } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';

  let { data } = $props();
  const eventId = data.event.id;

  let participants = $state<ParticipantItem[]>([]);
  let loading = $state(true);

  const statusColor: Record<string, 'success' | 'warning' | 'danger' | 'secondary'> = {
    matched: 'success',
    processing: 'warning',
    pending_match: 'secondary',
    no_face: 'danger',
  };

  async function refresh() {
    participants = await api.participants.list(eventId);
    loading = false;
  }

  async function resend(participant: ParticipantItem) {
    if (!confirm(`Regenerate the gallery link for ${participant.email} and resend the email? The old link stops working.`)) return;
    await api.participants.resend(eventId, participant.id);
    await refresh();
  }

  async function remove(participant: ParticipantItem) {
    if (!confirm(`Delete ${participant.email}? This erases their selfie, matches, and email history.`)) return;
    await api.participants.remove(eventId, participant.id);
    await refresh();
  }

  onMount(() => void refresh());
</script>

<svelte:head><title>Participants — {data.event.name}</title></svelte:head>

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else if participants.length === 0}
  <div class="rounded-2xl border border-dashed border-gray-300 p-16 text-center text-gray-500">
    <Icon icon={mdiAccountGroup} size="2.5rem" class="mx-auto mb-3 text-gray-300" />
    No participants yet — share the public link <span class="font-mono text-sm">/e/{data.event.slug}</span> with your guests.
  </div>
{:else}
  <div class="overflow-x-auto rounded-2xl border border-gray-200">
    <table class="w-full text-sm">
      <thead class="bg-immich-gray text-start text-xs text-gray-500">
        <tr>
          <th class="px-4 py-3 text-start font-medium">Email</th>
          <th class="px-4 py-3 text-start font-medium">Status</th>
          <th class="px-4 py-3 text-start font-medium">Matches</th>
          <th class="px-4 py-3 text-start font-medium">Last email</th>
          <th class="px-4 py-3 text-start font-medium">Signed up</th>
          <th class="px-4 py-3 text-end font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each participants as participant (participant.id)}
          <tr class="border-t border-gray-100">
            <td class="px-4 py-3 font-medium">{participant.email}</td>
            <td class="px-4 py-3">
              <Badge color={statusColor[participant.status] ?? 'secondary'} size="small">
                {participant.status.replace('_', ' ')}
              </Badge>
            </td>
            <td class="px-4 py-3">{participant.matchCount}</td>
            <td class="px-4 py-3 text-gray-500">
              {#if participant.lastEmailStatus}
                {participant.lastEmailStatus}
                {participant.lastEmailAt ? `· ${DateTime.fromISO(participant.lastEmailAt).toRelative()}` : ''}
              {:else}
                —
              {/if}
            </td>
            <td class="px-4 py-3 text-gray-500">{DateTime.fromISO(participant.createdAt).toRelative()}</td>
            <td class="px-4 py-3">
              <div class="flex justify-end gap-1">
                <IconButton
                  icon={mdiEmailSync}
                  aria-label="Regenerate link and resend"
                  size="small"
                  variant="ghost"
                  onclick={() => resend(participant)}
                />
                <IconButton
                  icon={mdiDelete}
                  aria-label="Delete participant"
                  size="small"
                  variant="ghost"
                  color="danger"
                  onclick={() => remove(participant)}
                />
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
