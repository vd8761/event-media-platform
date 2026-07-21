<script lang="ts">
  // Three-way theme control. `compact` renders a single cycling icon button
  // (Immich's navbar ThemeButton); the default is the segmented control shown
  // in the account panel.
  import { themeStore, THEMES, type ThemeName } from '$lib/theme.svelte';
  import { Icon, IconButton } from '@immich/ui';
  import { mdiCircleSlice8, mdiWeatherNight, mdiWhiteBalanceSunny } from '@mdi/js';

  let { compact = false }: { compact?: boolean } = $props();

  const icons: Record<ThemeName, string> = {
    oled: mdiCircleSlice8,
    dark: mdiWeatherNight,
    light: mdiWhiteBalanceSunny,
  };

  const order: ThemeName[] = THEMES.map((theme) => theme.value);
  const label = $derived(THEMES.find((theme) => theme.value === themeStore.value)?.label ?? 'Theme');

  function cycle() {
    const next = order[(order.indexOf(themeStore.value) + 1) % order.length];
    themeStore.set(next);
  }
</script>

{#if compact}
  <IconButton
    icon={icons[themeStore.value]}
    aria-label="Theme: {label} (click to change)"
    title="Theme: {label}"
    shape="round"
    variant="ghost"
    color="secondary"
    size="medium"
    onclick={cycle}
  />
{:else}

<div
  class="flex items-center gap-1 rounded-full bg-gray-100 p-1"
  role="radiogroup"
  aria-label="Theme"
>
  {#each THEMES as theme (theme.value)}
    <button
      type="button"
      role="radio"
      aria-checked={themeStore.value === theme.value}
      title="{theme.label} — {theme.description}"
      onclick={() => themeStore.set(theme.value)}
      class="flex h-9 flex-1 items-center justify-center rounded-full transition
        {themeStore.value === theme.value
        ? 'bg-immich-primary/15 text-immich-primary'
        : 'text-gray-500 hover:bg-gray-200/60'}"
    >
      <Icon icon={icons[theme.value]} size="1.125rem" />
      <span class="sr-only">{theme.label}</span>
    </button>
  {/each}
</div>
{/if}
