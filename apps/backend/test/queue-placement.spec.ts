// Which role owns which queue decides which machine does the work, and getting
// it wrong is expensive in both directions: a database-bound queue on the GPU
// box holds a GPU at idle, and a GPU queue on the API host has no GPU at all.
// The placements here are load-bearing, so they are pinned rather than left to
// whoever next edits the map.
import { QueueName, WorkerRole } from 'src/enum';
import { QUEUE_CONCURRENCY, QUEUE_ROLES } from 'src/types';
import { describe, expect, it } from 'vitest';

describe('queue placement', () => {
  it('keeps face detection on the GPU box', async () => {
    // The one queue that actually calls the ML sidecar.
    expect(QUEUE_ROLES[QueueName.FaceDetection]).toBe(WorkerRole.Media);
  });

  it('runs clustering on the API host, next to the database', async () => {
    // facialRecognition makes no ML call — it is a pgvector KNN loop. On the
    // GPU box every query crossed a region at concurrency 1.
    expect(QUEUE_ROLES[QueueName.FacialRecognition]).toBe(WorkerRole.Ingest);
  });

  it('keeps clustering single-consumer', async () => {
    // Risk R1: concurrent clustering creates duplicate persons for one face.
    // Moving the queue between hosts must never quietly relax this.
    expect(QUEUE_CONCURRENCY[QueueName.FacialRecognition]).toBe(1);
  });

  it('leaves no queue without an owning role', async () => {
    // A queue missing from the map is consumed by nobody and its jobs pile up
    // silently — there is no error, just work that never happens.
    for (const queue of Object.values(QueueName)) {
      expect(QUEUE_ROLES[queue], `${queue} has no role`).toBeDefined();
    }
  });
});
