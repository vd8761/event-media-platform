<script lang="ts">
  // A person's photos as a full gallery page rather than a modal — the same
  // justified timeline and viewer as the event gallery, scoped to one person.
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, downloadSelectionZip, type AssetItem } from '$lib/api';
  import PhotoTimeline from '$lib/components/PhotoTimeline.svelte';
  import PhotoViewer from '$lib/components/PhotoViewer.svelte';
  import SelectionBar from '$lib/components/SelectionBar.svelte';
  import { Button, Heading, Icon, IconButton, Input, LoadingSpinner, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiArrowLeft, mdiCheckCircleOutline, mdiEye, mdiEyeOff, mdiImageOff, mdiPencil } from '@mdi/js';
  import { onMount } from 'svelte';

  let { data } = $props();
  const eventId = data.event.id;
  const personId = $derived(page.params.personId!);
  const canManage = $derived(
    data.me.isSuperAdmin ||
      ['owner', 'admin'].includes(data.me.organizations.find((org) => org.id === data.event.orgId)?.role ?? ''),
  );

  let person = $state<{ id: string; name: string; isHidden: boolean; thumbnailUrl: string | null } | null>(null);
  let assets = $state<AssetItem[]>([]);
  let loading = $state(true);
  let viewerIndex = $state(-1);

  let selecting = $state(false);
  let selected = $state(new Set<string>());
  let downloading = $state(false);

  let renaming = $state(false);
  let renameValue = $state('');

  const title = $derived(person?.name || 'Unnamed person');

  async function refresh() {
    [person, assets] = await Promise.all([api.people.get(eventId, personId), api.people.assets(eventId, personId)]);
    loading = false;
  }

  function toggleSelect(assetId: string) {
    const next = new Set(selected);
    if (next.has(assetId)) {
      next.delete(assetId);
    } else {
      next.add(assetId);
    }
    selected = next;
  }

  async function downloadSelected() {
    downloading = true;
    try {
      await downloadSelectionZip(api.assets.downloadManyUrl(eventId), [...selected], `${title}.zip`);
    } finally {
      downloading = false;
    }
  }

  async function saveRename() {
    await api.people.update(eventId, personId, { name: renameValue });
    renaming = false;
    await refresh();
  }

  async function toggleHidden() {
    if (!person) {
      return;
    }
    await api.people.update(eventId, personId, { isHidden: !person.isHidden });
    await refresh();
  }

  // Choosing a cover from inside this person's own gallery is the most
  // natural place to do it, so refresh the portrait after it lands.
  async function setCover(coverPersonId: string, faceId: string) {
    await api.people.setCover(eventId, coverPersonId, faceId);
    setTimeout(() => void refresh(), 1500); // give PersonThumbnail time to run
  }

  onMount(() => void refresh());
</script>

<svelte:head><title>{title} — {data.event.name}</title></svelte:head>

<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
  <div class="flex min-w-0 items-center gap-3">
    <IconButton
      icon={mdiArrowLeft}
      aria-label="Back to people"
      variant="ghost"
      color="secondary"
      onclick={() => goto(`/events/${eventId}/people`)}
    />
    {#if person?.thumbnailUrl}
      <img src={person.thumbnailUrl} alt={title} class="h-11 w-11 shrink-0 rounded-full object-cover shadow" />
    {/if}
    <div class="min-w-0">
      <Heading size="large" class="truncate">{title}</Heading>
      <p class="text-sm text-gray-500">{assets.length} photo{assets.length === 1 ? '' : 's'}</p>
    </div>
  </div>

  <div class="flex items-center gap-1">
    {#if canManage}
      <Button
        size="small"
        variant="ghost"
        color="secondary"
        leadingIcon={mdiPencil}
        onclick={() => {
          renameValue = person?.name ?? '';
          renaming = true;
        }}
      >
        Rename
      </Button>
      <Button
        size="small"
        variant="ghost"
        color="secondary"
        leadingIcon={person?.isHidden ? mdiEye : mdiEyeOff}
        onclick={toggleHidden}
      >
        {person?.isHidden ? 'Show' : 'Hide'}
      </Button>
    {/if}
    {#if assets.length > 0 && !selecting}
      <Button size="small" variant="outline" leadingIcon={mdiCheckCircleOutline} onclick={() => (selecting = true)}>
        Select
      </Button>
    {/if}
  </div>
</div>

{#if selecting}
  <SelectionBar
    count={selected.size}
    total={assets.length}
    {downloading}
    onSelectAll={() => (selected = new Set(assets.map((asset) => asset.id)))}
    onClear={() => {
      selecting = false;
      selected = new Set();
    }}
    onDownload={downloadSelected}
  />
{/if}

{#if loading}
  <div class="flex justify-center py-20"><LoadingSpinner size="giant" /></div>
{:else if assets.length === 0}
  <div class="rounded-2xl border border-dashed border-gray-300 p-16 text-center text-gray-500">
    <Icon icon={mdiImageOff} size="2.5rem" class="mx-auto mb-3 text-gray-300" />
    No photos for this person yet.
  </div>
{:else}
  <PhotoTimeline {assets} {selecting} {selected} onToggleSelect={toggleSelect} onOpen={(index) => (viewerIndex = index)} />
{/if}

{#if viewerIndex >= 0 && assets[viewerIndex]}
  <PhotoViewer
    {assets}
    index={viewerIndex}
    downloadUrl={(assetId) => api.assets.downloadUrl(eventId, assetId)}
    loadDetail={(assetId) => api.assets.get(eventId, assetId)}
    onOpenPerson={(id) => goto(`/events/${eventId}/people/${id}`)}
    onSetPersonCover={canManage ? setCover : undefined}
    onClose={() => (viewerIndex = -1)}
    onIndexChange={(index) => (viewerIndex = index)}
  />
{/if}

{#if renaming}
  <Modal title="Rename person" size="tiny" onClose={() => (renaming = false)}>
    <ModalBody>
      <Input bind:value={renameValue} placeholder="Name" />
    </ModalBody>
    <ModalFooter>
      <Button fullWidth onclick={saveRename}>Save</Button>
    </ModalFooter>
  </Modal>
{/if}
