# Redémarre Cornelius en production : scripts\stop.ps1 puis scripts\start.ps1.
# Usage : powershell -ExecutionPolicy Bypass -File scripts\restart.ps1 [-Build] [-NoPerception] [-TimeoutSeconds 60]
[CmdletBinding()]
param(
  [switch]$Build,
  [switch]$NoPerception,
  [int]$TimeoutSeconds = 60
)

& (Join-Path $PSScriptRoot 'stop.ps1')
& (Join-Path $PSScriptRoot 'start.ps1') -Build:$Build -NoPerception:$NoPerception -TimeoutSeconds $TimeoutSeconds
exit $LASTEXITCODE
