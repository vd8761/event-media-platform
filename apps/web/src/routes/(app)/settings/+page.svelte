<script lang="ts">
  // Account settings — reached from the profile menu in the top bar.
  //
  // Everyone who can sign in lands here, super admin and organisation alike,
  // because everyone has a password. Organisation-specific settings (name,
  // logo) only render for someone who can actually change them.
  import { api, ApiError } from '$lib/api';
  import { Alert, Button, Heading, Input, LoadingSpinner } from '@immich/ui';
  import { mdiCheck, mdiLockOutline } from '@mdi/js';

  let { data } = $props();

  let current = $state('');
  let next = $state('');
  let confirm = $state('');

  let saving = $state(false);
  let saved = $state(false);
  let error = $state('');

  // Checked here as well as on the server so the mismatch is caught before a
  // round trip — the server has no way to know what the user meant to type.
  const mismatch = $derived(confirm.length > 0 && next !== confirm);
  const tooShort = $derived(next.length > 0 && next.length < 8);
  const reused = $derived(next.length > 0 && next === current);
  const canSubmit = $derived(
    current.length > 0 && next.length >= 8 && next === confirm && !reused && !saving,
  );

  async function changePassword(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    saving = true;
    saved = false;
    error = '';
    try {
      await api.changePassword(current, next);
      saved = true;
      current = '';
      next = '';
      confirm = '';
    } catch (err) {
      // The server distinguishes "wrong current password" from everything
      // else; passing its message through is more useful than a generic one.
      error = err instanceof ApiError ? err.message : 'Could not change your password';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Account settings — EventLens</title></svelte:head>

<div class="mx-auto max-w-2xl">
  <Heading size="large" class="mb-1">Account settings</Heading>
  <p class="mb-6 text-sm text-gray-500">{data.me.name} · {data.me.email}</p>

  <section class="md-surface p-5">
    <div class="mb-4 flex items-center gap-2">
      <Heading size="small">Password</Heading>
    </div>

    {#if saved}
      <div class="mb-4">
        <Alert color="success" title="Password changed">
          <p class="text-sm">
            You've been signed out everywhere else. This tab stays signed in.
          </p>
        </Alert>
      </div>
    {/if}
    {#if error}
      <div class="mb-4"><Alert color="danger" title={error} /></div>
    {/if}

    <form onsubmit={changePassword} class="flex flex-col gap-4">
      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium">Current password</span>
        <Input type="password" bind:value={current} autocomplete="current-password" required />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium">New password</span>
        <Input type="password" bind:value={next} autocomplete="new-password" required />
        <!-- One message at a time, and only once there is something to say —
             validation that shouts before the field is filled in is noise. -->
        {#if tooShort}
          <span class="text-xs text-amber-600">Use at least 8 characters.</span>
        {:else if reused}
          <span class="text-xs text-amber-600">That's your current password.</span>
        {/if}
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium">Confirm new password</span>
        <Input type="password" bind:value={confirm} autocomplete="new-password" required />
        {#if mismatch}
          <span class="text-xs text-amber-600">These don't match.</span>
        {/if}
      </label>

      <p class="text-xs text-gray-500">
        Changing your password signs you out of every other browser and device. You'll stay signed in here.
      </p>

      <div>
        <Button type="submit" disabled={!canSubmit} leadingIcon={saved ? mdiCheck : mdiLockOutline}>
          {#if saving}
            <span class="flex items-center gap-2"><LoadingSpinner size="tiny" /> Changing…</span>
          {:else}
            Change password
          {/if}
        </Button>
      </div>
    </form>
  </section>
</div>
