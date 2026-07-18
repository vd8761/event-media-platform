// Justified row layout — the Google-Photos/Immich look: each row is packed to
// the full container width with aspect ratios preserved (Immich uses
// @immich/justified-layout-wasm; this is the same greedy algorithm in plain
// TS, fine at event scale).

// Shape shared by every gallery surface that renders the timeline.
export interface TimelineAsset {
  id: string;
  thumbUrl: string | null;
  thumbhash: string | null;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
  createdAt?: string | null;
  status?: string;
}

export interface JustifiedBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface JustifiedResult {
  boxes: JustifiedBox[];
  containerHeight: number;
}

export function justifiedLayout(
  ratios: number[],
  options: { containerWidth: number; targetRowHeight: number; gap: number },
): JustifiedResult {
  const { containerWidth, targetRowHeight, gap } = options;
  const boxes: JustifiedBox[] = [];

  let top = 0;
  let rowStart = 0;
  let rowRatioSum = 0;

  const flushRow = (end: number, height: number) => {
    let left = 0;
    for (let index = rowStart; index < end; index++) {
      const width = ratios[index] * height;
      boxes.push({ top, left, width, height });
      left += width + gap;
    }
    top += height + gap;
    rowStart = end;
    rowRatioSum = 0;
  };

  for (let index = 0; index < ratios.length; index++) {
    rowRatioSum += ratios[index];
    const gaps = (index - rowStart) * gap;
    const rowHeight = (containerWidth - gaps) / rowRatioSum;
    if (rowHeight <= targetRowHeight) {
      // row is full — scale it to fit the container width exactly
      flushRow(index + 1, rowHeight);
    }
  }

  // last partial row renders at the target height, not stretched
  if (rowStart < ratios.length) {
    flushRow(ratios.length, targetRowHeight);
  }

  return { boxes, containerHeight: Math.max(0, top - gap) };
}
