<script lang="ts">
  // Redeeming a password reset link. Sits outside (app) deliberately — the
  // person opening it cannot sign in, so the authenticated layout guard would
  // bounce them to /login and strip the token from the URL on the way.
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import Logo from '$lib/components/Logo.svelte';
  import { Alert, Button, Heading, Input, LoadingSpinner } from '@immich/ui';

  const token = $derived(page.url.searchParams.get('token') ?? '');

  let next = $state('');
  let confirm = $state('');
  let saving = $state(false);
  let done = $state(false);
  let error = $state('');

  const mismatch = $derived(confirm.length > 0 && next !== confirm);
  const tooShort = $derived(next.length > 0 && next.length < 8);
  const canSubmit = $derived(!!token && next.length >= 8 && next === confirm && !saving);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    saving = true;
    error = '';
    try {
      await api.resetPassword(token, next);
      done = true;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not reset your password';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Set a new password — EventLens</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="w-full max-w-sm">
    <div class="mb-6 flex justify-center"><Logo /></div>

    {#if !token}
      <!-- No token at all: almost always a mail client that mangled the link
           on the way, so say what to do rather than just refusing. -->
      <Alert color="danger" title="This link is incomplete">
        <p class="text-sm">
          The reset link looks like it was cut short — some email apps do this. Try opening it again from the original
          email, or ask us to send a new one.
        </p>
      </Alert>
    {:else if done}
      <Alert color="success" title="Password set">
        <p class="text-sm">You can sign in with your new password now.</p>
      </Alert>
      <Button class="mt-4 w-full" onclick={() => goto('/login')}>Go to sign in</Button>
    {:else}
      <Heading size="large" class="mb-1 text-center">Set a new password</Heading>
      <p class="mb-6 text-center text-sm text-gray-500">This link works once.</p>

      {#if error}
        <div class="mb-4"><Alert color="danger" title={error} /></div>
      {/if}

      <form onsubmit={submit} class="flex flex-col gap-4">
        <label class="flex flex-col gap-1.5">
          <span class="text-sm font-medium">New password</span>
          <Input type="password" bind:value={next} autocomplete="new-password" required />
          {#if tooShort}
            <span class="text-xs text-amber-600">Use at least 8 characters.</span>
          {/if}
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-sm font-medium">Confirm new password</span>
          <Input type="password" bind:value={confirm} autocomplete="new-password" required />
          {#if mismatch}
            <span class="text-xs text-amber-600">These don't match.</span>
          {/if}
        </label>

        <Button type="submit" disabled={!canSubmit} class="w-full">
          {#if saving}
            <span class="flex items-center gap-2"><LoadingSpinner size="tiny" /> Setting…</span>
          {:else}
            Set password
          {/if}
        </Button>
      </form>
    {/if}
  </div>
</div>
