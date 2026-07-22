<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import Logo from '$lib/components/Logo.svelte';
  import { Alert, Button, Heading, Input, PasswordInput } from '@immich/ui';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    loading = true;
    try {
      await api.login(email, password);
      await goto('/events');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Login — EventLens</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-immich-bg p-4">
  <div class="w-full max-w-md rounded-3xl border border-gray-200 p-10 shadow-sm">
    <div class="mb-8 text-center">
      <Logo class="mx-auto mb-4 size-14" />
      <Heading size="large">EventLens</Heading>
      <p class="mt-1 text-sm text-gray-500">Sign in to manage your events</p>
    </div>

    {#if error}
      <div class="mb-4"><Alert color="danger" title={error} /></div>
    {/if}

    <form onsubmit={onSubmit} class="flex flex-col gap-4">
      <div>
        <label for="email" class="immich-form-label mb-1 block text-sm">Email</label>
        <Input id="email" type="email" bind:value={email} required autocomplete="email" />
      </div>
      <div>
        <label for="password" class="immich-form-label mb-1 block text-sm">Password</label>
        <PasswordInput id="password" bind:value={password} required autocomplete="current-password" />
      </div>
      <Button type="submit" fullWidth loading={loading} disabled={loading}>Sign in</Button>
    </form>

    <!-- Reachable without an account: someone deciding whether to sign up
         should be able to read what we do with their data first. -->
    <p class="mt-8 text-center text-xs text-gray-500">
      <a href="/privacy" class="underline">Privacy Policy</a>
      <span class="mx-1.5">·</span>
      <a href="/terms" class="underline">Terms &amp; Conditions</a>
    </p>
  </div>
</div>
