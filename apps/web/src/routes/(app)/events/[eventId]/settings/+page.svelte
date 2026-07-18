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
  let matchMaxDistance = $state(data.event.config.matchMaxDistance?.toString() ?? '');
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
        config: matchMaxDistance ? { matchMaxDistance: Number(matchMaxDistance) } : {},
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
      <label for="name" class="immich-form-label mb-1 block text-sm">Name</label>
      <Input id="name" bind:value={name} />
    </div>
    <div>
      <label for="slug" class="immich-form-label mb-1 block text-sm">Public link slug</label>
      <Input id="slug" bind:value={slug} />
      <p class="mt-1 text-xs text-gray-400">Participants use /e/{slug}</p>
    </div>
    <div>
      <label for="description" class="immich-form-label mb-1 block text-sm">Description</label>
      <Textarea id="description" bind:value={description} rows={3} />
    </div>
    <div>
      <label for="status" class="immich-form-label mb-1 block text-sm">Status</label>
      <select id="status" bind:value={status} class="immich-form-input">
        <option value="draft">draft — hidden from participants</option>
        <option value="active">active — public page live</option>
        <option value="closed">closed</option>
      </select>
    </div>
    <div class="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
      <div>
        <p class="text-sm font-medium">Participant page</p>
        <p class="text-xs text-gray-500">Allow guests to submit a selfie and receive their gallery</p>
      </div>
      <Switch bind:checked={participantPageEnabled} />
    </div>
    <div>
      <label for="distance" class="immich-form-label mb-1 block text-sm">Match distance override</label>
      <Input id="distance" bind:value={matchMaxDistance} placeholder="default 0.5" />
      <p class="mt-1 text-xs text-gray-400">
        Lower (e.g. 0.45) for crowded events with false merges; leave empty for the default.
      </p>
    </div>

    <div class="flex gap-3">
      <Button onclick={save} loading={saving} disabled={saving}>Save changes</Button>
    </div>

    <div class="mt-6 rounded-xl border border-red-200 p-4">
      <p class="mb-2 text-sm font-medium text-red-700">Danger zone</p>
      <Button color="danger" variant="outline" size="small" onclick={removeEvent}>Delete event</Button>
    </div>
  </div>
</div>
