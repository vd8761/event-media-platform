// Ported from immich:server/src/repositories/machine-learning.repository.ts.
// Keeps detectFaces, the multipart getFormData, the /ping healthy-server map,
// and multi-URL failover. CLIP (encodeImage/encodeText) and OCR are deleted —
// EventLens only uses facial recognition (docs/plan/02 §2.2).
import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export enum ModelTask {
  FACIAL_RECOGNITION = 'facial-recognition',
  // Immich names the CLIP smart-search task 'clip'.
  SEARCH = 'clip',
}

export enum ModelType {
  DETECTION = 'detection',
  RECOGNITION = 'recognition',
  VISUAL = 'visual',
}

type ModelOptions = { modelName: string };

export type FaceDetectionOptions = ModelOptions & { minScore: number };

export type FacialRecognitionRequest = {
  [ModelTask.FACIAL_RECOGNITION]: {
    [ModelType.DETECTION]: ModelOptions & { options: { minScore: number } };
    [ModelType.RECOGNITION]: ModelOptions;
  };
};

export type ClipVisualRequest = { [ModelTask.SEARCH]: { [ModelType.VISUAL]: ModelOptions } };
// The service serialises the embedding to a pgvector-ready string.
export type ClipVisualResponse = { [ModelTask.SEARCH]: string };

type MlRequest = FacialRecognitionRequest | ClipVisualRequest;

export interface Face {
  boundingBox: BoundingBox;
  // JSON-serialized 512-float array — ready to insert into Postgres as-is
  // (immich_ml serialize_np_array)
  embedding: string;
  score: number;
}

export type FacialRecognitionResponse = { [ModelTask.FACIAL_RECOGNITION]: Face[] } & {
  imageHeight: number;
  imageWidth: number;
};
export type DetectedFaces = { faces: Face[]; imageHeight: number; imageWidth: number };

const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 2000;

@Injectable()
export class MachineLearningRepository {
  private healthyMap: Record<string, boolean> = {};
  private interval?: ReturnType<typeof setInterval>;
  private urls: string[];

  constructor(
    configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(MachineLearningRepository.name);
    this.urls = configRepository.getEnv().machineLearning.urls;
  }

  // called by the media-role bootstrap; api/ingest processes never ping
  startAvailabilityChecks() {
    this.tick();
    this.interval ??= setInterval(() => this.tick(), PING_INTERVAL_MS);
  }

  teardown() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  // Live probe for the admin system panel. Pings every configured URL and
  // reports round-trip latency — the cached healthyMap is only refreshed on
  // the media role, so the API process must measure it directly.
  async getServerStatus(): Promise<{ url: string; healthy: boolean; latencyMs: number | null }[]> {
    return Promise.all(
      this.urls.map(async (url) => {
        const started = Date.now();
        try {
          const response = await fetch(new URL('ping', url), { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
          return { url, healthy: response.ok, latencyMs: Date.now() - started };
        } catch {
          return { url, healthy: false, latencyMs: null };
        }
      }),
    );
  }

  async detectFaces(imagePath: string, { modelName, minScore }: FaceDetectionOptions): Promise<DetectedFaces> {
    const request: FacialRecognitionRequest = {
      [ModelTask.FACIAL_RECOGNITION]: {
        [ModelType.DETECTION]: { modelName, options: { minScore } },
        [ModelType.RECOGNITION]: { modelName },
      },
    };
    const response = await this.predict<FacialRecognitionResponse>(imagePath, request);
    return {
      imageHeight: response.imageHeight,
      imageWidth: response.imageWidth,
      faces: response[ModelTask.FACIAL_RECOGNITION],
    };
  }

  // CLIP visual embedding for smart / similar-photo search (immich
  // encodeImage). Returns the pgvector-ready serialised string the ML service
  // produces, ready to store in smart_search.embedding as-is.
  async encodeImage(imagePath: string, { modelName }: ModelOptions): Promise<string> {
    const request: ClipVisualRequest = {
      [ModelTask.SEARCH]: { [ModelType.VISUAL]: { modelName } },
    };
    const response = await this.predict<ClipVisualResponse>(imagePath, request);
    return response[ModelTask.SEARCH];
  }

  private async predict<T>(imagePath: string, config: MlRequest): Promise<T> {
    const formData = await this.getFormData(imagePath, config);

    for (const url of [
      // try healthy servers first
      ...this.urls.filter((url) => this.isHealthy(url)),
      ...this.urls.filter((url) => !this.isHealthy(url)),
    ]) {
      try {
        const response = await fetch(new URL('predict', url), { method: 'POST', body: formData });
        if (response.ok) {
          this.setHealthy(url, true);
          return response.json() as Promise<T>;
        }

        this.logger.warn(
          `Machine learning request to "${url}" failed with status ${response.status}: ${response.statusText}`,
        );
      } catch (error: Error | unknown) {
        this.logger.warn(
          `Machine learning request to "${url}" failed: ${error instanceof Error ? error.message : error}`,
        );
      }

      this.setHealthy(url, false);
    }

    throw new Error(`Machine learning request '${JSON.stringify(config)}' failed for all URLs`);
  }

  private async getFormData(imagePath: string, config: MlRequest): Promise<FormData> {
    const formData = new FormData();
    formData.append('entries', JSON.stringify(config));
    const fileBuffer = await readFile(imagePath);
    formData.append('image', new Blob([new Uint8Array(fileBuffer)]));
    return formData;
  }

  private tick() {
    for (const url of this.urls) {
      void this.check(url);
    }
  }

  private async check(url: string) {
    let healthy = false;
    try {
      const response = await fetch(new URL('ping', url), { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
      healthy = response.ok;
    } catch {
      // stays unhealthy
    }
    this.setHealthy(url, healthy);
  }

  private setHealthy(url: string, healthy: boolean) {
    if (this.healthyMap[url] !== healthy) {
      this.logger.log(`Machine learning server became ${healthy ? 'healthy' : 'unhealthy'} (${url}).`);
    }
    this.healthyMap[url] = healthy;
  }

  private isHealthy(url: string) {
    return this.healthyMap[url] ?? false;
  }
}
