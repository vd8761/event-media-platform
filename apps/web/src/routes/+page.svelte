<script lang="ts">
  // Landing page. Shown to signed-out visitors; +page.ts sends anyone with a
  // live session straight to /photos.
  //
  // Structurally in the Google Photos mould — a big warm hero, then one idea
  // per band, each led by a demonstration rather than a screenshot — but the
  // surface treatment is Material 3: tonal containers, pill buttons, the MD3
  // type scale already defined in app.css, and emphasised-decelerate easing on
  // every transition.
  //
  // All motion is CSS — no animation library, nothing that has to be
  // downloaded before the page means anything. The only assets are the hero
  // mosaic's fifteen portraits, which are WebP and lazy below the first row.
  import Logo from '$lib/components/Logo.svelte';
  import Reveal from '$lib/components/Reveal.svelte';
  import { Icon } from '@immich/ui';
  import {
    mdiAccountGroupOutline,
    mdiCloudUploadOutline,
    mdiEmailFastOutline,
    mdiFaceRecognition,
    mdiImageMultipleOutline,
    mdiLockOutline,
    mdiMapMarkerOutline,
    mdiMenu,
    mdiShieldCheckOutline,
  } from '@mdi/js';

  let menuOpen = $state(false);

  // The hero mosaic. Generated portraits rather than photographs of real
  // people — a product about consent should not put someone's face on its own
  // front page without asking them.
  //
  // Served from /static as 400px WebP (the tiles render at ~160px CSS, so this
  // covers 2x displays with headroom). The originals were 1254px PNGs at ~2MB
  // each; at 30MB the hero would have cost more than the rest of the page
  // several times over.
  const TILES = [
    'a1', 'a2', 'a3', 'a4', 'a5',
    'b1', 'b2', 'b3', 'b4', 'b5',
    'c1', 'c2', 'c3', 'c4', 'c5',
  ];

  // Which tiles the imagined guest was matched in. Fixed rather than random so
  // the ring animation lands on the same faces on every load.
  const MATCHED = new Set([1, 4, 7, 9, 12]);

  const steps = [
    {
      icon: mdiCloudUploadOutline,
      title: 'Upload once',
      body: 'Drop in everything your photographers hand over, or import a folder straight from Google Drive or OneDrive. Thousands of photos, one go.',
    },
    {
      icon: mdiFaceRecognition,
      title: 'We find everyone',
      body: 'Faces are detected and grouped as the upload lands. Name the people who matter; leave the rest as they are.',
    },
    {
      icon: mdiEmailFastOutline,
      title: 'Guests get their own gallery',
      body: 'Each guest takes a selfie and receives a private link to just their photos. No scrolling through two thousand strangers.',
    },
  ];

  const features = [
    {
      icon: mdiImageMultipleOutline,
      title: 'Every event in one timeline',
      body: 'Every event you have run, newest first, with a scrubber that moves through months in one gesture.',
    },
    {
      icon: mdiAccountGroupOutline,
      title: 'People, not filenames',
      body: 'Clusters you can merge, rename and hide. The bride appears under her name, not as face_0412.',
    },
    {
      icon: mdiMapMarkerOutline,
      title: 'Where it happened',
      body: 'Geotagged photos land on a map, so a venue’s worth of coverage is one click rather than a search.',
    },
    {
      icon: mdiLockOutline,
      title: 'Private by default',
      body: 'Events start as drafts. Nothing is reachable until you publish it, and guest links can expire on a date you set.',
    },
  ];
</script>

<svelte:head>
  <title>EventLens — event photos, delivered to everyone in them</title>
  <meta
    name="description"
    content="Event organisers upload the photos once. EventLens finds every guest and sends each of them a private gallery of just their own."
  />
</svelte:head>

<div class="landing">
  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <header class="sticky top-0 z-50 border-b border-gray-200/70 bg-white/80 backdrop-blur-lg dark:border-white/10 dark:bg-neutral-950/80">
    <nav class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
      <a href="/" class="flex items-center gap-2.5" aria-label="EventLens home">
        <Logo />
        <span class="text-primary text-lg font-semibold">EventLens</span>
      </a>

      <div class="hidden items-center gap-1 md:flex">
        <a href="#how" class="nav-link text-gray-600">How it works</a>
        <a href="#features" class="nav-link text-gray-600">Features</a>
        <a href="#privacy" class="nav-link text-gray-600">Privacy</a>
        <a href="/login" class="cta ms-2">Sign in</a>
      </div>

      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 md:hidden dark:text-gray-300 dark:hover:bg-white/10"
        aria-label="Menu"
        aria-expanded={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}
      >
        <Icon icon={mdiMenu} size="1.5rem" />
      </button>
    </nav>

    {#if menuOpen}
      <div class="border-t border-gray-200/70 px-5 py-3 md:hidden dark:border-white/10">
        <a href="#how" class="mobile-link" onclick={() => (menuOpen = false)}>How it works</a>
        <a href="#features" class="mobile-link" onclick={() => (menuOpen = false)}>Features</a>
        <a href="#privacy" class="mobile-link" onclick={() => (menuOpen = false)}>Privacy</a>
        <a href="/login" class="cta mt-2 w-full justify-center" onclick={() => (menuOpen = false)}>Sign in</a>
      </div>
    {/if}
  </header>

  <!-- ── Hero ───────────────────────────────────────────────────────────── -->
  <section class="relative overflow-hidden px-5 pt-16 pb-20 sm:pt-24 sm:pb-28">
    <!-- Ambient wash. Two slow drifting blobs, well under the text contrast
         threshold, purely to stop a large white area reading as empty. -->
    <div class="blob blob-a" aria-hidden="true"></div>
    <div class="blob blob-b" aria-hidden="true"></div>

    <div class="relative mx-auto max-w-3xl text-center">
      <Reveal>
        <p class="mb-5 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
          <Icon icon={mdiFaceRecognition} size="1.1rem" />
          Face matching for event organisers
        </p>
      </Reveal>

      <Reveal delay={80}>
        <h1 class="text-4xl leading-[1.1] font-semibold tracking-tight sm:text-6xl">
          Every guest gets
          <span class="headline-accent">their own photos</span>
        </h1>
      </Reveal>

      <Reveal delay={160}>
        <p class="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-gray-600 dark:text-gray-300">
          Organising the event is enough work already. Upload the photos once and EventLens finds everyone in them,
          sending each guest a private gallery of just the shots they appear in.
        </p>
      </Reveal>

      <Reveal delay={240}>
        <div class="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a href="/login" class="cta cta-lg">Sign in</a>
          <a href="#how" class="cta-ghost cta-lg">See how it works</a>
        </div>
      </Reveal>
    </div>

    <!-- Hero demonstration: a grid of frames where matched faces light up in
         sequence. Shows the actual product idea in one glance, which a static
         screenshot of a photo grid cannot do. -->
    <Reveal delay={320} distance={36}>
      <div class="relative mx-auto mt-16 max-w-4xl">
        <div class="mosaic md-surface p-3 shadow-xl sm:p-4">
          <div class="grid grid-cols-3 gap-2.5 sm:grid-cols-5 sm:gap-3">
            {#each TILES as tile, index (tile)}
              {@const matched = MATCHED.has(index)}
              <div class="tile {matched ? 'tile-matched' : ''}" style="--tile-index: {index};" aria-hidden="true">
                <img
                  src="/landing/{tile}.webp"
                  alt=""
                  width="400"
                  height="400"
                  loading={index < 5 ? 'eager' : 'lazy'}
                  decoding="async"
                />
                {#if matched}
                  <span class="tile-ring"></span>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- Floating chip, deliberately overlapping the mosaic edge: MD3 likes
             a surface breaking its container to signal depth. -->
        <div class="chip">
          <Icon icon={mdiEmailFastOutline} size="1.15rem" />
          <span><strong>5 photos</strong> sent to Priya</span>
        </div>
      </div>
    </Reveal>
  </section>

  <!-- ── How it works ───────────────────────────────────────────────────── -->
  <section id="how" class="bg-immich-gray px-5 py-20 sm:py-28 dark:bg-neutral-900/40">
    <div class="mx-auto max-w-6xl">
      <Reveal>
        <h2 class="text-center text-3xl font-semibold tracking-tight sm:text-4xl">Three steps, then it runs itself</h2>
      </Reveal>

      <div class="mt-14 grid gap-6 md:grid-cols-3">
        {#each steps as step, index (step.title)}
          <Reveal delay={index * 100}>
            <div class="md-surface step h-full p-7">
              <span class="step-number">{index + 1}</span>
              <span class="step-icon"><Icon icon={step.icon} size="1.6rem" /></span>
              <h3 class="mt-5 text-xl font-semibold">{step.title}</h3>
              <p class="mt-2.5 leading-relaxed text-gray-600 dark:text-gray-300">{step.body}</p>
            </div>
          </Reveal>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── Features ───────────────────────────────────────────────────────── -->
  <section id="features" class="px-5 py-20 sm:py-28">
    <div class="mx-auto max-w-6xl">
      <Reveal>
        <h2 class="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Built for the volume a real event produces
        </h2>
      </Reveal>

      <div class="mt-14 grid gap-6 sm:grid-cols-2">
        {#each features as feature, index (feature.title)}
          <Reveal delay={index * 90}>
            <div class="md-surface feature h-full p-7">
              <span class="feature-icon"><Icon icon={feature.icon} size="1.5rem" /></span>
              <h3 class="mt-5 text-lg font-semibold">{feature.title}</h3>
              <p class="mt-2 leading-relaxed text-gray-600 dark:text-gray-300">{feature.body}</p>
            </div>
          </Reveal>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── Privacy ────────────────────────────────────────────────────────── -->
  <!-- Given the product runs facial recognition, saying nothing about privacy
       until the footer would be the conspicuous omission. -->
  <section id="privacy" class="px-5 pb-20 sm:pb-28">
    <div class="mx-auto max-w-6xl">
      <Reveal>
        <div class="privacy-band md-surface p-8 sm:p-12">
          <span class="feature-icon"><Icon icon={mdiShieldCheckOutline} size="1.5rem" /></span>
          <h2 class="mt-5 max-w-xl text-3xl font-semibold tracking-tight">
            Faces are sensitive. We treat them that way.
          </h2>
          <div class="mt-8 grid gap-6 sm:grid-cols-3">
            <div>
              <h3 class="font-semibold">Scoped to one event</h3>
              <p class="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                Face data never leaves the event it came from. There is no cross-event database and no identifying you
                somewhere else.
              </p>
            </div>
            <div>
              <h3 class="font-semibold">Selfies are deleted</h3>
              <p class="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                Automatically, 30 days after the event ends. It is only needed to make the match.
              </p>
            </div>
            <div>
              <h3 class="font-semibold">Never training data</h3>
              <p class="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                We do not sell face data, and we do not train models on it. Encrypted in transit and at rest.
              </p>
            </div>
          </div>
          <a href="/privacy" class="mt-8 inline-flex text-sm font-medium text-primary underline">
            Read the full privacy policy
          </a>
        </div>
      </Reveal>
    </div>
  </section>

  <!-- ── Footer ─────────────────────────────────────────────────────────── -->
  <footer class="border-t border-gray-200/70 px-5 py-12 dark:border-white/10">
    <div class="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <a href="/" class="flex items-center gap-2.5" aria-label="EventLens home">
          <Logo />
          <span class="text-primary text-lg font-semibold">EventLens</span>
        </a>
        <p class="mt-3 max-w-xs text-sm text-gray-500">
          Event photos, delivered to everyone in them.
        </p>
      </div>

      <div class="flex flex-col gap-2.5 text-sm sm:items-end">
        <a href="/privacy" class="footer-link text-gray-600">Privacy Policy</a>
        <a href="/terms" class="footer-link text-gray-600">Terms &amp; Conditions</a>
        <a href="https://touchmarkdes.com" class="footer-link text-gray-600" rel="noopener noreferrer" target="_blank">
          Touchmark Descience
        </a>
        <a href="mailto:info@touchmarkdes.com" class="footer-link text-gray-600">info@touchmarkdes.com</a>
      </div>
    </div>

    <div class="mx-auto mt-10 max-w-6xl border-t border-gray-200/70 pt-6 text-xs text-gray-500 dark:border-white/10">
      © {new Date().getFullYear()} Touchmark Descience Pvt. Ltd. All rights reserved.
    </div>
  </footer>
</div>

<style>
  /* Scoped to the landing page. The app shell has its own much denser
     treatment, and none of this should reach it. */

  .landing {
    background: rgb(var(--immich-bg));
    color: rgb(var(--immich-fg));

    /* MD3 "on-primary": the ink that sits on a filled primary surface.
       `--immich-primary` is repointed under .dark to a *pale* blue, so a
       hardcoded white here is unreadable in dark mode — which is exactly what
       it was. This has to flip with the surface it sits on. */
    --on-primary: 255 255 255;
  }

  :global(.dark) .landing {
    /* Near-black rather than pure black: against the pale dark-mode primary
       this keeps well past the 4.5:1 contrast floor without the harshness of
       #000 on a light tint. */
    --on-primary: 16 18 27;
  }

  /* --- navigation --- */
  /* No hardcoded grey here. app.css redefines the Tailwind neutral ramp under
     `.dark`, so `text-gray-600` in the markup resolves correctly in both
     themes — a literal rgb() would stay dark-on-dark, which is exactly the bug
     this replaced. */
  .nav-link {
    border-radius: 9999px;
    padding: 0.55rem 0.9rem;
    font-size: 0.925rem;
    font-weight: 500;
    transition: background-color 0.2s cubic-bezier(0.05, 0.7, 0.1, 1);
  }
  .nav-link:hover {
    background: rgb(var(--immich-fg) / 0.07);
  }

  .mobile-link {
    display: block;
    border-radius: 1rem;
    padding: 0.8rem 0.9rem;
    font-size: 0.95rem;
    font-weight: 500;
  }
  .mobile-link:hover {
    background: rgb(var(--immich-fg) / 0.07);
  }

  /* --- buttons (MD3 filled / tonal, 48dp floor) --- */
  .cta {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: rgb(var(--immich-primary));
    padding: 0 1.4rem;
    font-size: 0.925rem;
    font-weight: 600;
    color: rgb(var(--on-primary));
    transition:
      transform 0.2s cubic-bezier(0.05, 0.7, 0.1, 1),
      box-shadow 0.2s cubic-bezier(0.05, 0.7, 0.1, 1),
      filter 0.2s;
  }
  .cta:hover {
    box-shadow: 0 6px 20px rgb(var(--immich-primary) / 0.35);
    filter: brightness(1.06);
    transform: translateY(-1px);
  }
  .cta:active {
    transform: translateY(0);
  }

  .cta-ghost {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    border: 1px solid rgb(156 163 175 / 0.5);
    border-radius: 9999px;
    padding: 0 1.4rem;
    font-size: 0.925rem;
    font-weight: 600;
    transition:
      background-color 0.2s cubic-bezier(0.05, 0.7, 0.1, 1),
      transform 0.2s cubic-bezier(0.05, 0.7, 0.1, 1);
  }
  .cta-ghost:hover {
    background: rgb(var(--immich-fg) / 0.06);
    transform: translateY(-1px);
  }

  .cta-lg {
    min-height: 3.25rem;
    padding: 0 2rem;
    font-size: 1rem;
  }

  /* --- hero --- */
  .headline-accent {
    display: block;
    background: linear-gradient(
      100deg,
      rgb(var(--immich-primary)),
      rgb(var(--immich-primary) / 0.65) 55%,
      rgb(var(--immich-primary))
    );
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer 7s linear infinite;
  }

  @keyframes shimmer {
    to {
      background-position: 200% center;
    }
  }

  .blob {
    position: absolute;
    border-radius: 9999px;
    /* Large blur radius over a low-opacity fill: the cheap way to get a warm
       ambient wash without shipping a gradient image. */
    filter: blur(90px);
    opacity: 0.5;
    pointer-events: none;
  }
  .blob-a {
    top: -6rem;
    left: -4rem;
    height: 22rem;
    width: 22rem;
    background: rgb(var(--immich-primary) / 0.28);
    animation: drift-a 18s ease-in-out infinite;
  }
  .blob-b {
    top: 4rem;
    right: -6rem;
    height: 26rem;
    width: 26rem;
    background: rgb(236 72 153 / 0.18);
    animation: drift-b 22s ease-in-out infinite;
  }

  @keyframes drift-a {
    0%,
    100% {
      transform: translate(0, 0) scale(1);
    }
    50% {
      transform: translate(3rem, 2rem) scale(1.12);
    }
  }
  @keyframes drift-b {
    0%,
    100% {
      transform: translate(0, 0) scale(1);
    }
    50% {
      transform: translate(-2.5rem, 2.5rem) scale(1.08);
    }
  }

  /* --- hero mosaic --- */
  .tile {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 0.85rem;
    /* Holds the tile's shape before its image decodes, so the mosaic does not
       assemble out of blank gaps on a slow connection. */
    background: rgb(var(--immich-fg) / 0.06);
    animation: tile-in 0.6s cubic-bezier(0.05, 0.7, 0.1, 1) backwards;
    animation-delay: calc(var(--tile-index) * 45ms);
  }

  .tile img {
    height: 100%;
    width: 100%;
    object-fit: cover;
    /* width/height are set on the element so the box is reserved before the
       image lands; object-fit does the cropping. */
    display: block;
  }

  @keyframes tile-in {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
  }

  /* The matched tiles pulse a ring in sequence — this is the whole product
     idea, so it is the one place the page permits a looping animation. */
  .tile-matched {
    outline: 2px solid rgb(var(--immich-primary));
    outline-offset: 2px;
  }
  .tile-ring {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: rgb(var(--immich-primary) / 0.25);
    animation: pulse 3.2s ease-in-out infinite;
    animation-delay: calc(var(--tile-index) * 260ms);
  }

  @keyframes pulse {
    0%,
    70%,
    100% {
      opacity: 0;
    }
    35% {
      opacity: 1;
    }
  }

  .chip {
    position: absolute;
    bottom: -1.1rem;
    left: 50%;
    display: inline-flex;
    transform: translateX(-50%);
    align-items: center;
    gap: 0.5rem;
    border-radius: 9999px;
    background: rgb(var(--immich-primary));
    padding: 0.65rem 1.15rem;
    font-size: 0.875rem;
    color: rgb(var(--on-primary));
    white-space: nowrap;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
    animation: float 4.5s ease-in-out infinite;
  }

  @keyframes float {
    0%,
    100% {
      transform: translateX(-50%) translateY(0);
    }
    50% {
      transform: translateX(-50%) translateY(-7px);
    }
  }

  /* --- cards --- */
  .step,
  .feature {
    position: relative;
    transition:
      transform 0.3s cubic-bezier(0.05, 0.7, 0.1, 1),
      box-shadow 0.3s cubic-bezier(0.05, 0.7, 0.1, 1);
  }
  .step:hover,
  .feature:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.09);
  }

  .step-number {
    position: absolute;
    top: 1.35rem;
    right: 1.75rem;
    font-size: 2.75rem;
    font-weight: 700;
    line-height: 1;
    color: rgb(var(--immich-primary) / 0.14);
  }

  .step-icon,
  .feature-icon {
    display: inline-flex;
    height: 3.25rem;
    width: 3.25rem;
    align-items: center;
    justify-content: center;
    border-radius: 1rem;
    background: rgb(var(--immich-primary) / 0.12);
    color: rgb(var(--immich-primary));
  }

  .privacy-band {
    background:
      radial-gradient(90rem 30rem at 15% -20%, rgb(var(--immich-primary) / 0.1), transparent 60%),
      rgb(var(--immich-bg));
  }

  .footer-link {
    transition: color 0.2s;
  }
  .footer-link:hover {
    color: rgb(var(--immich-primary));
    text-decoration: underline;
  }

  /* Anchor links should not slam the section under the sticky header. */
  :global(html) {
    scroll-behavior: smooth;
  }
  section[id] {
    scroll-margin-top: 5rem;
  }

  /* One blanket opt-out. Everything above stays legible and correctly laid
     out with all motion removed — the animations are decoration, never the
     means by which content becomes visible. */
  @media (prefers-reduced-motion: reduce) {
    .headline-accent,
    .blob,
    .tile,
    .tile-ring,
    .chip {
      animation: none;
    }
    .step,
    .feature,
    .cta,
    .cta-ghost {
      transition: none;
    }
    .step:hover,
    .feature:hover,
    .cta:hover,
    .cta-ghost:hover {
      transform: none;
    }
    :global(html) {
      scroll-behavior: auto;
    }
  }
</style>
