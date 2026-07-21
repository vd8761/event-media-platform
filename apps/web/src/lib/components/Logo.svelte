<script lang="ts">
  // The EventLens mark. Kept as a component rather than three copies of the
  // same <img> because it appears in both top bars and on the login card.
  //
  // No background plate: the source is transparent and the blades read against
  // the light, dark and oled themes alike. The white gaps inside the ring are
  // holes, not white pixels, so they take on the page colour.
  interface Props {
    // Tailwind sizing, e.g. `size-8`. The mark is square.
    class?: string;
  }

  let { class: className = 'size-8' }: Props = $props();
</script>

<img src="/logo.png" alt="" width="256" height="256" class="shrink-0 {className}" />
