param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$ProjectName = "",
  [string]$EnvironmentFile = "",
  [string]$PostgresContainerName = "",
  [string]$RedisContainerName = "",
  [string]$ApiContainerName = "",
  [string]$TaskName = "",
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
  [ValidateSet("Docker", "Node")]
  [string]$Mode = "Docker",
  [string]$BackupDir = "",
  [string]$LanIp = ""
)

$ErrorActionPreference = "Stop"
$resolvedTaskName = if ($TaskName.Trim()) {
  $TaskName.Trim()
} elseif ($ProjectName.Trim()) {
  "Muhaseb API ($($ProjectName.Trim().ToLowerInvariant()))"
} else {
  "Muhaseb API"
}
$principalCheck = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script as Administrator to register the Muhaseb startup task."
}

if ($Mode -eq "Docker") {
  $powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $startScript = Join-Path $PSScriptRoot "start-docker-server.ps1"
  $taskArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", "`"$startScript`"",
    "-ProjectDir", "`"$ProjectDir`"",
    "-ApiPort", "$ApiPort",
    "-PosWebSocketPort", "$PosWebSocketPort",
    "-SystemHealthWebSocketPort", "$SystemHealthWebSocketPort",
    "-PostgresPort", "$PostgresPort",
    "-RedisPort", "$RedisPort",
    "-ReuseImage"
  )
  if ($ProjectName.Trim()) {
    $taskArguments += @("-ProjectName", "`"$($ProjectName.Trim())`"")
  }
  if ($EnvironmentFile.Trim()) {
    $taskArguments += @("-EnvironmentFile", "`"$($EnvironmentFile.Trim())`"")
  }
  if ($PostgresContainerName.Trim()) {
    $taskArguments += @("-PostgresContainerName", "`"$($PostgresContainerName.Trim())`"")
  }
  if ($RedisContainerName.Trim()) {
    $taskArguments += @("-RedisContainerName", "`"$($RedisContainerName.Trim())`"")
  }
  if ($ApiContainerName.Trim()) {
    $taskArguments += @("-ApiContainerName", "`"$($ApiContainerName.Trim())`"")
  }
  if ($BackupDir.Trim()) {
    $taskArguments += @("-BackupDir", "`"$($BackupDir.Trim())`"")
  }
  if ($LanIp.Trim()) {
    $taskArguments += @("-LanIp", "`"$($LanIp.Trim())`"")
  }
  $taskArguments = $taskArguments -join " "
  $action = New-ScheduledTaskAction `
    -Execute $powerShell `
    -Argument $taskArguments `
    -WorkingDirectory $ProjectDir
  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = @(
    New-ScheduledTaskTrigger -AtStartup
    New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  )
  $principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

  Register-ScheduledTask `
    -TaskName $resolvedTaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force

  Start-ScheduledTask -TaskName $resolvedTaskName
  Write-Host "Muhaseb Docker startup task registered for $currentUser and started."
  exit 0
}

$apiDir = Join-Path $ProjectDir "apps\api"
$node = (Get-Command node).Source
$tsx = Join-Path $ProjectDir "node_modules\tsx\dist\cli.mjs"
$entry = Join-Path $apiDir "src\index.ts"
$builtEntry = Join-Path $apiDir "dist\index.js"

if (-not (Test-Path $builtEntry) -and (-not (Test-Path $tsx) -or -not (Test-Path $entry))) {
  throw "API runtime not found. Run scripts\windows\install-server.ps1 first."
}

$argument = if (Test-Path $builtEntry) {
  "`"$builtEntry`""
} else {
  "`"$tsx`" `"$entry`""
}

$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument $argument `
  -WorkingDirectory $apiDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $resolvedTaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force

Start-ScheduledTask -TaskName $resolvedTaskName
Write-Host "Muhaseb API startup task registered and started."
