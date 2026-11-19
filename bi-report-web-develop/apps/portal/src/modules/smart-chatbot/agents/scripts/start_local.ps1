# Start unified SMART stack for local portal dev (one process on :8100).
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot | Split-Path -Parent
$VenvDir = "$env:USERPROFILE\.venvs\smart-agents"
$Py = "$VenvDir\Scripts\python.exe"

if (-not (Test-Path $Py)) {
    Write-Host "Creating venv at $VenvDir ..."
    New-Item -ItemType Directory -Force -Path (Split-Path $VenvDir) | Out-Null
    try {
        py -3.11 -m venv $VenvDir
    } catch {
        python -m venv $VenvDir
    }
}

Set-Location $Root
Write-Host "Syncing agent dependencies (pip install -e .) ..."
& $Py -m pip install -q -U pip 2>$null
& $Py -m pip install -q -e .
if ($LASTEXITCODE -ne 0) { throw "pip install -e . failed" }

& $Py scripts\bootstrap_local_env.py

Write-Host "Starting SMART unified stack on :8100 (orchestrator + SemantIQ + N.O.V.A. MCP mounts) ..."
& $Py -m smart_orchestrator.app
Write-Host "Portal: set SMART_ORCHESTRATOR_* in apps/portal/.env.local and restart npm run dev."
Write-Host "Check: http://localhost:3000/api/smart/status"
