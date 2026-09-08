param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$UploadsPath,
  [string]$CloneDatabaseName = "customer_clone_supermarket_test",
  [string]$OutputDirectory = "",
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if ($CloneDatabaseName -notmatch "^[a-zA-Z0-9_]+_supermarket_test$") {
  throw "CloneDatabaseName must end with _supermarket_test."
}
if ($CloneDatabaseName -match "(^|_)(prod|production|customer)($|_)" -and
    $CloneDatabaseName -notmatch "^customer_clone_") {
  throw "Unsafe clone database name."
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
} else {
  $RepoRoot = (Resolve-Path $RepoRoot).Path
}
$BackupFile = (Resolve-Path $BackupFile).Path

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputDirectory = Join-Path $RepoRoot "artifacts\inventory-forensics\$stamp"
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path

$manifest = [ordered]@{
  startedAtUtc = [DateTime]::UtcNow.ToString("o")
  backupFile = $BackupFile
  backupSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $BackupFile).Hash
  cloneDatabase = $CloneDatabaseName
  repoRoot = $RepoRoot
  uploadsPath = $null
  uploadsFiles = 0
}

if (-not [string]::IsNullOrWhiteSpace($UploadsPath)) {
  $UploadsPath = (Resolve-Path $UploadsPath).Path
  $uploadFiles = Get-ChildItem -LiteralPath $UploadsPath -File -Recurse
  $manifest.uploadsPath = $UploadsPath
  $manifest.uploadsFiles = @($uploadFiles).Count
  $uploadManifest = foreach ($file in $uploadFiles) {
    [ordered]@{
      path = $file.FullName.Substring($UploadsPath.Length).TrimStart("\")
      length = $file.Length
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash
    }
  }
  $uploadManifest | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $OutputDirectory "uploads-manifest.json") -Encoding UTF8
}

$manifest | ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath (Join-Path $OutputDirectory "run-manifest.json") -Encoding UTF8

Push-Location $RepoRoot
$previousDatabaseUrl = $env:DATABASE_URL
$previousNodeEnv = $env:NODE_ENV
$previousUseExisting = $env:STOCK_STRESS_USE_EXISTING_PRODUCTS

$apiSource = Join-Path $RepoRoot "apps\api\src"
$apiPrisma = Join-Path $RepoRoot "apps\api\prisma"
$apiPackage = Join-Path $RepoRoot "apps\api\package.json"
$rootPackage = Join-Path $RepoRoot "package.json"
$prismaConfig = Join-Path $RepoRoot "apps\api\prisma.config.ts"
$vitestConfig = Join-Path $RepoRoot "apps\api\vitest.stock-stress.config.ts"
$apiTsConfig = Join-Path $RepoRoot "apps\api\tsconfig.json"
$containerDatabaseUrl = "postgresql://supermarket_test:supermarket_test@host.docker.internal:55432/$CloneDatabaseName"

function Invoke-ApiContainer {
  param([Parameter(Mandatory = $true)][string]$Command)

  $dockerArguments = @(
    "run", "--rm", "--entrypoint", "sh",
    "-e", "DATABASE_URL=$containerDatabaseUrl",
    "-e", "NODE_ENV=test",
    "-e", "REDIS_URL=redis://host.docker.internal:56379",
    "-e", "STOCK_STRESS_USE_EXISTING_PRODUCTS=true",
    "-v", "${apiSource}:/app/apps/api/src",
    "-v", "${apiPrisma}:/app/apps/api/prisma",
    "-v", "${apiPackage}:/app/apps/api/package.json",
    "-v", "${rootPackage}:/app/package.json",
    "-v", "${prismaConfig}:/app/apps/api/prisma.config.ts",
    "-v", "${vitestConfig}:/app/apps/api/vitest.stock-stress.config.ts",
    "-v", "${apiTsConfig}:/app/apps/api/tsconfig.json",
    "-v", "${OutputDirectory}:/app/forensics-output"
  )
  foreach ($name in @(
    "STOCK_STRESS_PRODUCT_COUNT",
    "STOCK_STRESS_OPERATIONS_PER_PRODUCT",
    "STOCK_STRESS_PRODUCT_CONCURRENCY",
    "STOCK_STRESS_TEST_TIMEOUT_MS",
    "STOCK_STRESS_COMPLAINT_PRODUCTS"
  )) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      $dockerArguments += @("-e", "${name}=${value}")
    }
  }
  $dockerArguments += @("muhaseb-api:local", "-lc", $Command)
  & docker @dockerArguments
}

try {
  Write-Host "Starting isolated PostgreSQL and Redis test services..."
  docker compose -f docker-compose.test.yml up -d --wait postgres-test redis-test
  if ($LASTEXITCODE -ne 0) { throw "Test containers did not become healthy." }

  Write-Host "Validating backup archive before replacing the clone database..."
  docker cp $BackupFile "muhaseb_postgres_test:/tmp/customer-copy.dump"
  if ($LASTEXITCODE -ne 0) { throw "Could not copy backup into the test container." }
  docker exec muhaseb_postgres_test pg_restore --list /tmp/customer-copy.dump | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "pg_restore rejected the backup archive." }

  Write-Host "Recreating ONLY the isolated clone database: $CloneDatabaseName"
  docker exec muhaseb_postgres_test psql -v ON_ERROR_STOP=1 -U supermarket_test -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$CloneDatabaseName' AND pid <> pg_backend_pid();"
  if ($LASTEXITCODE -ne 0) { throw "Could not terminate clone database sessions." }
  docker exec muhaseb_postgres_test dropdb --if-exists -U supermarket_test $CloneDatabaseName
  if ($LASTEXITCODE -ne 0) { throw "Could not drop the old clone database." }
  docker exec muhaseb_postgres_test createdb -U supermarket_test $CloneDatabaseName
  if ($LASTEXITCODE -ne 0) { throw "Could not create the clone database." }
  docker exec muhaseb_postgres_test pg_restore --exit-on-error --no-owner --no-privileges -U supermarket_test -d $CloneDatabaseName /tmp/customer-copy.dump
  if ($LASTEXITCODE -ne 0) { throw "Restore into the isolated clone failed." }

  $env:DATABASE_URL = "postgresql://supermarket_test:supermarket_test@127.0.0.1:55432/$CloneDatabaseName"
  $env:NODE_ENV = "test"
  $env:STOCK_STRESS_USE_EXISTING_PRODUCTS = "true"

  Write-Host "Applying forward-only migrations to the clone..."
  Invoke-ApiContainer "cd /app && npm run prisma:generate >/dev/null && npm run prisma:deploy"
  if ($LASTEXITCODE -ne 0) { throw "Migration deploy failed on the clone." }

  $preflight = Join-Path $OutputDirectory "preflight.json"
  $postflight = Join-Path $OutputDirectory "postflight.json"
  $comparison = Join-Path $OutputDirectory "comparison.json"

  Write-Host "Capturing historical preflight findings..."
  Invoke-ApiContainer "cd /app && npm run integrity:audit -- --label=inventory-forensics-preflight --output=/app/forensics-output/preflight.json"
  if ($LASTEXITCODE -notin @(0, 2)) { throw "Preflight audit failed to run." }

  Write-Host "Running randomized stock test on the clone..."
  Invoke-ApiContainer "cd /app && npm run test:stock-stress"
  if ($LASTEXITCODE -ne 0) { throw "Randomized inventory test failed." }

  Write-Host "Capturing postflight and classifying only new findings..."
  Invoke-ApiContainer "cd /app && npm run integrity:audit -- --label=inventory-forensics-postflight --output=/app/forensics-output/postflight.json"
  if ($LASTEXITCODE -notin @(0, 2)) { throw "Postflight audit failed to run." }
  Invoke-ApiContainer "cd /app && npm --workspace @supermarket/api run inventory:forensics:compare -- --before=/app/forensics-output/preflight.json --after=/app/forensics-output/postflight.json --output=/app/forensics-output/comparison.json"
  if ($LASTEXITCODE -ne 0) { throw "New integrity findings were created during the test." }

  Write-Host "Inventory forensic run passed. Evidence: $OutputDirectory"
} finally {
  $env:DATABASE_URL = $previousDatabaseUrl
  $env:NODE_ENV = $previousNodeEnv
  $env:STOCK_STRESS_USE_EXISTING_PRODUCTS = $previousUseExisting
  Pop-Location
}
