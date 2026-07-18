// Immich system_metadata pattern (docs/plan/03 §2 `system_config`).
import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { SystemConfigKey } from 'src/enum';
import { DB } from 'src/schema';

// Same defaults as immich:server/src/config.ts (~line 310).
export interface FacialRecognitionConfig {
  modelName: string;
  minScore: number;
  maxDistance: number;
  minFaces: number;
}

export const FACIAL_RECOGNITION_DEFAULTS: FacialRecognitionConfig = {
  modelName: 'buffalo_l',
  minScore: 0.7,
  maxDistance: 0.5,
  minFaces: 3,
};

@Injectable()
export class SystemConfigRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async get<T>(key: SystemConfigKey): Promise<T | undefined> {
    const row = await this.db.selectFrom('systemConfig').select('value').where('key', '=', key).executeTakeFirst();
    return row?.value as T | undefined;
  }

  async set(key: SystemConfigKey, value: unknown): Promise<void> {
    await this.db
      .insertInto('systemConfig')
      .values({ key, value: JSON.stringify(value) })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(value) }))
      .execute();
  }

  async getFacialRecognitionConfig(): Promise<FacialRecognitionConfig> {
    const stored = await this.get<Partial<FacialRecognitionConfig>>(SystemConfigKey.FacialRecognition);
    return { ...FACIAL_RECOGNITION_DEFAULTS, ...stored };
  }
}
