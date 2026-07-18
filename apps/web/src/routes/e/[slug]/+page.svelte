<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import { Alert, Button, Heading, Input, LoadingSpinner } from '@immich/ui';
  import { mdiCameraOutline } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';

  const slug = page.params.slug!;

  let event = $state<{ name: string; description: string | null; startsAt: string | null } | null>(null);
  let notFound = $state(false);

  let email = $state('');
  let selfie = $state<File | null>(null);
  let previewUrl = $state('');
  let submitting = $state(false);
  let submitted = $state(false);
  let error = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);

  function onFilePicked(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    selfie = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
  }

  async function submit(eventForm: SubmitEvent) {
    eventForm.preventDefault();
    if (!selfie) return;
    error = '';
    submitting = true;
    try {
      await api.public.submitSelfie(slug, email, selfie);
      submitted = true;
    } catch (err) {
      error =
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts — please try again later.'
          : err instanceof ApiError
            ? err.message
            : 'Something went wrong, please try again.';
    } finally {
      submitting = false;
    }
  }

  onMount(async () => {
    try {
      event = await api.public.event(slug);
    } catch {
      notFound = true;
    }
  });
</script>

<svelte:head><title>{event?.name ?? 'Event'} — EventLens</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-immich-bg p-4">
  {#if notFound}
    <p class="text-gray-500">This event does not exist or is not open.</p>
  {:else if !event}
    <LoadingSpinner size="giant" />
  {:else}
    <div class="w-full max-w-md rounded-3xl border border-gray-200 p-8 shadow-sm">
      <div class="mb-6 text-center">
        <Heading size="large">{event.name}</Heading>
        {#if event.startsAt}
          <p class="mt-1 text-sm text-gray-500">
            {DateTime.fromISO(event.startsAt).toLocaleString(DateTime.DATE_HUGE)}
          </p>
        {/if}
        {#if event.description}<p class="mt-2 text-sm text-gray-600">{event.description}</p>{/if}
      </div>

      {#if submitted}
        <Alert color="success" title="You're all set!">
          We'll email you a private link to your photos once they're ready.
        </Alert>
      {:else}
        <p class="mb-5 text-center text-sm text-gray-600">
          Get every photo you appear in — submit a selfie and we'll find you.
        </p>

        {#if error}<div class="mb-4"><Alert color="danger" title={error} /></div>{/if}

        <form onsubmit={submit} class="flex flex-col gap-4">
          <div>
            <label for="email" class="immich-form-label mb-1 block text-sm">Email</label>
            <Input id="email" type="email" bind:value={email} required placeholder="you@example.com" />
          </div>

          <input
            bind:this={fileInput}
            type="file"
            accept="image/*"
            capture="user"
            class="hidden"
            onchange={(event) => onFilePicked(event.currentTarget.files)}
          />

          {#if previewUrl}
            <div class="text-center">
              <img src={previewUrl} alt="Selfie preview" class="mx-auto h-40 w-40 rounded-full object-cover shadow" />
              <button type="button" class="mt-2 text-sm text-immich-primary underline" onclick={() => fileInput?.click()}>
                Retake
              </button>
            </div>
          {:else}
            <button
              type="button"
              class="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 py-10 text-gray-500 transition hover:border-immich-primary hover:text-immich-primary"
              onclick={() => fileInput?.click()}
            >
              <Icon icon={mdiCameraOutline} size="2.5rem" />
              <span class="text-sm font-medium">Take or choose a selfie</span>
            </button>
          {/if}

          <Button type="submit" fullWidth disabled={submitting || !selfie || !email} loading={submitting}>
            Find my photos
          </Button>

          <p class="text-center text-xs leading-relaxed text-gray-400">
            Your selfie is used only to find your photos at this event and is deleted after the event ends. You'll
            receive a private gallery link by email.
          </p>
        </form>
      {/if}
    </div>
  {/if}
</div>
