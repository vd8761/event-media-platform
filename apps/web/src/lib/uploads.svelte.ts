// Upload queue, held at module scope so it outlives any single route.
//
// This used to be `$state` inside the event page. Navigating anywhere — even
// to another page of the same event — destroyed that component, took the
// progress state with it, and abandoned the in-flight XHRs. Someone dropping
// in a camera roll had to sit and watch the page or lose the batch.
//
// Living here, the queue survives client-side navigation entirely: the store is
// created once per browser session and the layout renders the panel, so the
// only things that can stop an upload are a refresh or closing the tab — and
// `hasActive` drives a beforeunload prompt for those.
import { api, sha1Hex, uploadAsset, type AssetItem } from '$lib/api';
import type { UploadItem } from '$lib/components/UploadPanel.svelte';

// A long single-file queue is what made this look frozen on a big drop.
const UPLOAD_CONCURRENCY = 3;

// How long a finished, error-free batch stays on screen before clearing.
const DISMISS_AFTER_MS = 4000;

class UploadStore {
  #items = $state<UploadItem[]>([]);
  #nextId = 0;
  #dismissTimer: ReturnType<typeof setTimeout> | undefined;
  #duplicates = $state(0);

  // Assets accepted by the server but not yet in the event's own list. The
  // event page drains these so a photo appears the instant it lands, rather
  // than after the next poll — see `takeFresh`.
  #fresh = new Map<string, AssetItem[]>();

  get items(): UploadItem[] {
    return this.#items;
  }

  // Drives the beforeunload guard. Deliberately counts `pending` too: a queued
  // file that has not started yet is still lost on a refresh.
  get hasActive(): boolean {
    return this.#items.some(
      (item) => item.state === 'pending' || item.state === 'hashing' || item.state === 'uploading',
    );
  }

  get activeCount(): number {
    return this.#items.filter(
      (item) => item.state === 'pending' || item.state === 'hashing' || item.state === 'uploading',
    ).length;
  }

  // Nothing was uploaded and nothing will be, so a duplicate row is a dead
  // entry the user has to read past. The count survives in the header so the
  // outcome is still reported — it just does not occupy a row, and crucially it
  // no longer blocks the auto-dismiss below.
  #drop(id: number) {
    this.#items = this.#items.filter((item) => item.id !== id);
  }

  get duplicates(): number {
    return this.#duplicates;
  }

  dismiss() {
    this.#items = [];
    this.#duplicates = 0;
  }

  // Hand over the assets uploaded for an event since the last call. Returned
  // rather than pushed so the page stays the only thing that owns its list —
  // and clearing on read means a late poll cannot double-insert them.
  takeFresh(eventId: string): AssetItem[] {
    const assets = this.#fresh.get(eventId) ?? [];
    this.#fresh.delete(eventId);
    return assets;
  }

  // Mutating *through* the state array matters: holding a reference to the
  // original object and mutating that instead is the classic Svelte 5 trap —
  // the proxy keeps serving the stale value, so the bar freezes even though
  // the upload is fine.
  #patch(id: number, changes: Partial<UploadItem>) {
    const index = this.#items.findIndex((item) => item.id === id);
    if (index !== -1) {
      Object.assign(this.#items[index], changes);
    }
  }

  async #uploadOne(eventId: string, item: UploadItem, file: File) {
    try {
      this.#patch(item.id, { state: 'hashing' });

      // SHA-1 preflight — known duplicates are never sent (docs/plan/04 §3)
      const checksum = await sha1Hex(file);
      const { results } = await api.assets.bulkUploadCheck(eventId, [{ id: file.name, checksum }]);
      if (results[0]?.action === 'reject') {
        this.#drop(item.id);
        this.#duplicates += 1;
        return;
      }

      this.#patch(item.id, { state: 'uploading', progress: 0 });
      const result = await uploadAsset(eventId, file, (percent) => this.#patch(item.id, { progress: percent }));

      if (result.status === 'duplicate') {
        this.#drop(item.id);
        this.#duplicates += 1;
        return;
      }

      this.#patch(item.id, { state: 'done', progress: 100 });

      // Show it now. The server has the original; derivatives and face
      // detection follow asynchronously, and the grid already knows how to
      // render a not-yet-processed asset and poll it to completion. Waiting
      // for that pipeline before showing anything is what made a finished
      // upload look like it had gone nowhere.
      const queued = this.#fresh.get(eventId) ?? [];
      // A local object URL stands in for thumbUrl until the real derivative
      // exists, so the tile shows the actual photo rather than a placeholder.
      // The grid replaces this row wholesale on the next refresh.
      queued.unshift({
        id: result.id,
        type: file.type.startsWith('video/') ? 'video' : 'image',
        status: 'uploaded',
        originalFilename: file.name,
        capturedAt: null,
        createdAt: new Date().toISOString(),
        width: null,
        height: null,
        thumbhash: null,
        thumbUrl: URL.createObjectURL(file),
        previewUrl: null,
        facesDetectedAt: null,
        faceCount: 0,
      });
      this.#fresh.set(eventId, queued);
    } catch (error) {
      this.#patch(item.id, {
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Returns once every file in *this* batch has settled. The caller may go
  // away long before that; the queue does not care, which is the whole point.
  async enqueue(eventId: string, files: File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    if (this.#dismissTimer) {
      clearTimeout(this.#dismissTimer);
      this.#dismissTimer = undefined;
    }
    this.#duplicates = 0;

    const batch: UploadItem[] = files.map((file) => ({
      id: this.#nextId++,
      name: file.name,
      state: 'pending',
      progress: 0,
    }));
    this.#items = [...batch, ...this.#items];

    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const current = cursor++;
        await this.#uploadOne(eventId, batch[current], files[current]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));

    // Only a *failure* holds the panel open. Duplicates used to as well, which
    // meant one already-uploaded photo left the panel on screen indefinitely
    // with nothing actionable in it.
    if (this.#items.every((item) => item.state === 'done')) {
      this.#dismissTimer = setTimeout(() => this.dismiss(), DISMISS_AFTER_MS);
    }
  }
}

export const uploadStore = new UploadStore();
