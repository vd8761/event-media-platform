<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { Alert, Button, Input, Switch, Textarea } from '@immich/ui';

  let { data } = $props();

  let name = $state(data.event.name);
  let slug = $state(data.event.slug);
  let description = $state(data.event.description ?? '');
  let status = $state(data.event.status);
  let participantPageEnabled = $state(data.event.participantPageEnabled);
  let participantsSeeAllPhotos = $state(data.event.participantsSeeAllPhotos);
  let participantsCanDownloadAll = $state(data.event.participantsCanDownloadAll);
  let matchMaxDistance = $state(data.event.config.matchMaxDistance?.toString() ?? '');
  let minFaces = $state(data.event.config.minFaces?.toString() ?? '');
  let error = $state('');
  let saved = $state(false);
  let saving = $state(false);

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
        config: {
          ...(matchMaxDistance ? { matchMaxDistance: Number(matchMaxDistance) } : {}),
          ...(minFaces ? { minFaces: Number(minFaces) } : {}),
        },
      });
      saved = true;
      await invalidateAll();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to save';
    } finally {
      saving = false;
    }
  }

  async function removeEvent() {
    if (!confirm(`Delete "${data.event.name}"? All photos, people and participants will be removed.`)) return;
    await api.events.remove(data.event.id);
    await goto('/events');
  }
</script>

<svelte:head><title>Settings — {data.event.name}</title></svelte:head>

<div class="max-w-xl">
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
    <div>
      <label for="status" class="immich-form-label mb-1.5 block">Status</label>
      <select id="status" bind:value={status} class="immich-form-input">
        <option value="draft">draft — hidden from participants</option>
        <option value="active">active — public page live</option>
        <option value="closed">closed</option>
      </select>
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

    <div>
      <label for="distance" class="immich-form-label mb-1.5 block">Match distance override</label>
      <Input id="distance" bind:value={matchMaxDistance} placeholder="default 0.5" />
      <p class="md-label-medium mt-1.5 text-gray-500">
        Lower (e.g. 0.45) for crowded events with false merges; leave empty for the default.
      </p>
    </div>
    <div>
      <label for="min-faces" class="immich-form-label mb-1.5 block">Photos needed to form a person</label>
      <Input id="min-faces" bind:value={minFaces} placeholder="default 1" />
      <p class="md-label-medium mt-1.5 text-gray-500">
        1 means every detected face becomes a person, so nobody is missed — use Merge on the People tab to combine
        duplicates. Raise it on very large events if single-photo people get noisy.
      </p>
    </div>

    <div class="flex gap-3">
      <Button size="large" onclick={save} loading={saving} disabled={saving}>Save changes</Button>
    </div>

    <div class="mt-6 rounded-3xl border border-red-200 p-5">
      <p class="md-title-small mb-3 text-red-700">Danger zone</p>
      <Button color="danger" variant="outline" size="small" onclick={removeEvent}>Delete event</Button>
    </div>
  </div>
</div>
