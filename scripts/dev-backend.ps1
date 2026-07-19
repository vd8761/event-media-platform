# Local dev boot: all three worker roles in one process, pointed at the
# containers from docker/docker-compose.dev.yml.
#
# Postgres is on host port 5433 (a native Windows PostgreSQL usually owns 5432)
# and MinIO stands in for Cloudflare R2 with the same S3 API.
#
#   pnpm --filter backend build
#   powershell -File scripts/dev-backend.ps1
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$work = Join-Path $env:LOCALAPPDATA 'eventlens-dev'

$env:DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/eventlens'
$env:REDIS_URL = 'redis://localhost:6379'
$env:EL_ENV = 'development'
$env:EL_WORKERS_INCLUDE = 'api,ingest,media'
$env:MACHINE_LEARNING_URL = 'http://localhost:3003'
$env:EL_ML_DEVICE = 'cpu'
$env:R2_ENDPOINT = 'http://localhost:9000'
$env:R2_BUCKET = 'eventlens-media'
$env:R2_ACCESS_KEY_ID = 'eventlens'
$env:R2_SECRET_ACCESS_KEY = 'eventlens-secret'
$env:EL_STAGING_FOLDER = Join-Path $work 'staging'
$env:EL_CACHE_FOLDER = Join-Path $work 'cache'
$env:EMAIL_PROVIDER = 'smtp'
$env:SMTP_HOST = 'localhost'
$env:SMTP_PORT = '1025'
$env:EMAIL_FROM = 'EventLens <no-reply@eventlens.test>'
$env:EL_PUBLIC_BASE_URL = 'http://localhost:5173'

New-Item -ItemType Directory -Force -Path $env:EL_STAGING_FOLDER, $env:EL_CACHE_FOLDER | Out-Null

Set-Location (Join-Path $repo 'apps/backend')
node dist/main.js
