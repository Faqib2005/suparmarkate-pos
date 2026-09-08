param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$ProjectName = "",
  [string]$EnvironmentFile = "",
  [string]$PostgresContainerName = "",
  [string]$RedisContainerName = "",
  [string]$ApiContainerName = "",
  [ValidateRange(1, 65535)]
  [int]$ApiPort = 4000,
  [ValidateRange(1, 65535)]
  [int]$PosWebSocketPort = 4001,
  [ValidateRange(1, 65535)]
  [int]$SystemHealthWebSocketPort = 4002,
  [ValidateRange(1, 65535)]
  [int]$PostgresPort = 5432,
  [ValidateRange(1, 65535)]
  [int]$RedisPort = 6379,
  [string]$BackupDir = "",
  [string]$LanIp = "",
  [switch]$ReuseImage,
  [switch]$ConfirmStableIp,
  [switch]$ConfirmUps,
  [switch]$ConfirmSeparateBackupDisk
)

$ErrorActionPreference = "Stop"

Set-Location $ProjectDir

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  throw "Please run this command from PowerShell as Administrator so Windows Firewall rules can be created."
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  throw "Docker was not found. Install Docker Desktop first, start it, then run this command again."
}

$dockerService = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
if ($dockerService -and $dockerService.Status -ne "Running") {
  Write-Host "Starting Docker Desktop service..."
  Start-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
}

Write-Host "Waiting for the Docker engine..."
$dockerDeadline = (Get-Date).AddMinutes(5)
$dockerReady = $false
do {
  docker info --format "{{.ServerVersion}}" *> $null
  if ($LASTEXITCODE -eq 0) {
    $dockerReady = $true
    break
  }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $dockerDeadline)
if (-not $dockerReady) {
  throw "Docker Desktop is installed but its engine did not become ready within five minutes."
}

function Test-UsableLanIp([string]$Address) {
  [System.Net.IPAddress]$parsedAddress = $null
  return (
    [System.Net.IPAddress]::TryParse($Address, [ref]$parsedAddress) -and
    $parsedAddress.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
    $Address -notlike "127.*" -and
    $Address -notlike "169.254.*" -and
    $Address -ne "0.0.0.0"
  )
}

$lanIp = $LanIp.Trim()
if ($lanIp) {
  if (-not (Test-UsableLanIp $lanIp)) {
    throw "The supplied -LanIp value is not a usable IPv4 address: $lanIp"
  }
  $assignedIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -eq $lanIp } |
    Select-Object -First 1
  if (-not $assignedIp) {
    throw "The supplied -LanIp address is not assigned to this computer: $lanIp"
  }
} else {
  $virtualInterfacePattern = "Loopback|vEthernet|WSL|Docker|Hyper-V|Default Switch|Tailscale|ZeroTier"
  $defaultRoutes = Get-NetRoute `
    -AddressFamily IPv4 `
    -DestinationPrefix "0.0.0.0/0" `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.NextHop -ne "0.0.0.0" } |
    Sort-Object RouteMetric, InterfaceMetric

  foreach ($route in $defaultRoutes) {
    $candidate = Get-NetIPAddress `
      -AddressFamily IPv4 `
      -InterfaceIndex $route.InterfaceIndex `
      -ErrorAction SilentlyContinue |
      Where-Object {
        (Test-UsableLanIp $_.IPAddress) -and
        $_.InterfaceAlias -notmatch $virtualInterfacePattern -and
        -not $_.SkipAsSource
      } |
      Select-Object -First 1
    if ($candidate) {
      $lanIp = $candidate.IPAddress
      break
    }
  }

  if (-not $lanIp) {
    $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        (Test-UsableLanIp $_.IPAddress) -and
        $_.InterfaceAlias -notmatch $virtualInterfacePattern -and
        $_.PrefixOrigin -ne "WellKnown" -and
        -not $_.SkipAsSource
      } |
      Sort-Object InterfaceMetric |
      Select-Object -First 1 -ExpandProperty IPAddress
  }
}
if (-not $lanIp) {
  throw "No usable LAN IPv4 address was detected. Connect the server to the store LAN or pass -LanIp explicitly."
}
$lanApiBaseUrl = "http://$lanIp`:$ApiPort"
$lanWebUrl = $lanApiBaseUrl
$env:MUHASEB_CURRENT_LAN_IP = $lanIp
function New-RandomHex([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

function Get-EnvFileValue([string]$Content, [string]$Name) {
  $match = [regex]::Match($Content, "(?m)^$([regex]::Escape($Name))=(.*)$")
  if (-not $match.Success) { return $null }
  return $match.Groups[1].Value.Trim().Trim('"')
}

function Set-EnvFileValue([string]$Path, [string]$Name, [string]$Value) {
  $content = if (Test-Path $Path) { Get-Content $Path -Raw } else { "" }
  $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
  $line = "$Name=$Value"
  if ([regex]::IsMatch($content, $pattern)) {
    $content = [regex]::Replace($content, $pattern, $line)
  } else {
    $content = $content.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
  }
  Set-Content -Path $Path -Value $content -Encoding UTF8
}

function Get-ContainerConfig([string]$ContainerName) {
  $json = docker inspect $ContainerName 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
  $items = $json | ConvertFrom-Json
  return @($items)[0]
}

function Get-ContainerEnvValue($Container, [string]$Name) {
  if (-not $Container -or -not $Container.Config.Env) { return $null }
  $prefix = "$Name="
  $entry = $Container.Config.Env |
    Where-Object { $_.StartsWith($prefix, [System.StringComparison]::Ordinal) } |
    Select-Object -First 1
  if (-not $entry) { return $null }
  return $entry.Substring($prefix.Length)
}

$requestedProjectName = $ProjectName.Trim().ToLowerInvariant()
$legacyPostgres = if (-not $requestedProjectName -or $requestedProjectName -eq "muhaseb-server-docker") {
  Get-ContainerConfig "muhaseb_postgres"
} else {
  $null
}
$existingComposeProject = if ($legacyPostgres) {
  $legacyPostgres.Config.Labels.'com.docker.compose.project'
} else {
  $null
}
$composeProjectName = if ($requestedProjectName) {
  $requestedProjectName
} elseif ($existingComposeProject) {
  $existingComposeProject
} else {
  "muhaseb-server-docker"
}
if ($composeProjectName -notmatch '^[a-z0-9][a-z0-9_-]*$') {
  throw "ProjectName must contain only lowercase letters, numbers, dashes or underscores: $composeProjectName"
}

$safeProjectName = $composeProjectName -replace '[^a-z0-9_-]', '-'
$useLegacyContainerNames = -not $requestedProjectName -or $composeProjectName -eq "muhaseb-server-docker"
$postgresContainer = if ($PostgresContainerName.Trim()) {
  $PostgresContainerName.Trim()
} elseif ($useLegacyContainerNames) {
  "muhaseb_postgres"
} else {
  "$safeProjectName-postgres"
}
$redisContainer = if ($RedisContainerName.Trim()) {
  $RedisContainerName.Trim()
} elseif ($useLegacyContainerNames) {
  "muhaseb_redis"
} else {
  "$safeProjectName-redis"
}
$apiContainer = if ($ApiContainerName.Trim()) {
  $ApiContainerName.Trim()
} elseif ($useLegacyContainerNames) {
  "muhaseb_api"
} else {
  "$safeProjectName-api"
}
foreach ($containerName in @($postgresContainer, $redisContainer, $apiContainer)) {
  if ($containerName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]+$') {
    throw "Invalid Docker container name: $containerName"
  }
}
if ((@($postgresContainer, $redisContainer, $apiContainer) | Select-Object -Unique).Count -ne 3) {
  throw "PostgreSQL, Redis and API container names must be different."
}

$ports = @($ApiPort, $PosWebSocketPort, $SystemHealthWebSocketPort, $PostgresPort, $RedisPort)
if (($ports | Select-Object -Unique).Count -ne $ports.Count) {
  throw "API, WebSocket, PostgreSQL and Redis host ports must be different."
}

$existingPostgres = Get-ContainerConfig $postgresContainer
$existingApi = Get-ContainerConfig $apiContainer
$composeEnvPath = if ($EnvironmentFile.Trim()) {
  if ([System.IO.Path]::IsPathRooted($EnvironmentFile)) {
    [System.IO.Path]::GetFullPath($EnvironmentFile)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $ProjectDir $EnvironmentFile))
  }
} elseif ($requestedProjectName -and $composeProjectName -ne "muhaseb-server-docker") {
  Join-Path $ProjectDir ".env.$safeProjectName"
} else {
  Join-Path $ProjectDir ".env"
}
$primaryEnvPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectDir ".env"))
if (-not $useLegacyContainerNames -and $composeEnvPath -eq $primaryEnvPath) {
  throw "A separate instance cannot use the primary .env file. Omit EnvironmentFile or use a distinct file such as .env.$safeProjectName."
}
$composeEnvDirectory = Split-Path -Parent $composeEnvPath
if ($composeEnvDirectory) {
  New-Item -ItemType Directory -Force -Path $composeEnvDirectory | Out-Null
}
$backupPath = if ($BackupDir.Trim()) {
  $BackupDir
} elseif ($requestedProjectName -and $composeProjectName -ne "muhaseb-server-docker") {
  Join-Path "D:\BelalBackups" $safeProjectName
} else {
  "D:\BelalBackups"
}
$resolvedBackupDir = [System.IO.Path]::GetFullPath($backupPath)
New-Item -ItemType Directory -Force -Path $resolvedBackupDir | Out-Null

$env:COMPOSE_PROJECT_NAME = $composeProjectName
$env:POSTGRES_CONTAINER_NAME = $postgresContainer
$env:REDIS_CONTAINER_NAME = $redisContainer
$env:API_CONTAINER_NAME = $apiContainer
$env:HOST_API_PORT = [string]$ApiPort
$env:HOST_POS_WS_PORT = [string]$PosWebSocketPort
$env:HOST_SYSTEM_HEALTH_WS_PORT = [string]$SystemHealthWebSocketPort
$env:HOST_POSTGRES_PORT = [string]$PostgresPort
$env:HOST_REDIS_PORT = [string]$RedisPort

$existingPostgresUser = Get-ContainerEnvValue $existingPostgres "POSTGRES_USER"
$existingPostgresDb = Get-ContainerEnvValue $existingPostgres "POSTGRES_DB"
$existingJwtSecret = Get-ContainerEnvValue $existingApi "JWT_SECRET"
$existingSeedAdminUsername = Get-ContainerEnvValue $existingApi "SEED_ADMIN_USERNAME"
$existingSeedAdminPassword = Get-ContainerEnvValue $existingApi "SEED_ADMIN_PASSWORD"
$fixedDatabasePassword = "supermarket_password"

if (-not (Test-Path $composeEnvPath)) {
  $jwtBytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($jwtBytes)
  } finally {
    $rng.Dispose()
  }
  $jwtSecret = if ($existingJwtSecret) { $existingJwtSecret } else { [Convert]::ToBase64String($jwtBytes) }
  $databasePassword = $fixedDatabasePassword
  $initialAdminPassword = if ($existingSeedAdminPassword) { $existingSeedAdminPassword } else { New-RandomHex 12 }
  $postgresUser = if ($existingPostgresUser) { $existingPostgresUser } else { "supermarket" }
  $postgresDb = if ($existingPostgresDb) { $existingPostgresDb } else { "supermarket_db" }
  $seedAdminUsername = if ($existingSeedAdminUsername) { $existingSeedAdminUsername } else { "admin" }

  @"
COMPOSE_PROJECT_NAME=$composeProjectName
POSTGRES_CONTAINER_NAME=$postgresContainer
REDIS_CONTAINER_NAME=$redisContainer
API_CONTAINER_NAME=$apiContainer
HOST_API_PORT=$ApiPort
HOST_POS_WS_PORT=$PosWebSocketPort
HOST_SYSTEM_HEALTH_WS_PORT=$SystemHealthWebSocketPort
HOST_POSTGRES_PORT=$PostgresPort
HOST_REDIS_PORT=$RedisPort
POSTGRES_USER=$postgresUser
POSTGRES_PASSWORD=$databasePassword
POSTGRES_DB=$postgresDb
JWT_SECRET=$jwtSecret
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
LAN_API_BASE_URL=$lanApiBaseUrl
PUBLIC_API_BASE_URL=$lanApiBaseUrl
MUHASEB_SERVER_LAN_IP=$lanIp
WEB_APP_ENABLED=true
MUHASEB_BACKUP_DIR=$resolvedBackupDir
SEED_ADMIN_USERNAME=$seedAdminUsername
SEED_ADMIN_PASSWORD=$initialAdminPassword
BACKUP_RETENTION_COUNT=7
BACKUP_SCHEDULE_ENABLED=true
DHCP_RESERVATION_CONFIRMED=$($ConfirmStableIp.IsPresent.ToString().ToLowerInvariant())
UPS_CONFIRMED=$($ConfirmUps.IsPresent.ToString().ToLowerInvariant())
BACKUP_SECOND_DISK_CONFIRMED=$($ConfirmSeparateBackupDisk.IsPresent.ToString().ToLowerInvariant())
"@ | Set-Content -Path $composeEnvPath -Encoding UTF8

  Write-Host "Created Docker environment file: $composeEnvPath"
  Write-Host ""
  if ($existingPostgres) {
    Write-Host "Existing Muhaseb installation detected. Database credentials, JWT secret and existing Admin password were preserved."
  } else {
    Write-Warning "Initial Admin credentials are shown once. Store them securely and change the password after first login."
    Write-Host "Initial Admin username: $seedAdminUsername"
    Write-Host "Initial Admin password: $initialAdminPassword"
  }
} else {
  Set-EnvFileValue $composeEnvPath "COMPOSE_PROJECT_NAME" $composeProjectName
  Set-EnvFileValue $composeEnvPath "POSTGRES_CONTAINER_NAME" $postgresContainer
  Set-EnvFileValue $composeEnvPath "REDIS_CONTAINER_NAME" $redisContainer
  Set-EnvFileValue $composeEnvPath "API_CONTAINER_NAME" $apiContainer
  Set-EnvFileValue $composeEnvPath "HOST_API_PORT" ([string]$ApiPort)
  Set-EnvFileValue $composeEnvPath "HOST_POS_WS_PORT" ([string]$PosWebSocketPort)
  Set-EnvFileValue $composeEnvPath "HOST_SYSTEM_HEALTH_WS_PORT" ([string]$SystemHealthWebSocketPort)
  Set-EnvFileValue $composeEnvPath "HOST_POSTGRES_PORT" ([string]$PostgresPort)
  Set-EnvFileValue $composeEnvPath "HOST_REDIS_PORT" ([string]$RedisPort)
  Set-EnvFileValue $composeEnvPath "POSTGRES_PASSWORD" $fixedDatabasePassword
  if ($existingPostgresUser) {
    Set-EnvFileValue $composeEnvPath "POSTGRES_USER" $existingPostgresUser
  }
  if ($existingPostgresDb) {
    Set-EnvFileValue $composeEnvPath "POSTGRES_DB" $existingPostgresDb
  }
  if ($existingJwtSecret) {
    Set-EnvFileValue $composeEnvPath "JWT_SECRET" $existingJwtSecret
  }
  if ($existingSeedAdminUsername) {
    Set-EnvFileValue $composeEnvPath "SEED_ADMIN_USERNAME" $existingSeedAdminUsername
  }
  if ($existingSeedAdminPassword) {
    Set-EnvFileValue $composeEnvPath "SEED_ADMIN_PASSWORD" $existingSeedAdminPassword
  }
  $composeEnvContent = Get-Content $composeEnvPath -Raw
  $storedLanIp = Get-EnvFileValue $composeEnvContent "MUHASEB_SERVER_LAN_IP"
  if (-not $storedLanIp) {
    Add-Content -Path $composeEnvPath -Value "MUHASEB_SERVER_LAN_IP=$lanIp"
    $storedLanIp = $lanIp
  }
  if ($storedLanIp -ne $lanIp) {
    Write-Warning "SERVER IP CHANGED: stored=$storedLanIp current=$lanIp"
    Write-Warning "Desktop and mobile clients may still point to the old IP. Configure a DHCP reservation/static IP before reopening the store."
  }
  if ($composeEnvContent -notmatch "(?m)^LAN_API_BASE_URL=") {
    Add-Content -Path $composeEnvPath -Value "LAN_API_BASE_URL=$lanApiBaseUrl"
  }
  if ($composeEnvContent -notmatch "(?m)^PUBLIC_API_BASE_URL=") {
    Add-Content -Path $composeEnvPath -Value "PUBLIC_API_BASE_URL=$lanApiBaseUrl"
  }
  if ($composeEnvContent -notmatch "(?m)^WEB_APP_ENABLED=") {
    Add-Content -Path $composeEnvPath -Value "WEB_APP_ENABLED=true"
  }
  if ($composeEnvContent -notmatch "(?m)^MUHASEB_BACKUP_DIR=") {
    Add-Content -Path $composeEnvPath -Value "MUHASEB_BACKUP_DIR=$resolvedBackupDir"
  }
  if ($composeEnvContent -notmatch "(?m)^JWT_SECRET=") {
    Write-Warning "JWT_SECRET is missing. It was not generated automatically because changing it would revoke active customer sessions."
  }
  if ($composeEnvContent -notmatch "(?m)^POSTGRES_PASSWORD=") {
    Write-Warning "This existing installation uses the legacy PostgreSQL credential fallback. Rotate it only in an approved maintenance window."
  }
  if ($ConfirmStableIp) {
    Set-EnvFileValue $composeEnvPath "DHCP_RESERVATION_CONFIRMED" "true"
  }
  if ($ConfirmUps) {
    Set-EnvFileValue $composeEnvPath "UPS_CONFIRMED" "true"
  }
  if ($ConfirmSeparateBackupDisk) {
    Set-EnvFileValue $composeEnvPath "BACKUP_SECOND_DISK_CONFIRMED" "true"
  }
}

Write-Host "Muhaseb LAN API URL: $lanApiBaseUrl"
Write-Host "Muhaseb LAN Web URL: $lanWebUrl"
Write-Host "Muhaseb backup folder: $resolvedBackupDir"
Write-Host "Muhaseb Docker project: $composeProjectName"
Write-Host "Muhaseb environment file: $composeEnvPath"
Write-Host "Muhaseb containers: $postgresContainer, $redisContainer, $apiContainer"

Write-Host "Configuring Windows Firewall for Muhaseb LAN ports..."
& (Join-Path $PSScriptRoot "configure-firewall.ps1") `
  -ApiPort $ApiPort `
  -PosWebSocketPort $PosWebSocketPort `
  -SystemHealthWebSocketPort $SystemHealthWebSocketPort `
  -InstanceName $(if ($useLegacyContainerNames) { "" } else { $composeProjectName })

$composeArgs = @(
  "compose",
  "--project-name", $composeProjectName,
  "--env-file", $composeEnvPath
)

Write-Host ""
Write-Host "Starting Muhaseb server stack with Docker Compose..."
$imageArchivePath = Join-Path $ProjectDir "muhaseb-api-local.tar"
if (Test-Path $imageArchivePath) {
  docker image inspect muhaseb-api:local *> $null
  if ($ReuseImage -and $LASTEXITCODE -eq 0) {
    Write-Host "Reusing the installed Muhaseb API image for startup."
  } else {
    Write-Host "Loading prebuilt Muhaseb API image..."
    docker load -i $imageArchivePath
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "Failed to load prebuilt API image."
      exit $LASTEXITCODE
    }
  }
} else {
  docker image inspect muhaseb-api:local *> $null
  if ($ReuseImage -and $LASTEXITCODE -eq 0) {
    Write-Host "Reusing the installed Muhaseb API image for startup."
  } else {
    Write-Host "No prebuilt API image found. Building Muhaseb API image locally..."
    & docker @composeArgs build --pull --no-cache api
    $buildExitCode = $LASTEXITCODE
    if ($buildExitCode -ne 0) {
      Write-Host ""
      Write-Host "Docker image build failed. Recent container state:"
      & docker @composeArgs ps
      exit $buildExitCode
    }
  }
}

& docker @composeArgs up -d --wait postgres redis
$composeExitCode = $LASTEXITCODE
if ($composeExitCode -ne 0) {
  Write-Host ""
  Write-Host "Docker Compose failed before the API could start. Recent container state:"
  & docker @composeArgs ps
  Write-Host ""
  Write-Host "Try restarting Docker Desktop. If Docker reports a missing snapshot, remove the local API image/cache and run this script again."
  exit $composeExitCode
}

Write-Host "Synchronizing the Muhaseb database credential..."
$composeEnvContent = Get-Content $composeEnvPath -Raw
$postgresUser = Get-EnvFileValue $composeEnvContent "POSTGRES_USER"
$postgresDb = Get-EnvFileValue $composeEnvContent "POSTGRES_DB"
if (-not $postgresUser) { $postgresUser = "supermarket" }
if (-not $postgresDb) { $postgresDb = "supermarket_db" }
$safePostgresRole = $postgresUser.Replace('"', '""')
$databaseCredentialSql = "ALTER ROLE `"$safePostgresRole`" WITH PASSWORD '$fixedDatabasePassword';"
$databaseCredentialSql | & docker @composeArgs exec -T postgres `
  psql --username $postgresUser --dbname $postgresDb --set ON_ERROR_STOP=on
$credentialExitCode = $LASTEXITCODE
if ($credentialExitCode -ne 0) {
  Write-Host "Failed to synchronize the PostgreSQL credential. The API was not started."
  exit $credentialExitCode
}

& docker @composeArgs up -d --wait api
$apiExitCode = $LASTEXITCODE
if ($apiExitCode -ne 0) {
  Write-Host ""
  Write-Host "Muhaseb API failed to start after PostgreSQL became healthy. Recent API logs:"
  & docker @composeArgs logs --tail=80 api
  exit $apiExitCode
}

Write-Host ""
Write-Host "Waiting for Muhaseb API health..."
$deadline = (Get-Date).AddMinutes(4)
do {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/health" -TimeoutSec 3
    if ($health.status -eq "ok") {
      if (-not $health.redis.connected) {
        Write-Warning "API is running, but Redis health is not connected."
        & docker @composeArgs ps
        exit 1
      }
      Write-Host "Muhaseb API is ready: http://127.0.0.1:$ApiPort"
      Write-Host "Muhaseb Web is ready: $lanWebUrl"
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 3
  }
} while ((Get-Date) -lt $deadline)

Write-Host "API was not healthy before timeout. Showing recent logs..."
& docker @composeArgs logs --tail=80 api
exit 1
