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
# RUN THIS FROM A NORMAL PowerShell in the repo root. No elevation is needed:
# the task runs as the user who registers it, so a User-scope variable is
# visible to it, and Register-ScheduledTask for your own account does not need
# administrator rights. (The 2026-09-01 version asked for an elevated shell and
# a Machine-scope variable; that requirement kept the task uninstalled for a
# day and was never what the scheduler needed.)
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
$envLocal = Join-Path $repo '.env.local'

if (-not (Test-Path (Join-Path $repo 'scripts\heartbeat-local.ts'))) {
  throw "heartbeat-local.ts not found under $repo — run this from the relay repo."
}

# 🔴 Both checks below ask what the SCHEDULER will see, not what this shell
# sees. A variable exported into this session only is invisible to the task,
# and a task that installs cleanly and then mutes itself is the failure this
# whole item exists to prevent. A watchdog that cannot alert is worse than no
# watchdog: its silence is indistinguishable from good news.
#
# The task can read a value from three places: a User-scope variable, a
# Machine-scope variable, or a line in the repo's gitignored .env.local
# (`npm run heartbeat` starts node with --env-file-if-exists=.env.local).
function Test-SchedulerVisible([string]$Name) {
  if ([Environment]::GetEnvironmentVariable($Name, 'User')) { return $true }
  if ([Environment]::GetEnvironmentVariable($Name, 'Machine')) { return $true }
  if ((Test-Path $envLocal) -and (Select-String -Path $envLocal -Pattern "^$Name=.+" -Quiet)) { return $true }
  return $false
}

# The address: where the alert goes.
$addr = [Environment]::GetEnvironmentVariable('OPS_ALERT_ADDRESS', 'User')
if (-not $addr) { $addr = [Environment]::GetEnvironmentVariable('OPS_ALERT_ADDRESS', 'Machine') }
if (-not $addr -and (Test-Path $envLocal)) {
  $m = Select-String -Path $envLocal -Pattern '^OPS_ALERT_ADDRESS=(.+)$' | Select-Object -First 1
  if ($m) { $addr = $m.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'") }
}
if (-not $addr) {
  throw @"
OPS_ALERT_ADDRESS is not visible to the scheduler.

The task would install and then refuse to run (exit 2) every time. Set it as a
USER-level variable (no elevation needed) and run this script again:

  [Environment]::SetEnvironmentVariable('OPS_ALERT_ADDRESS','you@example.com','User')
"@
}

# 🔴 The key: what the alert is sent WITH. Found 2026-09-02, the day after the
# "alert delivered" proof — that proof ran from a shell with RESEND_API_KEY
# exported, and the scheduler's environment has no such thing. Without this
# check the task would have detected a dead production and printed
# "ALERT COULD NOT BE SENT" every fifteen minutes, forever.
if (-not (Test-SchedulerVisible 'RESEND_API_KEY')) {
  throw @"
RESEND_API_KEY is not visible to the scheduler, so the task could detect a
failure and never tell anyone about it.

It is read from the repo's gitignored .env.local ($envLocal) — the same file the
app uses locally — or from a User/Machine-scope variable. Put it in .env.local
and run this script again. Do not paste it into a shell.
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
