// Ported from immich:server/src/decorators.ts — @OnJob registry decorator and
// the parameter-chunking helpers; Immich's sql-tools/telemetry/api-history
// decorators are not needed here.
import { SetMetadata } from '@nestjs/common';
import _ from 'lodash';
import { JobName, MetadataKey, QueueName } from 'src/enum';

export type JobConfig = {
  name: JobName;
  queue: QueueName;
};
export const OnJob = (config: JobConfig) => SetMetadata(MetadataKey.JobConfig, config);

// PostgreSQL uses a 16-bit integer for the number of bound parameters, so any
// query binding a large ID list must be split into chunks.
export const DATABASE_PARAMETER_CHUNK_SIZE = 65_500;

export function Chunked(
  options: { paramIndex?: number; chunkSize?: number; mergeFn?: (results: any) => any } = {},
): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const parameterIndex = options.paramIndex ?? 0;
    const chunkSize = options.chunkSize || DATABASE_PARAMETER_CHUNK_SIZE;
    const mergeFn = options.mergeFn;
    descriptor.value = function (...arguments_: any[]) {
      const argument = arguments_[parameterIndex];

      if (Array.isArray(argument) && argument.length <= chunkSize) {
        return originalMethod.apply(this, arguments_);
      }

      return Promise.all(
        _.chunk(argument, chunkSize).map((chunk) => {
          return Reflect.apply(originalMethod, this, [
            ...arguments_.slice(0, parameterIndex),
            chunk,
            ...arguments_.slice(parameterIndex + 1),
          ]);
        }),
      ).then((results) => (mergeFn ? mergeFn(results) : results));
    };
  };
}

export function ChunkedArray(options?: { paramIndex?: number; chunkSize?: number }): MethodDecorator {
  return Chunked({ ...options, mergeFn: _.flatten });
}
