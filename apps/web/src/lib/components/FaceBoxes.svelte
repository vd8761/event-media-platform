<script lang="ts">
  // Face outlines drawn over the preview, the way Immich's viewer does it:
  // a thin box per detected face with the person's name underneath.
  //
  // Boxes arrive as fractions of the image (see utils/face-box.ts), so they are
  // positioned in % and need no knowledge of the rendered size. The parent must
  // shrink-wrap the <img> so this overlay covers exactly the painted pixels.
  import { Icon } from '@immich/ui';
  import { mdiAccountBoxOutline, mdiHelp } from '@mdi/js';

  export interface FaceBox {
    id: string;
    personId: string | null;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    isCover: boolean;
  }

  interface Props {
    faces: FaceBox[];
    /** Called when a face is activated; omit to render names without links. */
    onOpenPerson?: (personId: string) => void;
    /** Organiser-only: use this face as the person's portrait. */
    onSetCover?: (personId: string, faceId: string) => Promise<void>;
  }

  let { faces, onOpenPerson, onSetCover }: Props = $props();

  let busyFaceId = $state<string | null>(null);

  async function setCover(face: FaceBox) {
    if (!face.personId || !onSetCover || busyFaceId) {
      return;
    }
    busyFaceId = face.id;
    try {
      await onSetCover(face.personId, face.id);
    } finally {
      busyFaceId = null;
    }
  }
</script>

<div class="pointer-events-none absolute inset-0">
  {#each faces as face (face.id)}
    {@const clickable = !!face.personId && !!onOpenPerson}
    <div
      class="group/face pointer-events-auto absolute"
      style="left: {face.x * 100}%; top: {face.y * 100}%; width: {face.width * 100}%; height: {face.height * 100}%"
    >
      <!-- The outline is invisible until the face is hovered or focused. A
           permanent grid of boxes and name plates covers the photo you came to
           look at — especially on a group shot, where it becomes a wall of
           labels. Hover reveals one at a time. -->
      <button
        data-md-raw
        class="absolute inset-0 rounded-lg border-2 border-transparent transition
          group-hover/face:border-white/85 group-hover/face:shadow-[0_0_0_1px_rgba(0,0,0,0.35)]
          focus-visible:border-white focus-visible:shadow-[0_0_0_1px_rgba(0,0,0,0.35)] focus-visible:outline-none
          {clickable ? 'cursor-pointer' : 'cursor-default'}"
        aria-label={clickable ? `View photos of ${face.name || 'this person'}` : (face.name || 'Unidentified face')}
        onclick={() => clickable && onOpenPerson?.(face.personId!)}
      ></button>

      <!-- Name plate, pinned under the box. Hidden with the outline, and
           pointer-events-none while hidden so an invisible plate cannot
           swallow a click meant for the photo. -->
      <div
        class="absolute start-1/2 top-full flex -translate-x-1/2 translate-y-1.5 items-center gap-1 opacity-0
          transition-opacity group-hover/face:pointer-events-auto group-hover/face:opacity-100
          group-focus-within/face:pointer-events-auto group-focus-within/face:opacity-100"
        style="pointer-events: none"
      >
        <span
          class="md-label-medium flex max-w-[9rem] items-center gap-1 truncate rounded-full bg-black/75 px-2.5 py-1
            text-white backdrop-blur-sm transition group-hover/face:bg-black/90
            {clickable ? 'group-hover/face:underline' : ''}"
        >
          {#if !face.name}
            <Icon icon={mdiHelp} size="0.8rem" class="opacity-70" />
          {/if}
          {face.name || 'Unnamed'}
        </span>

        {#if onSetCover && face.personId}
          <button
            data-md-raw
            class="flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white opacity-0 transition
              group-hover/face:opacity-100 hover:bg-black/90 disabled:opacity-40
              {face.isCover ? 'text-amber-300 opacity-100' : ''}"
            title={face.isCover ? 'Already this person’s cover photo' : 'Use as this person’s cover photo'}
            disabled={face.isCover || busyFaceId === face.id}
            onclick={() => setCover(face)}
          >
            <Icon icon={mdiAccountBoxOutline} size="0.85rem" />
          </button>
        {/if}
      </div>
    </div>
  {/each}
</div>
