<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError, asExpiredEvent, type ExpiredEventInfo, type SelfieProgress } from '$lib/api';
  import PublicTopBar from '$lib/components/PublicTopBar.svelte';
  import { Alert, Button, Input, LoadingSpinner } from '@immich/ui';
  import { mdiCameraOutline, mdiClose } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { DateTime } from 'luxon';
  import { onMount, onDestroy } from 'svelte';

  const slug = page.params.slug!;

  // Matching quality improves with more angles, so up to three photos are
  // accepted and treated as the same person.
  const MAX_SELFIES = 3;

  let event = $state<{
    organization: { name: string | null };
    id: string;
    name: string;
    description: string | null;
    startsAt: string | null;
  } | null>(null);
  let notFound = $state(false);
  let expired = $state<ExpiredEventInfo | null>(null);

  let email = $state('');
  // required: it becomes the label on this person's face in every photo
  let name = $state('');
  let phone = $state('');
  let selfies = $state<{ file: File; previewUrl: string }[]>([]);
  let submitting = $state(false);
  let submitted = $state(false);
  let error = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);

  // --- live progress ---
  // When the GPU box is already awake and not backed up, we keep the guest here
  // and show them the queue instead of sending them to their inbox. The server
  // decides which of those two it is; `progress.mode` is the whole contract.
  const POLL_MS = 10_000;

  let ticket = $state('');
  let progress = $state<SelfieProgress | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function pollProgress() {
    if (!ticket) return;
    try {
      progress = await api.public.selfieProgress(ticket);
    } catch {
      // A failed poll is not worth showing: the email is already sent, so the
      // guest has a working path either way. Fall back to that quietly.
      progress = { mode: 'email' };
    }
    schedulePoll();
  }

  function schedulePoll() {
    stopPolling();
    // Stop once there is nothing left to watch — a finished participant, or a
    // box that put them on the email path.
    if (progress?.mode !== 'live' || progress.status !== 'processing') return;
    if (document.visibilityState !== 'visible') return;
    timer = setTimeout(() => void pollProgress(), POLL_MS);
  }

  function stopPolling() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  // A backgrounded tab must not keep polling for the half hour the ticket
  // lives — that is a request every 10s per idle phone. Resume with an
  // immediate read so returning to the tab shows current numbers, not a
  // ten-second-old count.
  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void pollProgress();
    } else {
      stopPolling();
    }
  }

  function formatEta(seconds: number): string {
    if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
    const minutes = Math.round(seconds / 60);
    return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  function onFilesPicked(list: FileList | null) {
    if (!list) return;
    // Silently cap rather than erroring: the picker allows multi-select, and
    // rejecting the whole batch for one photo too many is needless friction.
    const room = MAX_SELFIES - selfies.length;
    for (const file of [...list].slice(0, room)) {
      selfies = [...selfies, { file, previewUrl: URL.createObjectURL(file) }];
    }
    if (fileInput) fileInput.value = '';
  }

  function removeSelfie(index: number) {
    URL.revokeObjectURL(selfies[index].previewUrl);
    selfies = selfies.filter((_, i) => i !== index);
  }

  const canSubmit = $derived(!submitting && selfies.length > 0 && !!email && name.trim().length > 0);

  async function submit(eventForm: SubmitEvent) {
    eventForm.preventDefault();
    if (!canSubmit) return;
    error = '';
    submitting = true;
    try {
      const result = await api.public.submitSelfie(slug, {
        email,
        name: name.trim(),
        phone: phone.trim() || undefined,
        selfies: selfies.map((entry) => entry.file),
      });
      submitted = true;
      ticket = result.progressTicket;
      // One immediate read decides which of the two confirmations they see, so
      // the live view never appears and then vanishes a beat later.
      await pollProgress();
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

  onDestroy(() => {
    stopPolling();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  onMount(async () => {
    document.addEventListener('visibilitychange', onVisibilityChange);
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

<PublicTopBar orgName={event?.organization.name ?? null} eventName={event?.name ?? null} eventId={event?.id} />

<div class="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-immich-bg p-4">
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
        {#if progress?.mode === 'live' && progress.status === 'processing'}
          <!-- The GPU box is awake and keeping up, so the wait is short enough
               to be worth watching. The email has gone out regardless — this
               view is a convenience, never the only way to get the photos. -->
          <div class="text-center">
            <div class="mb-4 flex justify-center"><LoadingSpinner size="giant" /></div>
            <p class="md-title-medium mb-1">Finding your photos…</p>
            <p class="md-body-medium text-gray-600">
              {#if progress.position && progress.position > 1}
                You're number {progress.position} in the queue.
              {:else}
                You're up next.
              {/if}
              {#if progress.etaSeconds}
                <br />Roughly {formatEta(progress.etaSeconds)} to go.
              {/if}
            </p>
            <p class="md-label-medium mt-4 leading-relaxed text-gray-400">
              You can close this page — we've also emailed you a private link to your photos.
            </p>
          </div>
        {:else if progress?.mode === 'live' && progress.status === 'no_face'}
          <Alert color="warning" title="We couldn't find a face">
            Your photos didn't have a face we could read. We've emailed you — reply to that message or submit again
            with a clearer, well-lit photo of just you.
          </Alert>
        {:else if progress?.mode === 'live'}
          <!-- matched / pending_match: the work finished while they watched. -->
          <Alert color="success" title="Done — we found you!">
            {#if progress.matchedCount > 0}
              You're in {progress.matchedCount} photo{progress.matchedCount === 1 ? '' : 's'} so far. We've emailed you
              a private link — more will appear there as the organiser adds photos.
            {:else}
              We've matched your face and emailed you a private link. No photos of you have been uploaded yet, so
              check back through that link.
            {/if}
          </Alert>
        {:else}
          <Alert color="success" title="You're all set!">
            We've emailed you a private link to your photos — open it any time to see how we're getting on.
          </Alert>
        {/if}
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
          <div>
            <label for="phone" class="immich-form-label mb-1.5 block">Phone number</label>
            <Input id="phone" type="tel" bind:value={phone} autocomplete="tel" placeholder="+44 7700 900123" />
            <p class="md-label-medium mt-1.5 text-gray-400">Optional — so the organiser can reach you if your email bounces.</p>
          </div>

          <input
            bind:this={fileInput}
            type="file"
            accept="image/*"
            capture="user"
            multiple
            class="hidden"
            onchange={(event) => onFilesPicked(event.currentTarget.files)}
          />

          <div>
            <span class="immich-form-label mb-1.5 block">Your photos ({selfies.length}/{MAX_SELFIES})</span>

            {#if selfies.length > 0}
              <div class="mb-3 flex flex-wrap justify-center gap-3">
                {#each selfies as entry, index (entry.previewUrl)}
                  <div class="relative">
                    <img
                      src={entry.previewUrl}
                      alt="Selfie {index + 1}"
                      class="size-28 rounded-2xl object-cover shadow"
                    />
                    <button
                      type="button"
                      aria-label="Remove photo {index + 1}"
                      class="absolute -end-2 -top-2 flex size-7 items-center justify-center rounded-full bg-black/70 text-white"
                      onclick={() => removeSelfie(index)}
                    >
                      <Icon icon={mdiClose} size="1rem" />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}

            {#if selfies.length < MAX_SELFIES}
              <button
                type="button"
                class="hover:border-immich-primary hover:text-immich-primary flex w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-gray-300 py-8 text-gray-500 transition"
                onclick={() => fileInput?.click()}
              >
                <Icon icon={mdiCameraOutline} size="2.75rem" />
                <span class="md-label-large">
                  {selfies.length === 0 ? 'Take or choose a selfie' : 'Add another photo'}
                </span>
              </button>
            {/if}

            <!-- Stated plainly and framed around accuracy: a group photo gives
                 us more than one face to choose from, and the wrong choice
                 sends someone else's photos to this person. -->
            <p class="md-label-medium mt-2 leading-relaxed text-gray-400">
              Please upload photos of <strong>just you</strong> — no other people in the frame. Anyone else in the
              picture makes it harder to tell which face is yours, and up to {MAX_SELFIES} photos from different angles
              gives us the most accurate match.
            </p>
          </div>

          <Button type="submit" size="large" fullWidth disabled={!canSubmit} loading={submitting}>
            Find my photos
          </Button>

          <p class="md-label-medium text-center leading-relaxed text-gray-400">
            Your photos are used only to find you at this event and are deleted after the event ends. You'll receive a
            private gallery link by email. Read our <a href="/privacy" class="underline">Privacy Policy</a> for what we
            do with your selfie and how to have it removed.
          </p>
        </form>
      {/if}
    </div>
  {/if}
</div>
