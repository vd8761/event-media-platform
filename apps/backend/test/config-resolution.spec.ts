// Pins the production-vs-local wiring that ConfigRepository resolves from env:
// one DATABASE_URL for both Neon and the local compose, one REDIS_URL that
// covers plain Redis and Upstash's TLS endpoint, and an email provider that
// can be either Resend or SMTP. None of this needs a live service.
import { clearEnvCache, ConfigRepository } from 'src/repositories/config.repository';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'REDIS_HOSTNAME',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_TLS',
  'EMAIL_PROVIDER',
  'EMAIL_FROM',
  'RESEND_API_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_FROM',
];

let saved: Record<string, string | undefined> = {};

const getEnv = () => new ConfigRepository().getEnv();

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  clearEnvCache();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  clearEnvCache();
});

describe('database configuration', () => {
  it('defaults to the local compose database with TLS off', () => {
    const { database } = getEnv();
    expect(database.config.url).toContain('localhost:5433');
    expect(database.config.ssl).toBe(false);
  });

  it('does not require TLS for a plain local URL', () => {
    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/eventlens';
    expect(getEnv().database.config.ssl).toBe(false);
  });

  it('verifies TLS for a Neon-style URL', () => {
    process.env.DATABASE_URL =
      'postgres://user:pw@ep-cool-name-123456.us-east-2.aws.neon.tech/eventlens?sslmode=require';
    expect(getEnv().database.config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('requires TLS for a remote host even without sslmode', () => {
    // Credentials must never cross the public internet in the clear just
    // because someone left sslmode off the URL.
    process.env.DATABASE_URL = 'postgres://user:pw@db.example.com:5432/eventlens';
    expect(getEnv().database.config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('honours sslmode=no-verify for self-signed certificates', () => {
    process.env.DATABASE_URL = 'postgres://user:pw@db.internal:5432/eventlens?sslmode=no-verify';
    expect(getEnv().database.config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('rejects a malformed connection string loudly', () => {
    process.env.DATABASE_URL = 'not-a-url';
    expect(() => getEnv()).toThrow(/not a valid connection string/);
  });
});

describe('redis configuration', () => {
  it('defaults to the local dev compose with no TLS', () => {
    const { redis } = getEnv();
    expect(redis.host).toBe('localhost');
    expect(redis.port).toBe(6379);
    expect(redis.tls).toBeUndefined();
  });

  it('enables TLS for an Upstash rediss:// URL', () => {
    process.env.REDIS_URL = 'rediss://default:sometoken@apn1-crisp-cat-12345.upstash.io:6379';
    const { redis } = getEnv();
    expect(redis.host).toBe('apn1-crisp-cat-12345.upstash.io');
    expect(redis.port).toBe(6379);
    expect(redis.username).toBe('default');
    expect(redis.password).toBe('sometoken');
    expect(redis.tls).toEqual({ servername: 'apn1-crisp-cat-12345.upstash.io' });
  });

  it('leaves TLS off for a plain redis:// URL and reads the db index', () => {
    process.env.REDIS_URL = 'redis://localhost:6379/3';
    const { redis } = getEnv();
    expect(redis.db).toBe(3);
    expect(redis.tls).toBeUndefined();
  });

  it('always sets the options BullMQ and Upstash require', () => {
    process.env.REDIS_URL = 'rediss://default:token@host.upstash.io:6379';
    const { redis } = getEnv();
    expect(redis.maxRetriesPerRequest).toBeNull();
    expect(redis.enableReadyCheck).toBe(false);
  });

  it('supports TLS on the discrete vars too', () => {
    process.env.REDIS_HOSTNAME = 'host.upstash.io';
    process.env.REDIS_TLS = 'true';
    expect(getEnv().redis.tls).toEqual({ servername: 'host.upstash.io' });
  });

  it('rejects a non-redis scheme', () => {
    process.env.REDIS_URL = 'http://localhost:6379';
    expect(() => getEnv()).toThrow(/redis:\/\/ or rediss:\/\//);
  });
});

describe('email configuration', () => {
  it('defaults to SMTP so the local Mailpit setup keeps working', () => {
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_PORT = '1025';
    const { email } = getEnv();
    expect(email.provider).toBe('smtp');
    expect(email.smtp.secure).toBe(false);
  });

  it('picks Resend automatically when only an API key is present', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const { email } = getEnv();
    expect(email.provider).toBe('resend');
    expect(email.resend.apiKey).toBe('re_test_key');
  });

  it('lets an explicit provider win over autodetection', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = 'smtp.resend.com';
    expect(getEnv().email.provider).toBe('smtp');
  });

  it('turns on implicit TLS for SMTP port 465', () => {
    process.env.SMTP_HOST = 'smtp.resend.com';
    process.env.SMTP_PORT = '465';
    expect(getEnv().email.smtp.secure).toBe(true);
  });

  it('allows SMTP_SECURE to override the port heuristic', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'false';
    expect(getEnv().email.smtp.secure).toBe(false);
  });

  it('still honours the legacy SMTP_FROM as the sender', () => {
    process.env.SMTP_FROM = 'EventLens <no-reply@example.com>';
    expect(getEnv().email.from).toBe('EventLens <no-reply@example.com>');
  });

  it('prefers EMAIL_FROM over the legacy SMTP_FROM', () => {
    process.env.SMTP_FROM = 'old@example.com';
    process.env.EMAIL_FROM = 'EventLens <hello@example.com>';
    expect(getEnv().email.from).toBe('EventLens <hello@example.com>');
  });
});
