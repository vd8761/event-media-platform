<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError, asExpiredEvent, type ExpiredEventInfo } from '$lib/api';
  import { Alert, Button, Heading, Input, LoadingSpinner } from '@immich/ui';
  import { mdiCameraOutline } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';

  const slug = page.params.slug!;

  let event = $state<{ name: string; description: string | null; startsAt: string | null } | null>(null);
  let notFound = $state(false);
  let expired = $state<ExpiredEventInfo | null>(null);

  let email = $state('');
  // required: it becomes the label on this person's face in every photo
  let name = $state('');
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
    if (!selfie || !name.trim()) return;
    error = '';
    submitting = true;
    try {
      await api.public.submitSelfie(slug, email, name.trim(), selfie);
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
    } catch (error) {
      // A closed event is not a missing one — say so, or guests assume they
      // followed a broken link and keep retrying.
      expired = asExpiredEvent(error);
      notFound = expired === null;
    }
  });
</script>

<svelte:head><title>{event?.name ?? 'Event'} — EventLens</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-immich-bg p-4">
  {#if expired}
    <div class="md-surface w-full max-w-md p-8 text-center">
      <p class="md-title-large mb-2">{expired.eventName} has closed</p>
      <p class="md-body-medium text-gray-600">
        Photo sharing for this event has ended, so new selfies can't be accepted.
      </p>
      <p class="md-body-small mt-4 text-gray-500">Contact the event organiser if you still need your photos.</p>
    </div>
  {:else if notFound}
    <p class="text-gray-500">This event does not exist or is not open.</p>
  {:else if !event}
    <LoadingSpinner size="giant" />
  {:else}
    <div class="md-surface w-full max-w-md p-6 shadow-sm sm:p-8">
      <div class="mb-6 text-center">
        <h1 class="md-headline-small">{event.name}</h1>
        {#if event.startsAt}
          <p class="md-body-medium mt-1 text-gray-500">
            {DateTime.fromISO(event.startsAt).toLocaleString(DateTime.DATE_HUGE)}
          </p>
        {/if}
        {#if event.description}<p class="md-body-medium mt-2 text-gray-600">{event.description}</p>{/if}
      </div>

      {#if submitted}
        <Alert color="success" title="You're all set!">
          We've emailed you a private link to your photos — open it any time to see how we're getting on.
        </Alert>
      {:else}
        <p class="md-body-medium mb-5 text-center text-gray-600">
          Get every photo you appear in — submit a selfie and we'll find you.
        </p>

        {#if error}<div class="mb-4"><Alert color="danger" title={error} /></div>{/if}

        <form onsubmit={submit} class="flex flex-col gap-4">
          <div>
            <label for="name" class="immich-form-label mb-1.5 block">Your name</label>
            <Input id="name" bind:value={name} required autocomplete="name" placeholder="Alex Morgan" />
            <p class="md-label-medium mt-1.5 text-gray-400">Shown on your face in the event photos.</p>
          </div>
          <div>
            <label for="email" class="immich-form-label mb-1.5 block">Email</label>
            <Input id="email" type="email" bind:value={email} required autocomplete="email" placeholder="you@example.com" />
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
              <button
                type="button"
                class="md-label-large text-immich-primary mt-3 min-h-11 px-4 underline"
                onclick={() => fileInput?.click()}
              >
                Retake
              </button>
            </div>
          {:else}
            <button
              type="button"
              class="hover:border-immich-primary hover:text-immich-primary flex min-h-40 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-gray-300 py-10 text-gray-500 transition"
              onclick={() => fileInput?.click()}
            >
              <Icon icon={mdiCameraOutline} size="2.75rem" />
              <span class="md-label-large">Take or choose a selfie</span>
            </button>
          {/if}

          <Button
            type="submit"
            size="large"
            fullWidth
            disabled={submitting || !selfie || !email || !name.trim()}
            loading={submitting}
          >
            Find my photos
          </Button>

          <p class="md-label-medium text-center leading-relaxed text-gray-400">
            Your selfie is used only to find your photos at this event and is deleted after the event ends. You'll
            receive a private gallery link by email.
          </p>
        </form>
      {/if}
    </div>
  {/if}
</div>
