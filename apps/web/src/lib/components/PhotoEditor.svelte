<script lang="ts">
  // Lightweight editor opened from the viewer's "Editor" action — Immich's own
  // editor is a full crop/rotate/adjust route backed by its own asset-version
  // pipeline; this app has no such backend, so this is scoped to what's
  // achievable client-side: rotate in 90° steps and a draggable crop
  // rectangle, exported to a canvas and uploaded as a new photo through the
  // existing upload endpoint (docs/plan §upload) rather than replacing the
  // original.
  import { Button, Icon, IconButton, LoadingSpinner } from '@immich/ui';
  import { mdiClose, mdiRotateLeft, mdiRotateRight } from '@mdi/js';

  interface Props {
    src: string;
    filename: string;
    onCancel: () => void;
    onSave: (file: File) => Promise<void>;
  }

  let { src, filename, onCancel, onSave }: Props = $props();

  let imgEl = $state<HTMLImageElement | null>(null);
  let stageEl = $state<HTMLDivElement | null>(null);
  let imgLoaded = $state(false);
  let saving = $state(false);

  // Rotation is applied via CSS during preview and to the canvas at export
  // time — never to the source image, so the crop rectangle's fractional
  // coordinates always describe the *rotated* frame consistently.
  let rotation = $state(0); // 0 | 90 | 180 | 270
  const rotated = $derived(rotation === 90 || rotation === 270);

  // Crop rectangle in fractions (0..1) of the displayed, rotated image.
  let crop = $state({ x: 0, y: 0, w: 1, h: 1 });

  function resetCrop() {
    crop = { x: 0, y: 0, w: 1, h: 1 };
  }

  function rotateLeft() {
    rotation = (rotation + 270) % 360;
    resetCrop();
  }

  function rotateRight() {
    rotation = (rotation + 90) % 360;
    resetCrop();
  }

  function applyAspect(ratio: number | null) {
    if (ratio === null) {
      resetCrop();
      return;
    }
    // Fit the largest ratio-shaped box centered in the full frame.
    const frameRatio = 1; // fractions are already normalised to the frame
    let w = 1;
    let h = 1;
    if (ratio >= frameRatio) {
      h = 1 / ratio;
    } else {
      w = ratio;
    }
    crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }

  // --- drag interactions (fractions of the stage element) -----------------
  type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';
  let dragMode: DragMode | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartCrop = { x: 0, y: 0, w: 1, h: 1 };

  function toFraction(event: PointerEvent): { x: number; y: number } {
    const rect = stageEl!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }

  function startDrag(mode: DragMode, event: PointerEvent) {
    event.stopPropagation();
    dragMode = mode;
    const { x, y } = toFraction(event);
    dragStartX = x;
    dragStartY = y;
    dragStartCrop = { ...crop };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function clamp01(value: number) {
    return Math.min(1, Math.max(0, value));
  }

  function onDragMove(event: PointerEvent) {
    if (!dragMode) {
      return;
    }
    const { x, y } = toFraction(event);
    const dx = x - dragStartX;
    const dy = y - dragStartY;

    if (dragMode === 'move') {
      const w = dragStartCrop.w;
      const h = dragStartCrop.h;
      crop = {
        w,
        h,
        x: clamp01(Math.min(1 - w, Math.max(0, dragStartCrop.x + dx))),
        y: clamp01(Math.min(1 - h, Math.max(0, dragStartCrop.y + dy))),
      };
      return;
    }

    let { x: cx, y: cy, w: cw, h: ch } = dragStartCrop;
    const MIN = 0.08;
    if (dragMode.includes('w')) {
      const newX = clamp01(Math.min(cx + cw - MIN, dragStartCrop.x + dx));
      cw = cx + cw - newX;
      cx = newX;
    }
    if (dragMode.includes('e')) {
      cw = clamp01(Math.max(MIN, Math.min(1 - cx, dragStartCrop.w + dx)));
    }
    if (dragMode.includes('n')) {
      const newY = clamp01(Math.min(cy + ch - MIN, dragStartCrop.y + dy));
      ch = cy + ch - newY;
      cy = newY;
    }
    if (dragMode.includes('s')) {
      ch = clamp01(Math.max(MIN, Math.min(1 - cy, dragStartCrop.h + dy)));
    }
    crop = { x: cx, y: cy, w: cw, h: ch };
  }

  function endDrag() {
    dragMode = null;
  }

  async function save() {
    if (!imgEl) {
      return;
    }
    saving = true;
    try {
      const naturalW = imgEl.naturalWidth;
      const naturalH = imgEl.naturalHeight;
      const rotatedW = rotated ? naturalH : naturalW;
      const rotatedH = rotated ? naturalW : naturalH;

      // Draw the full image rotated into a canvas sized to the rotated frame.
      const rotatedCanvas = document.createElement('canvas');
      rotatedCanvas.width = rotatedW;
      rotatedCanvas.height = rotatedH;
      const rctx = rotatedCanvas.getContext('2d')!;
      rctx.translate(rotatedW / 2, rotatedH / 2);
      rctx.rotate((rotation * Math.PI) / 180);
      rctx.drawImage(imgEl, -naturalW / 2, -naturalH / 2);

      // Crop fractions apply directly to the rotated frame.
      const sx = crop.x * rotatedW;
      const sy = crop.y * rotatedH;
      const sw = crop.w * rotatedW;
      const sh = crop.h * rotatedH;

      const outCanvas = document.createElement('canvas');
      outCanvas.width = Math.round(sw);
      outCanvas.height = Math.round(sh);
      const octx = outCanvas.getContext('2d')!;
      octx.drawImage(rotatedCanvas, sx, sy, sw, sh, 0, 0, outCanvas.width, outCanvas.height);

      const blob = await new Promise<Blob | null>((resolve) => outCanvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) {
        throw new Error('Export failed');
      }
      const base = filename.replace(/\.[^.]+$/, '');
      const file = new File([blob], `${base}-edited.jpg`, { type: 'image/jpeg' });
      await onSave(file);
    } finally {
      saving = false;
    }
  }
</script>

<div class="viewer fixed inset-0 z-60 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Photo editor">
  <header class="flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent p-3">
    <div class="flex items-center gap-2">
      <IconButton icon={mdiClose} aria-label="Cancel" variant="ghost" color="secondary" onclick={onCancel} />
      <p class="text-white">Edit photo</p>
    </div>
    <Button loading={saving} disabled={!imgLoaded} onclick={save}>Save as new photo</Button>
  </header>

  <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
    <div
      bind:this={stageEl}
      class="relative max-h-full max-w-full touch-none select-none"
      onpointermove={onDragMove}
      onpointerup={endDrag}
      onpointercancel={endDrag}
    >
      <img
        bind:this={imgEl}
        {src}
        alt=""
        draggable="false"
        class="block max-h-[70vh] max-w-[80vw] transition-transform"
        style="transform: rotate({rotation}deg)"
        onload={() => (imgLoaded = true)}
      />

      {#if imgLoaded}
        <!-- dim everything outside the crop rect -->
        <div
          class="pointer-events-none absolute inset-0 bg-black/60"
          style="clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 {crop.y * 100}%, {(crop.x + crop.w) *
            100}% {crop.y * 100}%, {(crop.x + crop.w) * 100}% {(crop.y + crop.h) *
            100}%, {crop.x * 100}% {(crop.y + crop.h) * 100}%, {crop.x * 100}% {crop.y * 100}%, 0 {crop.y * 100}%)"
        ></div>

        <!-- crop rectangle -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute cursor-move border-2 border-white"
          style="left: {crop.x * 100}%; top: {crop.y * 100}%; width: {crop.w * 100}%; height: {crop.h * 100}%"
          onpointerdown={(event) => startDrag('move', event)}
        >
          {#each [['nw', 'start-0 top-0 cursor-nwse-resize'], ['ne', 'end-0 top-0 cursor-nesw-resize'], ['sw', 'start-0 bottom-0 cursor-nesw-resize'], ['se', 'end-0 bottom-0 cursor-nwse-resize']] as [corner, cls] (corner)}
            <div
              class="absolute {cls} z-10 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-immich-primary bg-white"
              onpointerdown={(event) => startDrag(corner as DragMode, event)}
            ></div>
          {/each}
        </div>
      {:else}
        <div class="absolute inset-0 flex items-center justify-center"><LoadingSpinner size="giant" /></div>
      {/if}
    </div>
  </div>

  <footer class="flex flex-wrap items-center justify-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-3">
    <IconButton icon={mdiRotateLeft} aria-label="Rotate left" variant="ghost" color="secondary" onclick={rotateLeft} />
    <IconButton icon={mdiRotateRight} aria-label="Rotate right" variant="ghost" color="secondary" onclick={rotateRight} />
    <div class="mx-2 h-6 w-px bg-white/20"></div>
    {#each [['Free', null], ['1:1', 1], ['4:3', 4 / 3], ['16:9', 16 / 9]] as [label, ratio] (label)}
      <button
        type="button"
        onclick={() => applyAspect(ratio as number | null)}
        class="rounded-full border border-white/30 px-3 py-1.5 text-sm text-white transition hover:bg-white/10"
      >
        {label}
      </button>
    {/each}
  </footer>
</div>

<style>
  .viewer :global(button) {
    color: rgba(255, 255, 255, 0.92);
  }
  .viewer :global(button:hover:not(:disabled)) {
    background-color: rgba(255, 255, 255, 0.14);
    color: #fff;
  }
</style>
