<script lang="ts">
  // Scroll-triggered reveal used across the landing page.
  //
  // IntersectionObserver rather than a scroll listener: the browser does the
  // work off the main thread, and a scroll handler firing on every frame is
  // the classic way a marketing page ends up janky on a mid-range phone.
  //
  // Unobserves after firing. These animations are one-shot — re-playing them
  // every time a section scrolls back into view is the kind of motion that
  // reads as showing off rather than as guiding the eye.
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    // Stagger within a group. Kept small: past ~400ms a "sequence" starts to
    // feel like the page is loading slowly rather than assembling.
    delay?: number;
    // Distance travelled, in px. Subtle by default — MD3 motion moves things a
    // short way with an emphatic curve, it does not fly them in.
    distance?: number;
    class?: string;
  }

  let { children, delay = 0, distance = 24, class: className = '' }: Props = $props();

  let el = $state<HTMLElement | null>(null);
  let shown = $state(false);

  $effect(() => {
    if (!el) {
      return;
    }

    // Respect the OS setting. Someone who has asked for reduced motion gets the
    // content immediately, with no transform and no transition — the point is
    // that they still see everything, not that they see a faster animation.
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) {
      shown = true;
      return;
    }

    // Also cover the case where IntersectionObserver is unavailable: content
    // that never reveals would be content that is simply missing.
    if (typeof IntersectionObserver === 'undefined') {
      shown = true;
      return;
    }

    // Anything already on screen at mount is shown without waiting to be
    // told. Above-the-fold content should not depend on an observer callback
    // that, in a page which is not compositing (a background tab, a headless
    // renderer), may not arrive for a long time or at all.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      shown = true;
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            shown = true;
            observer.disconnect();
          }
        }
      },
      // Fires a little before the element reaches the viewport, so the motion
      // is finishing as it arrives rather than starting once it is already read.
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );

    observer.observe(el);

    // Failsafe. The animation is decoration; the content is not. If the
    // observer has not fired by now — because the tab was never displayed, or
    // the environment does not deliver callbacks — reveal anyway rather than
    // leaving the page permanently blank. A late fade is a cosmetic loss; an
    // invisible landing page is a total one.
    const failsafe = setTimeout(() => {
      shown = true;
      observer.disconnect();
    }, 2500);

    return () => {
      clearTimeout(failsafe);
      observer.disconnect();
    };
  });
</script>

<div
  bind:this={el}
  class="reveal {shown ? 'is-shown' : ''} {className}"
  style="--reveal-delay: {delay}ms; --reveal-distance: {distance}px;"
>
  {@render children()}
</div>

<style>
  .reveal {
    opacity: 0;
    transform: translateY(var(--reveal-distance));
    /* MD3 "emphasised decelerate": leaves quickly, settles gently. */
    transition:
      opacity 0.5s cubic-bezier(0.05, 0.7, 0.1, 1) var(--reveal-delay),
      transform 0.6s cubic-bezier(0.05, 0.7, 0.1, 1) var(--reveal-delay);
    /* Hint only while the animation is pending — leaving will-change on
       permanently keeps a compositor layer alive for no reason. */
    will-change: opacity, transform;
  }

  .reveal.is-shown {
    opacity: 1;
    transform: none;
    will-change: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }
</style>
