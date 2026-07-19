<script lang="ts">
  import '../app.css';
  import { TooltipProvider } from '@immich/ui';

  let { children } = $props();
</script>

<!--
  Every @immich/ui IconButton passes `title` (falling back to aria-label), and
  the internal Button wraps that in a bits-ui Tooltip.Root. Tooltip.Root needs
  a Tooltip.Provider above it in the tree — without one, rendering an
  IconButton stalls, which silently truncated the People grid and stopped the
  photo viewer from mounting at all. Immich's own app wraps its root the same
  way; keep this provider at the very top of the tree.
-->
<TooltipProvider>
  {@render children()}
</TooltipProvider>
