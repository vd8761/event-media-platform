<script lang="ts">
  import { api, type PersonItem } from '$lib/api';
  import { Button, IconButton, Input, LoadingSpinner, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiAccountOff, mdiEye, mdiEyeOff, mdiPencil } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { onMount } from 'svelte';

  let { data } = $props();
  const eventId = data.event.id;

  let people = $state<PersonItem[]>([]);
  let loading = $state(true);
  let selected = $state<PersonItem | null>(null);
  let selectedAssets = $state<{ id: string; thumbUrl: string | null; originalFilename: string }[]>([]);
  let renameTarget = $state<PersonItem | null>(null);
  let renameValue = $state('');

  async function refresh() {
    people = await api.people.list(eventId);
    loading = false;
  }

  async function openPerson(person: PersonItem) {
    selected = person;
    selectedAssets = [];
    selectedAssets = await api.people.assets(eventId, person.id);
  }

  async function toggleHidden(person: PersonItem) {
    await api.people.update(eventId, person.id, { isHidden: !person.isHidden });
    await refresh();
  }

  async function saveRename() {
    if (!renameTarget) return;
    await api.people.update(eventId, renameTarget.id, { name: renameValue });
    renameTarget = null;
    await refresh();
  }

  onMount(() => void refresh());
</script>

<svelte:head><title>People — {data.event.name}</title></svelte:head>

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else if people.length === 0}
  <div class="rounded-2xl border border-dashed border-gray-300 p-16 text-center text-gray-500">
    <Icon icon={mdiAccountOff} size="2.5rem" class="mx-auto mb-3 text-gray-300" />
    No people detected yet — clusters appear once photos with the same face are processed.
  </div>
{:else}
  <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
    {#each people as person (person.id)}
      <div class="group relative text-center {person.isHidden ? 'opacity-40' : ''}">
        <button class="w-full" onclick={() => openPerson(person)}>
          {#if person.thumbnailUrl}
            <img
              src={person.thumbnailUrl}
              alt={person.name || 'Unnamed person'}
              class="mx-auto aspect-square w-full rounded-full object-cover shadow"
            />
          {:else}
            <div class="mx-auto flex aspect-square w-full items-center justify-center rounded-full bg-gray-100 text-gray-400">
              <LoadingSpinner />
            </div>
          {/if}
          <p class="mt-2 truncate text-sm font-medium">{person.name || 'Unnamed'}</p>
          <p class="text-xs text-gray-400">{person.faceCount} photo{person.faceCount === 1 ? '' : 's'}</p>
        </button>
        <div class="absolute end-1 top-1 hidden gap-1 group-hover:flex">
          <IconButton
            icon={mdiPencil}
            aria-label="Rename"
            size="tiny"
            onclick={() => {
              renameTarget = person;
              renameValue = person.name;
            }}
          />
          <IconButton
            icon={person.isHidden ? mdiEye : mdiEyeOff}
            aria-label={person.isHidden ? 'Show' : 'Hide'}
            size="tiny"
            color="secondary"
            onclick={() => toggleHidden(person)}
          />
        </div>
      </div>
    {/each}
  </div>
{/if}

{#if selected}
  <Modal title={selected.name || 'Unnamed person'} size="large" onClose={() => (selected = null)}>
    <ModalBody>
      {#if selectedAssets.length === 0}
        <div class="flex justify-center py-10"><LoadingSpinner /></div>
      {:else}
        <div class="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-1.5">
          {#each selectedAssets as asset (asset.id)}
            {#if asset.thumbUrl}
              <img src={asset.thumbUrl} alt={asset.originalFilename} class="aspect-square w-full rounded-lg object-cover" />
            {/if}
          {/each}
        </div>
      {/if}
    </ModalBody>
  </Modal>
{/if}

{#if renameTarget}
  <Modal title="Rename person" size="tiny" onClose={() => (renameTarget = null)}>
    <ModalBody>
      <Input bind:value={renameValue} placeholder="Name" />
    </ModalBody>
    <ModalFooter>
      <Button fullWidth onclick={saveRename}>Save</Button>
    </ModalFooter>
  </Modal>
{/if}
