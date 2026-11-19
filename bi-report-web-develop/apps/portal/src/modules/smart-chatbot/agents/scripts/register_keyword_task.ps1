# Registers the nightly keyword-index job as a Windows scheduled task (runs as the current user, no admin needed).
#   Daily at 01:00. If the machine was off at 01:00, it runs once as soon as it is back ("StartWhenAvailable").
#   Incremental by default: only changed objects are re-enriched and re-embedded.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\register_keyword_task.ps1
# Remove: schtasks /Delete /TN "SMART-KeywordIndex-Nightly" /F

$ErrorActionPreference = 'Stop'
$agents = Split-Path -Parent $PSScriptRoot
$python = Join-Path $env:USERPROFILE '.venvs\smart-agents\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "Python venv not found at $python (see agents/README.md)" }

$start = (Get-Date -Hour 1 -Minute 0 -Second 0)
if ($start -le (Get-Date)) { $start = $start.AddDays(1) }
$boundary = $start.ToString('yyyy-MM-ddTHH:mm:ss')

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>SMART keyword index: nightly incremental refresh of measure and column synonyms in Qdrant.</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$boundary</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <StartWhenAvailable>true</StartWhenAvailable>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT8H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$python</Command>
      <Arguments>-m pbi_semantiq_agent.keyword_index</Arguments>
      <WorkingDirectory>$agents</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$file = Join-Path $env:TEMP 'smart_keyword_nightly.xml'
[System.IO.File]::WriteAllText($file, $xml, [System.Text.Encoding]::Unicode)
schtasks /Create /TN "SMART-KeywordIndex-Nightly" /XML $file /F | Out-Host
Remove-Item $file -ErrorAction SilentlyContinue
Write-Host "Registered: daily 01:00 (next run $boundary), working dir $agents"
