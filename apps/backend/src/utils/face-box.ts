// Face boxes for the viewer overlay (the Immich AssetViewer treatment).
//
// Detection ran on the preview derivative, so boxes are in that image's pixel
// space. The browser renders the preview at whatever size fits the viewport,
// so coordinates are normalised to fractions of the image here and scaled back
// up client-side — no image dimensions need to travel with the box.
export interface FaceRow {
  id: string;
  personId: string | null;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
  imageWidth: number;
  imageHeight: number;
  personName: string | null;
  isHidden: boolean | null;
  faceAssetFaceId: string | null;
  participantName: string | null;
}

export interface FaceBox {
  id: string;
  personId: string | null;
  /** Display label, empty when nobody has named this person yet. */
  name: string;
  /** Fractions of the rendered image, 0–1. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when this face is the person's current cover portrait. */
  isCover: boolean;
}

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

export function toFaceBoxes(rows: FaceRow[]): FaceBox[] {
  return rows
    // hidden people stay hidden everywhere, including here
    .filter((row) => !row.isHidden)
    .map((row) => {
      const imageWidth = row.imageWidth || 1;
      const imageHeight = row.imageHeight || 1;
      const x1 = clamp01(row.boundingBoxX1 / imageWidth);
      const y1 = clamp01(row.boundingBoxY1 / imageHeight);
      const x2 = clamp01(row.boundingBoxX2 / imageWidth);
      const y2 = clamp01(row.boundingBoxY2 / imageHeight);

      return {
        id: row.id,
        personId: row.personId,
        // a named cluster wins; otherwise use the name the matched participant
        // gave us when they submitted their selfie
        name: row.personName?.trim() || row.participantName?.trim() || '',
        x: x1,
        y: y1,
        width: Math.max(0, x2 - x1),
        height: Math.max(0, y2 - y1),
        isCover: !!row.faceAssetFaceId && row.faceAssetFaceId === row.id,
      };
    })
    .filter((box) => box.width > 0 && box.height > 0);
}
