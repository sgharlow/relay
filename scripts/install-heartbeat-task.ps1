# B12.i — register the off-GitHub heartbeat as a Windows Scheduled Task.
#
# WHY A SCHEDULED TASK AND NOT A WORKFLOW. That is the whole point: the thing
# being watched is GitHub's own scheduler, which drops sub-hourly runs (~6/day
# against a designed 96, measured 2026-09-02, and it survived the billing
# reset). A watchdog scheduled by the system it watches shares that system's
# failure mode.
#
# WHAT IT RUNS: `npm run heartbeat` — a real production probe plus a read-only
# `gh api` delivery count. No credentials beyond the ones already on this
# machine, no writes, no cloud spend.
#
# ⚠️ RUN THIS FROM AN ELEVATED PowerShell in the repo root:
#     powershell -ExecutionPolicy Bypass -File scripts\install-heartbeat-task.ps1
#
# To remove it:
#     Unregister-ScheduledTask -TaskName 'relay-heartbeat' -Confirm:$false
#
# Feature: relay-h0-mvp
# Requirements: B12.i

param(
  [int]$IntervalMinutes = 15,
  [string]$TaskName = 'relay-heartbeat'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not (Test-Path (Join-Path $repo 'scripts\heartbeat-local.ts'))) {
  throw "heartbeat-local.ts not found under $repo — run this from the relay repo."
}

# 🔴 The address is checked HERE as well as in the script, because a task that
# installs cleanly and then mutes itself is the failure this whole item exists
# to prevent. A watchdog that cannot alert is worse than no watchdog: its
# silence is indistinguishable from good news.
$addr = $env:OPS_ALERT_ADDRESS
if (-not $addr) { $addr = $env:OPS_ALERT_EMAIL }
if (-not $addr) {
  throw @"
OPS_ALERT_ADDRESS is not set in this shell.

The task would install and then refuse to run (exit 2) every time. Set it as a
MACHINE-level variable so the scheduler sees it, not just this session:

  [Environment]::SetEnvironmentVariable('OPS_ALERT_ADDRESS','you@example.com','Machine')

Then open a new shell and run this script again.
"@
}

$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c npm run heartbeat >> `"$repo\.heartbeat\task.log`" 2>&1" `
  -WorkingDirectory $repo

# Repeat indefinitely from a start time in the past, so it begins on the next
# interval boundary rather than waiting for a reboot or a login.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

# ⚠️ Modern Standby freezes long-running node monitors on this hardware (a
# recorded portfolio gotcha), so the task is allowed to start on battery and is
# NOT stopped when the machine goes onto battery. WakeToRun is deliberately
# false: waking a sleeping laptop every 15 minutes to probe a website is a
# battery cost out of proportion to the signal.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

New-Item -ItemType Directory -Force -Path (Join-Path $repo '.heartbeat') | Out-Null

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description @"
Relay off-GitHub heartbeat (B12.i). Probes production directly and checks whether
GitHub is still delivering the scheduled canary. Alerts to $addr on failure.
Exists because GitHub drops sub-hourly schedules (~6 runs/day vs a designed 96),
so a watchdog must not be scheduled by the system it watches.
"@ -Force | Out-Null

Write-Host "Registered '$TaskName' — every $IntervalMinutes minutes, alerting to $addr."
Write-Host "Log: $repo\.heartbeat\task.log   Stamps: $repo\.heartbeat\runs.jsonl"
Write-Host ""
Write-Host "Run it once now to prove it works:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
