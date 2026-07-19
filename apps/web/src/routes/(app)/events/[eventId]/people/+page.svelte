<script lang="ts">
  import { api, type AssetItem, type PersonItem, type ProcessingStatus } from '$lib/api';
  import ProcessingBar from '$lib/components/ProcessingBar.svelte';
  import { Badge, Button, Icon, IconButton, Input, LoadingSpinner, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiAccountOff, mdiEye, mdiEyeOff, mdiPencil } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';

  let { data } = $props();
  const eventId = data.event.id;
  const canManage = $derived(
    data.me.isSuperAdmin ||
      ['owner', 'admin'].includes(data.me.organizations.find((org) => org.id === data.event.orgId)?.role ?? ''),
  );

  let people = $state<PersonItem[]>([]);
  let processing = $state<ProcessingStatus | null>(null);
  let loading = $state(true);
  let selected = $state<PersonItem | null>(null);
  let selectedAssets = $state<{ id: string; thumbUrl: string | null; originalFilename: string }[]>([]);
  let renameTarget = $state<PersonItem | null>(null);
  let renameValue = $state('');

  // Per-photo face-detection state — "what is running and what is not".
  type Tab = 'pending' | 'found' | 'none';
  let tab = $state<Tab>('pending');
  let photos = $state<AssetItem[]>([]);
  let photosLoading = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  const tabs: { id: Tab; label: string; count: (status: ProcessingStatus) => number }[] = [
    { id: 'pending', label: 'Awaiting detection', count: (status) => status.assets.pendingDetection },
    { id: 'found', label: 'Faces found', count: (status) => status.assets.withFaces },
    { id: 'none', label: 'No faces', count: (status) => status.assets.withoutFaces },
  ];

  async function loadPhotos() {
    photosLoading = true;
    try {
      const { assets } = await api.assets.list(eventId, undefined, 60, tab);
      photos = assets;
    } finally {
      photosLoading = false;
    }
  }

  async function refresh() {
    [people, processing] = await Promise.all([api.people.list(eventId), api.events.processing(eventId)]);
    loading = false;
    schedulePolling();
  }

  // Keep refreshing while detection still has work left, so the operator can
  // watch it drain instead of guessing.
  function schedulePolling() {
    const busy = (processing?.assets.pendingDetection ?? 0) > 0 || (processing?.assets.pendingMedia ?? 0) > 0;
    if (busy && !timer) {
      timer = setInterval(async () => {
        await refresh();
        await loadPhotos();
      }, 5000);
    } else if (!busy && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  async function selectTab(next: Tab) {
    tab = next;
    await loadPhotos();
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
    if (!renameTarget) {
      return;
    }
    await api.people.update(eventId, renameTarget.id, { name: renameValue });
    renameTarget = null;
    await refresh();
  }

  async function reprocessFaces() {
    const { queued } = await api.events.reprocessFaces(eventId, false);
    alert(
      queued > 0
        ? `Queued face detection for ${queued} photo${queued === 1 ? '' : 's'}.`
        : 'Nothing pending — every photo has already been through detection.',
    );
    await refresh();
  }

  onMount(() => {
    void refresh().then(() => loadPhotos());
  });
  onDestroy(() => timer && clearInterval(timer));
</script>

<svelte:head><title>People — {data.event.name}</title></svelte:head>

{#if processing}
  <ProcessingBar status={processing} {canManage} onReprocess={reprocessFaces} />
{/if}

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else}
  <h2 class="mb-3 text-sm font-semibold">People</h2>
  {#if people.length === 0}
    <div class="mb-8 rounded-2xl border border-dashed border-gray-300 p-12 text-center text-gray-500">
      <Icon icon={mdiAccountOff} size="2.5rem" class="mx-auto mb-3 text-gray-300" />
      {#if (processing?.assets.pendingDetection ?? 0) > 0}
        Face detection is still running — people appear as clusters form.
      {:else if (processing?.faces.total ?? 0) === 0}
        No faces were found in this event's photos.
      {:else}
        Faces were found but no clusters formed yet — a person needs several photos.
      {/if}
    </div>
  {:else}
    <div class="mb-8 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
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
              <div
                class="mx-auto flex aspect-square w-full items-center justify-center rounded-full bg-gray-100 text-gray-400"
                title="Portrait still being generated"
              >
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

  <!-- per-photo detection state -->
  <h2 class="mb-3 text-sm font-semibold">Photo processing</h2>
  <div class="mb-4 flex flex-wrap gap-2">
    {#each tabs as item (item.id)}
      <button
        class="rounded-full px-3.5 py-1.5 text-xs font-medium transition
          {tab === item.id ? 'bg-immich-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
        onclick={() => selectTab(item.id)}
      >
        {item.label}
        {#if processing}
          <span class="ms-1 opacity-70">{item.count(processing)}</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if photosLoading}
    <div class="flex justify-center py-10"><LoadingSpinner /></div>
  {:else if photos.length === 0}
    <p class="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
      {#if tab === 'pending'}
        Nothing waiting — every photo has been through face detection.
      {:else if tab === 'found'}
        No photos with faces yet.
      {:else}
        No photos were processed without finding a face.
      {/if}
    </p>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
      {#each photos as photo (photo.id)}
        <div class="relative overflow-hidden rounded-lg bg-gray-100">
          {#if photo.thumbUrl}
            <img src={photo.thumbUrl} alt={photo.originalFilename} class="aspect-square w-full object-cover" />
          {:else}
            <div class="flex aspect-square w-full items-center justify-center text-gray-400">
              <LoadingSpinner size="small" />
            </div>
          {/if}
          <div class="absolute bottom-1 start-1">
            {#if tab === 'pending'}
              <Badge color={photo.status === 'processed' ? 'warning' : 'secondary'} size="small">
                {photo.status === 'processed' ? 'queued' : photo.status}
              </Badge>
            {:else if tab === 'found'}
              <Badge color="success" size="small">{photo.faceCount} face{photo.faceCount === 1 ? '' : 's'}</Badge>
            {:else}
              <Badge color="secondary" size="small">no faces</Badge>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
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
