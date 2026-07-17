// Slim port of immich:server/src/repositories/logging.repository.ts — a
// context-aware ConsoleLogger without the CLS correlation-id machinery.
import { ConsoleLogger, Injectable, Scope } from '@nestjs/common';
import { LogLevel } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';

const LOG_LEVELS = [LogLevel.Verbose, LogLevel.Debug, LogLevel.Log, LogLevel.Warn, LogLevel.Error, LogLevel.Fatal];

@Injectable({ scope: Scope.TRANSIENT })
export class LoggingRepository extends ConsoleLogger {
  constructor(configRepository: ConfigRepository) {
    super(LoggingRepository.name);
    const { logLevel, environment, noColor } = configRepository.getEnv();
    const level = logLevel ?? (environment === 'development' ? LogLevel.Debug : LogLevel.Log);
    this.setLogLevels(LOG_LEVELS.slice(LOG_LEVELS.indexOf(level)));
    if (noColor) {
      process.env.NO_COLOR = 'true';
    }
  }
}
