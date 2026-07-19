<script lang="ts">
  import { api, type AssetItem, type PersonItem, type ProcessingStatus } from '$lib/api';
  import ProcessingBar from '$lib/components/ProcessingBar.svelte';
  import {
    Alert,
    Badge,
    Button,
    Icon,
    IconButton,
    Input,
    LoadingSpinner,
    Modal,
    ModalBody,
    ModalFooter,
  } from '@immich/ui';
  import { mdiAccountOff, mdiCheck, mdiEye, mdiEyeOff, mdiMerge, mdiPencil } from '@mdi/js';
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
  let renameTarget = $state<PersonItem | null>(null);
  let renameValue = $state('');

  // Merge mode: tick several people, then fold them into one (Immich's
  // "merge people"). The target keeps its name and cover face.
  let merging = $state(false);
  let picked = $state(new Set<string>());
  let mergeTargetId = $state<string | null>(null);
  let mergeBusy = $state(false);
  let mergeError = $state('');

  const pickedPeople = $derived(people.filter((person) => picked.has(person.id)));
  // default target = the cluster with the most photos, which usually has the
  // best cover face and, if any are named, the name worth keeping
  const mergeTarget = $derived(
    pickedPeople.find((person) => person.id === mergeTargetId) ??
      pickedPeople.find((person) => person.name) ??
      pickedPeople[0],
  );

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

  function togglePick(personId: string) {
    const next = new Set(picked);
    if (next.has(personId)) {
      next.delete(personId);
    } else {
      next.add(personId);
    }
    picked = next;
    if (mergeTargetId && !next.has(mergeTargetId)) {
      mergeTargetId = null;
    }
  }

  function exitMerge() {
    merging = false;
    picked = new Set();
    mergeTargetId = null;
    mergeError = '';
  }

  async function confirmMerge() {
    if (!mergeTarget || picked.size < 2) {
      return;
    }
    mergeBusy = true;
    mergeError = '';
    try {
      const others = [...picked].filter((id) => id !== mergeTarget.id);
      await api.people.merge(eventId, mergeTarget.id, others);
      exitMerge();
      await refresh();
    } catch (error) {
      mergeError = error instanceof Error ? error.message : 'Merge failed';
    } finally {
      mergeBusy = false;
    }
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
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h2 class="md-title-large">People</h2>
    {#if canManage && people.length > 1}
      {#if merging}
        <div class="flex flex-wrap items-center gap-2">
          <span class="md-body-medium text-gray-600">
            {picked.size < 2 ? 'Pick two or more people' : `${picked.size} selected`}
          </span>
          <Button size="small" variant="ghost" color="secondary" onclick={exitMerge}>Cancel</Button>
          <Button
            size="small"
            leadingIcon={mdiMerge}
            disabled={picked.size < 2}
            onclick={() => (mergeTargetId ||= mergeTarget?.id ?? null)}
          >
            Merge {picked.size > 1 ? picked.size : ''}
          </Button>
        </div>
      {:else}
        <Button size="small" variant="outline" leadingIcon={mdiMerge} onclick={() => (merging = true)}>
          Merge people
        </Button>
      {/if}
    {/if}
  </div>
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
        {@const isPicked = picked.has(person.id)}
        <div class="group relative text-center {person.isHidden ? 'opacity-40' : ''}">
          {#if merging}
            <!-- merge mode: the whole card toggles selection instead of navigating -->
            <button class="w-full" onclick={() => togglePick(person.id)}>
              <div class="relative mx-auto aspect-square w-full">
                {#if person.thumbnailUrl}
                  <img
                    src={person.thumbnailUrl}
                    alt={person.name || 'Unnamed person'}
                    class="h-full w-full rounded-full object-cover shadow {isPicked
                      ? 'ring-immich-primary ring-4 ring-offset-2'
                      : ''}"
                  />
                {:else}
                  <div class="flex h-full w-full items-center justify-center rounded-full bg-gray-100 text-gray-400">
                    <LoadingSpinner />
                  </div>
                {/if}
                {#if isPicked}
                  <span
                    class="bg-immich-primary absolute end-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-white"
                  >
                    <Icon icon={mdiCheck} size="1rem" />
                  </span>
                {/if}
              </div>
              <p class="md-title-small mt-2 truncate">{person.name || 'Unnamed'}</p>
              <p class="md-label-medium text-gray-500">{person.faceCount} photo{person.faceCount === 1 ? '' : 's'}</p>
            </button>
          {:else}
            <a class="block w-full" href={`/events/${eventId}/people/${person.id}`}>
              {#if person.thumbnailUrl}
                <img
                  src={person.thumbnailUrl}
                  alt={person.name || 'Unnamed person'}
                  class="mx-auto aspect-square w-full rounded-full object-cover shadow transition group-hover:brightness-95"
                />
              {:else}
                <div
                  class="mx-auto flex aspect-square w-full items-center justify-center rounded-full bg-gray-100 text-gray-400"
                  title="Portrait still being generated"
                >
                  <LoadingSpinner />
                </div>
              {/if}
              <p class="md-title-small mt-2 truncate">{person.name || 'Unnamed'}</p>
              <p class="md-label-medium text-gray-500">{person.faceCount} photo{person.faceCount === 1 ? '' : 's'}</p>
            </a>
            {#if canManage}
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
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- per-photo detection state -->
  <h2 class="md-title-large mb-4">Photo processing</h2>
  <div class="mb-4 flex flex-wrap gap-2">
    {#each tabs as item (item.id)}
      <button
        class="md-label-large min-h-10 rounded-full px-4 transition
          {tab === item.id ? 'bg-immich-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}"
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

{#if mergeTargetId && mergeTarget}
  <Modal title="Merge people" size="small" onClose={() => (mergeTargetId = null)}>
    <ModalBody>
      {#if mergeError}
        <div class="mb-3"><Alert color="danger" title={mergeError} /></div>
      {/if}
      <p class="mb-4 text-sm text-gray-600">
        All {picked.size} clusters become one person. Pick which one to keep — it keeps its name and cover photo, and
        the others are removed.
      </p>
      <div class="flex flex-wrap gap-3">
        {#each pickedPeople as person (person.id)}
          <button class="w-20 text-center" onclick={() => (mergeTargetId = person.id)}>
            {#if person.thumbnailUrl}
              <img
                src={person.thumbnailUrl}
                alt={person.name || 'Unnamed'}
                class="h-20 w-20 rounded-full object-cover {mergeTarget.id === person.id
                  ? 'ring-immich-primary ring-4 ring-offset-2'
                  : 'opacity-70'}"
              />
            {:else}
              <div class="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100"><LoadingSpinner /></div>
            {/if}
            <p class="mt-1 truncate text-xs font-medium">{person.name || 'Unnamed'}</p>
            <p class="text-[11px] text-gray-400">{person.faceCount}</p>
          </button>
        {/each}
      </div>
    </ModalBody>
    <ModalFooter>
      <Button fullWidth loading={mergeBusy} onclick={confirmMerge}>
        Merge into {mergeTarget.name || 'this person'}
      </Button>
    </ModalFooter>
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
