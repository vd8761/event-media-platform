<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { api, ApiError, type AssetItem } from '$lib/api';
  import { shellStore } from '$lib/shell.svelte';
  import { Alert, Button, Input, Modal, ModalBody, ModalFooter, Switch, Textarea } from '@immich/ui';

  let { data } = $props();

  let name = $state(data.event.name);
  let slug = $state(data.event.slug);
  let description = $state(data.event.description ?? '');
  // Draft/Active now lives on the event page as a switch. Still sent on save so
  // editing the name here cannot silently reset a status changed elsewhere.
  const status = $derived(data.event.status);
  let participantPageEnabled = $state(data.event.participantPageEnabled);
  let participantsSeeAllPhotos = $state(data.event.participantsSeeAllPhotos);
  let participantsCanDownloadAll = $state(data.event.participantsCanDownloadAll);
  let error = $state('');
  let saved = $state(false);
  let saving = $state(false);
  let staleEdits = $state(false);

  // The form fields are seeded from `data`, and SvelteKit reuses this component
  // when only the `eventId` param changes. Without re-seeding, switching events
  // leaves the form holding the previous event's values while `save()` writes
  // them to the new one — editing what looks like event B and silently
  // overwriting it with event A's settings.
  //
  // Unsaved edits are kept rather than discarded: losing someone's typing on a
  // navigation is bad, but writing it to the wrong event is worse, so a dirty
  // form is preserved *and* flagged instead of being saved blind.
  let seededId = data.event.id;
  const isDirty = () =>
    name !== data.event.name ||
    slug !== data.event.slug ||
    description !== (data.event.description ?? '') ||
    participantPageEnabled !== data.event.participantPageEnabled ||
    participantsSeeAllPhotos !== data.event.participantsSeeAllPhotos ||
    participantsCanDownloadAll !== data.event.participantsCanDownloadAll;

  $effect(() => {
    if (data.event.id === seededId) {
      return;
    }
    const dirty = isDirty();
    seededId = data.event.id;
    if (dirty) {
      // Keep what they typed, but make it unmistakable that it now belongs to a
      // different event than the one it was typed against.
      staleEdits = true;
      return;
    }
    staleEdits = false;
    error = '';
    saved = false;
    name = data.event.name;
    slug = data.event.slug;
    description = data.event.description ?? '';
    participantPageEnabled = data.event.participantPageEnabled;
    participantsSeeAllPhotos = data.event.participantsSeeAllPhotos;
    participantsCanDownloadAll = data.event.participantsCanDownloadAll;
    expiresAtLocal = toLocalInput(data.event.expiresAt);
  });

  function discardStaleEdits() {
    name = data.event.name;
    slug = data.event.slug;
    description = data.event.description ?? '';
    participantPageEnabled = data.event.participantPageEnabled;
    participantsSeeAllPhotos = data.event.participantsSeeAllPhotos;
    participantsCanDownloadAll = data.event.participantsCanDownloadAll;
    expiresAtLocal = toLocalInput(data.event.expiresAt);
    staleEdits = false;
  }

  async function save() {
    error = '';
    saved = false;
    saving = true;
    try {
      await api.events.update(data.event.id, {
        name,
        slug,
        description: description || null,
        status,
        participantPageEnabled,
        participantsSeeAllPhotos,
        // sending false when sharing is off keeps the two flags consistent, so
        // re-enabling sharing later never silently re-grants downloads
        participantsCanDownloadAll: participantsSeeAllPhotos && participantsCanDownloadAll,
      });
      saved = true;
      await invalidateAll();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to save';
    } finally {
      saving = false;
    }
  }

  // --- sidebar cover ---

  // A recent slice rather than the whole event: enough to recognise a good
  // cover, without pulling thousands of thumbnails into a settings page.
  let coverChoices = $state<AssetItem[]>([]);
  let coverBusy = $state(false);

  // Keyed on the event, not `onMount` — otherwise the cover picker keeps
  // offering the previous event's photos after a switch.
  $effect(() => {
    const id = data.event.id;
    let cancelled = false;
    coverChoices = [];
    void api.assets
      .list(id, undefined, 24)
      .catch(() => null)
      .then((result) => {
        if (!cancelled) {
          coverChoices = result?.assets ?? [];
        }
      });
    return () => {
      cancelled = true;
    };
  });

  async function setCover(assetId: string | null) {
    coverBusy = true;
    try {
      await api.events.setCover(data.event.id, assetId);
      await invalidateAll();
      // The sidebar caches its event list, so it has to be told.
      await shellStore.refresh();
    } finally {
      coverBusy = false;
    }
  }

  // --- expiration ---

  // <input type="datetime-local"> speaks local wall-clock with no zone, so it
  // is converted at both boundaries rather than stored as an ISO string.
  const toLocalInput = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  let expiresAtLocal = $state(toLocalInput(data.event.expiresAt));
  let expiryBusy = $state(false);
  let expiryError = $state('');

  const isExpired = $derived(!!data.event.expiresAt && new Date(data.event.expiresAt) <= new Date());

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }) : '';

  async function runExpiry(action: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    expiryError = '';
    expiryBusy = true;
    try {
      await action();
      await invalidateAll();
    } catch (e) {
      expiryError = e instanceof ApiError ? e.message : String(e);
    } finally {
      expiryBusy = false;
    }
  }

  // `extend` rather than a plain update: it also clears the notified mark and
  // cancels a scheduled purge, so guest links come back immediately.
  const saveExpiry = () =>
    runExpiry(() =>
      api.events.extendExpiry(data.event.id, expiresAtLocal ? new Date(expiresAtLocal).toISOString() : null),
    );

  const acknowledgeExpiry = () => runExpiry(() => api.events.acknowledgeExpiry(data.event.id));

  const purgeNow = () =>
    runExpiry(
      () => api.events.purgeExpired(data.event.id),
      'Permanently delete every photo in this event? This cannot be undone.',
    );

  // --- delete ---
  // A typed confirmation rather than a browser confirm(). Deleting destroys
  // the photos outright, and a single OK on a dialog that looks like every
  // other dialog is not a proportionate amount of friction for that. Typing
  // the slug forces the organiser to look at *which* event they are about to
  // destroy — the failure mode this guards against is deleting the right way
  // on the wrong event.
  let deleteOpen = $state(false);
  let deleteConfirmation = $state('');
  let deleteBusy = $state(false);
  let deleteError = $state('');

  const deleteArmed = $derived(deleteConfirmation.trim() === data.event.slug);

  function openDelete() {
    deleteConfirmation = '';
    deleteError = '';
    deleteOpen = true;
  }

  async function removeEvent() {
    if (!deleteArmed) {
      return;
    }
    deleteBusy = true;
    deleteError = '';
    try {
      await api.events.remove(data.event.id, deleteConfirmation.trim());
      await shellStore.refresh();
      await goto('/events');
    } catch (err) {
      deleteError = err instanceof ApiError ? err.message : 'Could not delete the event';
      deleteBusy = false;
    }
  }
</script>

<svelte:head><title>Settings — {data.event.name}</title></svelte:head>

<div class="max-w-xl">
  {#if staleEdits}
    <!-- Switched events with unsaved changes. The fields below still hold what
         was typed against the previous event, so saving now would apply them
         here. Say so plainly and offer the way out. -->
    <div class="mb-4">
      <Alert color="warning" title="These edits were made against a different event">
        <p class="text-sm">
          You changed events while this form had unsaved edits. Saving now would apply them to
          <strong>{data.event.name}</strong>. Discard them to load this event's real settings.
        </p>
        <Button size="small" variant="outline" class="mt-2" onclick={discardStaleEdits}>
          Discard and reload settings
        </Button>
      </Alert>
    </div>
  {/if}
  {#if error}<div class="mb-4"><Alert color="danger" title={error} /></div>{/if}
  {#if saved}<div class="mb-4"><Alert color="success" title="Saved" /></div>{/if}

  <div class="flex flex-col gap-5">
    <div>
      <label for="name" class="immich-form-label mb-1.5 block">Name</label>
      <Input id="name" bind:value={name} />
    </div>
    <div>
      <label for="slug" class="immich-form-label mb-1.5 block">Public link slug</label>
      <Input id="slug" bind:value={slug} />
      <p class="md-label-medium mt-1.5 text-gray-500">Participants use /e/{slug}</p>
    </div>
    <div>
      <label for="description" class="immich-form-label mb-1.5 block">Description</label>
      <Textarea id="description" bind:value={description} rows={3} />
    </div>
    <div class="md-surface flex items-center justify-between gap-4 px-4 py-4">
      <div>
        <p class="md-title-small">Participant page</p>
        <p class="md-label-medium text-gray-600">Allow guests to submit a selfie and receive their gallery</p>
      </div>
      <Switch bind:checked={participantPageEnabled} />
    </div>
    <div class="md-surface">
      <div class="flex items-center justify-between gap-4 px-4 py-4">
        <div>
          <p class="md-title-small">Show all event photos to participants</p>
          <p class="md-label-medium text-gray-600">Adds an "Event photos" section to every participant's gallery</p>
        </div>
        <Switch bind:checked={participantsSeeAllPhotos} />
      </div>

      <!-- only meaningful once the gallery is shared at all -->
      {#if participantsSeeAllPhotos}
        <div class="flex items-center justify-between gap-4 border-t border-gray-100 px-4 py-4 ps-8">
          <div>
            <p class="md-title-small">Let them download those photos</p>
            <p class="md-label-medium text-gray-600">
              Off means view-only. Participants can always download photos they appear in.
            </p>
          </div>
          <Switch bind:checked={participantsCanDownloadAll} />
        </div>
      {/if}
    </div>

    <div class="flex gap-3">
      <Button size="large" onclick={save} loading={saving} disabled={saving}>Save changes</Button>
    </div>

    <!-- Sidebar cover. Picked from the event's own photos rather than an
         upload, so there is nothing extra to store or clean up. -->
    <div class="mt-6 rounded-3xl border border-gray-200 p-5">
      <p class="md-title-small mb-1">Sidebar cover</p>
      <p class="md-label-medium mb-4 text-gray-500">
        The thumbnail shown beside this event in the sidebar. Defaults to the most recent photo.
      </p>

      {#if coverChoices.length === 0}
        <p class="md-body-medium text-gray-500">Upload some photos first.</p>
      {:else}
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            onclick={() => setCover(null)}
            disabled={coverBusy}
            class="flex h-16 w-16 items-center justify-center rounded-xl border-2 text-xs transition
              {data.event.coverAssetId === null
              ? 'border-immich-primary text-immich-primary'
              : 'border-gray-200 text-gray-500 hover:border-gray-300'}"
          >
            Auto
          </button>
          {#each coverChoices as asset (asset.id)}
            <button
              type="button"
              onclick={() => setCover(asset.id)}
              disabled={coverBusy}
              title={asset.originalFilename}
              class="size-16 overflow-hidden rounded-xl border-2 transition
                {data.event.coverAssetId === asset.id ? 'border-immich-primary' : 'border-transparent hover:border-gray-300'}"
            >
              {#if asset.thumbUrl}
                <img src={asset.thumbUrl} alt="" class="size-full object-cover" loading="lazy" />
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Expiration. Two separate moments: the guest links close at expiresAt,
         and the photos are deleted after purgeAfter. -->
    <div class="mt-6 rounded-3xl border border-gray-200 p-5">
      <p class="md-title-small mb-1">Expiration</p>
      <p class="md-label-medium mb-4 text-gray-500">
        When guest gallery links stop working. Photos are not deleted straight away — you get a warning email first, and
        can extend or delete early. Leave blank for no expiry.
      </p>

      {#if data.event.purgedAt}
        <Alert color="danger" class="mb-4">
          The photos for this event were deleted on {formatDate(data.event.purgedAt)}. This cannot be undone.
        </Alert>
      {:else if isExpired}
        <Alert color="warning" class="mb-4">
          This event closed on {formatDate(data.event.expiresAt)}. Guest links are shut.
          {#if data.event.purgeAfter}
            Photos will be permanently deleted after <strong>{formatDate(data.event.purgeAfter)}</strong>.
          {/if}
        </Alert>
      {/if}

      <label class="block">
        <span class="md-label-large">Expires at</span>
        <input
          type="datetime-local"
          bind:value={expiresAtLocal}
          disabled={!!data.event.purgedAt}
          class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 disabled:bg-gray-100"
        />
      </label>

      {#if expiryError}
        <p class="md-label-medium mt-2 text-red-600">{expiryError}</p>
      {/if}

      <div class="mt-4 flex flex-wrap gap-3">
        <Button size="small" loading={expiryBusy} disabled={expiryBusy || !!data.event.purgedAt} onclick={saveExpiry}>
          {isExpired ? 'Extend' : 'Save expiry'}
        </Button>
        {#if isExpired && !data.event.purgedAt}
          {#if !data.event.expiryAcknowledgedAt}
            <Button size="small" variant="outline" disabled={expiryBusy} onclick={acknowledgeExpiry}>
              Acknowledge
            </Button>
          {/if}
          <Button size="small" variant="outline" color="danger" disabled={expiryBusy} onclick={purgeNow}>
            Delete photos now
          </Button>
        {/if}
      </div>
    </div>

    <div class="mt-6 rounded-3xl border border-red-200 p-5">
      <p class="md-title-small mb-3 text-red-700">Danger zone</p>
      <Button color="danger" variant="outline" size="small" onclick={openDelete}>Delete event</Button>
    </div>
  </div>
</div>

{#if deleteOpen}
  <Modal title="Delete this event?" size="small" onClose={() => (deleteOpen = false)}>
    <ModalBody>
      <p class="mb-3 text-sm">
        This permanently destroys every photo and video in <strong>{data.event.name}</strong>, along with its people,
        guests and gallery links. It happens immediately and <strong>cannot be undone</strong> — there is no restore
        window and no backup to recover from.
      </p>
      <p class="mb-4 text-sm text-gray-500">
        Type <code class="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs">{data.event.slug}</code> to confirm.
      </p>
      <Input bind:value={deleteConfirmation} placeholder={data.event.slug} autocomplete="off" />
      {#if deleteError}
        <p class="mt-3 text-sm text-red-600">{deleteError}</p>
      {/if}
    </ModalBody>
    <ModalFooter>
      <Button variant="outline" onclick={() => (deleteOpen = false)} disabled={deleteBusy}>Cancel</Button>
      <Button color="danger" onclick={removeEvent} disabled={!deleteArmed || deleteBusy}>
        {deleteBusy ? 'Deleting…' : 'Delete permanently'}
      </Button>
    </ModalFooter>
  </Modal>
{/if}
