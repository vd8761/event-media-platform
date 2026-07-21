<script lang="ts">
  // Ported from immich/web/src/lib/components/asset-viewer/VideoNativeViewer.svelte,
  // built on the same media-chrome control bar so the controls, spacing and
  // hover behaviour match Immich exactly.
  //
  // Dropped from the port: HLS/adaptive streaming, the rendition menu and the
  // face editor. EventLens has no transcoding service, so there is a single
  // original to play and a quality switcher would be a control that does
  // nothing.
  import { Icon, LoadingSpinner } from '@immich/ui';
  import {
    mdiCheck,
    mdiChevronLeft,
    mdiChevronRight,
    mdiFullscreen,
    mdiFullscreenExit,
    mdiPause,
    mdiPlay,
    mdiVolumeHigh,
    mdiVolumeLow,
    mdiVolumeMedium,
    mdiVolumeMute,
  } from '@mdi/js';
  import 'media-chrome';
  import 'media-chrome/menu';

  interface Props {
    /** Streams the original file. */
    src: string;
    /** Shown while the first frame decodes. */
    poster?: string | null;
    loop?: boolean;
    autoplay?: boolean;
    onEnded?: () => void;
  }

  let { src, poster = null, loop = false, autoplay = true, onEnded }: Props = $props();

  let isLoading = $state(true);

  // Reset the spinner when the viewer moves to a different video: the element
  // is reused, so without this the next clip shows no loading state at all.
  $effect(() => {
    void src;
    isLoading = true;
  });
</script>

<div class="relative flex h-full w-full select-none place-content-center place-items-center">
  <media-controller class="h-full w-full bg-transparent">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      slot="media"
      {src}
      {loop}
      {autoplay}
      poster={poster ?? undefined}
      disablePictureInPicture
      playsinline
      class="h-full w-full object-contain"
      oncanplay={() => (isLoading = false)}
      onwaiting={() => (isLoading = true)}
      onplaying={() => (isLoading = false)}
      onended={onEnded}
    ></video>

    <media-settings-menu hidden anchor="auto" class="min-w-3xs rounded-xl shadow-sm">
      <Icon slot="checked-indicator" icon={mdiCheck} class="m-2" />
      <media-settings-menu-item class="mx-1 rounded-lg p-1 ps-2">
        Playback speed
        <Icon slot="suffix" icon={mdiChevronRight} class="m-2" />
        <media-playback-rate-menu slot="submenu" hidden rates="0.5 1 1.5 2">
          <Icon slot="back-icon" icon={mdiChevronLeft} class="m-2" />
          <span slot="title">Playback speed</span>
        </media-playback-rate-menu>
      </media-settings-menu-item>
    </media-settings-menu>

    <div class="flex h-32 w-full flex-col justify-end bg-linear-to-b to-black/80 px-4">
      <media-control-bar part="bottom" class="flex h-10 w-full gap-2">
        <media-play-button class="shrink-0 rounded-full p-2 outline-none">
          <Icon slot="play" icon={mdiPlay} />
          <Icon slot="pause" icon={mdiPause} />
        </media-play-button>
        <media-time-display showduration class="rounded-lg p-2 outline-none"></media-time-display>

        <span class="grow"></span>

        <div class="volume-wrapper shrink-0 rounded-full transition-colors duration-400">
          <media-volume-range class="h-full bg-none outline-none"></media-volume-range>
          <media-mute-button class="bg-none p-2 outline-none">
            <Icon slot="off" icon={mdiVolumeMute} />
            <Icon slot="low" icon={mdiVolumeLow} />
            <Icon slot="medium" icon={mdiVolumeMedium} />
            <Icon slot="high" icon={mdiVolumeHigh} />
          </media-mute-button>
        </div>

        <media-fullscreen-button class="shrink-0 rounded-full p-2 outline-none">
          <Icon slot="enter" icon={mdiFullscreen} />
          <Icon slot="exit" icon={mdiFullscreenExit} />
        </media-fullscreen-button>
        <media-settings-menu-button class="shrink-0 rounded-full p-2 outline-none"></media-settings-menu-button>
      </media-control-bar>
      <media-time-range class="h-8 w-full rounded-lg px-2 pb-3 outline-none"></media-time-range>
    </div>
  </media-controller>

  {#if isLoading}
    <div class="pointer-events-none absolute flex place-content-center place-items-center">
      <LoadingSpinner />
    </div>
  {/if}
</div>

<style>
  /* Same custom-property block as Immich's player, minus the HLS-only bits. */
  media-controller {
    --media-control-background: none;
    --media-control-hover-background: var(--immich-ui-light-100);
    --media-focus-box-shadow: 0 0 0 2px var(--immich-ui-dark);
    --media-font-family: var(--font-sans);
    --media-font-size: var(--text-base);
    --media-font-weight: var(--font-weight-medium);
    --media-menu-border-radius: var(--radius-xl);
    --media-menu-gap: var(--spacing);
    --media-menu-item-hover-background: var(--immich-ui-light-200);
    --media-menu-item-icon-height: 1em;
    --media-menu-item-indicator-height: 1em;
    --media-primary-color: var(--immich-ui-dark);
    --media-time-range-buffered-color: var(--immich-ui-dark-400);
    --media-time-range-hover-bottom: 0;
    --media-time-range-hover-height: 100%;
    --media-range-thumb-box-shadow: none;
    --media-range-thumb-opacity: 0;
    --media-range-thumb-transition: opacity 0.15s ease;
    --media-range-track-border-radius: 2px;
    --media-range-track-height: 3.5px;
    --media-range-padding: 0;
    --media-settings-menu-background: var(--immich-ui-light-100);
    --media-text-content-height: var(--text-base--line-height);
    --media-tooltip-arrow-display: none;
    --media-tooltip-border-radius: var(--radius-lg);
    --media-tooltip-background-color: var(--immich-ui-light-200);
    --media-tooltip-distance: 8px;
    --media-tooltip-padding: calc(var(--spacing) * 2) calc(var(--spacing) * 3.5);
  }

  media-time-display {
    font-variant-numeric: tabular-nums;
  }

  media-time-range,
  media-volume-range {
    --media-control-hover-background: none;
  }

  media-time-range:hover,
  media-volume-range:hover {
    --media-range-thumb-opacity: 1;
  }

  *::part(tooltip) {
    --media-font-size: var(--text-xs);
    --media-text-content-height: var(--text-xs--line-height);
    color: white;
  }

  /* :global — media-chrome sets this attribute itself, so Svelte's scoper
     cannot see any element matching it and would prune the rule. */
  :global(*[mediavolumeunavailable]) {
    --media-volume-range-display: none;
  }

  .volume-wrapper {
    --media-control-hover-background: none;
  }

  /* Volume slides open on hover/focus rather than always occupying the bar. */
  media-volume-range:has(+ media-mute-button) {
    padding: 0;
    margin: 0;
    width: 0;
    overflow: hidden;
    transition: width 0.4s ease-out;
  }

  .volume-wrapper:hover > media-volume-range,
  media-volume-range:has(+ media-mute-button:hover),
  media-volume-range:has(+ media-mute-button:focus),
  media-volume-range:has(+ media-mute-button:focus-within),
  media-volume-range:hover,
  media-volume-range:focus,
  media-volume-range:focus-within {
    padding: 0 calc(var(--spacing) * 2);
    margin-left: calc(var(--spacing) * 2);
    width: 70px;
  }
</style>
