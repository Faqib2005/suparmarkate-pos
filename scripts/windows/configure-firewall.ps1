param(
  [int]$ApiPort = 4000,
  [int]$PosWebSocketPort = 4001,
  [int]$SystemHealthWebSocketPort = 4002,
  [string]$InstanceName = ""
)

$ErrorActionPreference = "Stop"
$ruleSuffix = if ($InstanceName.Trim()) { " ($($InstanceName.Trim()))" } else { "" }

New-NetFirewallRule `
  -DisplayName "Muhaseb API LAN$ruleSuffix" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort $ApiPort `
  -Action Allow `
  -Profile Private `
  -ErrorAction SilentlyContinue | Out-Null

New-NetFirewallRule `
  -DisplayName "Muhaseb POS WebSocket LAN$ruleSuffix" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort $PosWebSocketPort `
  -Action Allow `
  -Profile Private `
  -ErrorAction SilentlyContinue | Out-Null

New-NetFirewallRule `
  -DisplayName "Muhaseb System Health WebSocket LAN$ruleSuffix" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort $SystemHealthWebSocketPort `
  -Action Allow `
  -Profile Private `
  -ErrorAction SilentlyContinue | Out-Null

Write-Host "Private-network firewall rules created for ports $ApiPort, $PosWebSocketPort and $SystemHealthWebSocketPort."
