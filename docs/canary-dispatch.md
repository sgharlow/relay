# The canary dispatcher (`relay-canary-dispatch`, VICTUS)

> Added 2026-10-08. Steve's decision: the production canary's 15-minute cadence moves off
> GitHub cron to a local scheduled task on VICTUS that dispatches the workflow. The GitHub cron
> in `.github/workflows/production-canary.yml` is **kept** as redundancy.

## Why

GitHub drops sub-hourly schedules on this repo (B11, open since 2026-08-29): the canary's
`*/15` cron delivers about 5 of a designed 96 runs a day. Dispatching the same workflow from a
machine GitHub does not schedule restores the cadence without changing what the canary checks.

## Is 96 dispatches a day safe? Yes. Checked 2026-10-08, read from source.

Every check in `lib/ops/canary.ts → CHECKS` is a GET, or a POST that must be refused, and none
persists a row:

| Check | Request | Side effect |
|---|---|---|
| landing, caregiver landing, signup page | GET pages | none. The signup check GETs the **page**, not `/api/auth/signup`, so the per-instance signup limiter is never touched |
| forged verifier token | GET `/api/verify/<forged>` → 403 | none: refused at token verification |
| checkout requires a session | POST `/api/stripe/checkout` → 401 | none: `requireOwner` refuses **before** the checkout rate limiter |
| forged stripe webhook | POST `/api/stripe/webhook`, unsigned → 400 | none: refused before signature verification |
| scheduler / reminder dead-men | GET `/api/health/*` | read-only queries |

The canary sends no mail and uses no secrets. The off-GitHub heartbeat
(`scripts/heartbeat-local.ts`) has already run this same list against production every 15
minutes since 2026-09-02. Re-check this table whenever `CHECKS` changes.

## What counts the dispatched runs

`lib/ops/cadence-wall.ts → CANARY_COUNTED_EVENTS` (`schedule` + `workflow_dispatch`) is the one
definition. `scripts/check-cadence.ts` (cadence-watch) and the heartbeat's delivery half both
read it. If the dispatcher dies, the canary falls back to the cron's ~5/day: cadence-watch goes
red the next morning, and the heartbeat alerts once a 6h window holds no run at all.

## The job file

`C:\Users\sghar\CascadeProjects\__shared-tools\taskdeck\jobs\relay-canary-dispatch.cmd`. That
directory is gitignored in `__shared-tools`, so **this is the versioned copy. Edit both
together.**

```bat
@echo off
setlocal
set "RELAY=C:\Users\sghar\CascadeProjects\relay"
set "LOG=%RELAY%\.heartbeat\dispatch.log"
set "OUT=%TEMP%\relay-canary-dispatch.out"
if not exist "%RELAY%\.heartbeat" mkdir "%RELAY%\.heartbeat"

set "TS="
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')"`) do set "TS=%%T"

gh workflow run production-canary.yml -R sgharlow/relay > "%OUT%" 2>&1
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" goto ok

REM The first line of gh's output goes in through PowerShell, so text with & < > | cannot break the echo.
powershell -NoProfile -Command "$l = Get-Content -LiteralPath $env:OUT -TotalCount 1 -ErrorAction SilentlyContinue; Add-Content -LiteralPath $env:LOG -Value ('{0} FAIL rc={1} {2}' -f $env:TS, $env:RC, $l)"
exit /b %RC%

:ok
>>"%LOG%" echo %TS% ok
exit /b 0
```

(The live file also carries a REM header with the reasoning above.) It writes one line per run
to `relay\.heartbeat\dispatch.log`, which is gitignored with the rest of `.heartbeat/`:
`<utc> ok`, or `<utc> FAIL rc=<n> <first line of gh output>`. It needs `gh` signed in as an
account with the `workflow` scope (checked 2026-10-08: `sgharlow`, scopes include `workflow`).

## Registering the task

Use a normal (non-elevated) PowerShell, as user `sghar`. The settings match `\relay-heartbeat`:
interactive token, every 15 minutes indefinitely, starts on battery and keeps running on
battery, start-when-available, 10-minute limit, ignore a new instance while one is running.
Launched through TaskDeck's `run-hidden.vbs`, so no window flashes.

```powershell
$jobs = 'C:\Users\sghar\CascadeProjects\__shared-tools\taskdeck'
$action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\wscript.exe' `
  -Argument "//B //Nologo `"$jobs\bin\run-hidden.vbs`" `"$jobs\jobs\relay-canary-dispatch.cmd`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 15)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'relay-canary-dispatch' -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Relay: dispatch production-canary.yml every 15 min (GitHub drops the */15 cron; the cron stays as redundancy). Log: relay\.heartbeat\dispatch.log. Doc: relay docs/canary-dispatch.md'
```

## Verifying it, after the first two intervals

```powershell
schtasks /query /tn relay-canary-dispatch /v /fo list      # Logon Mode: Interactive only; Last Result: 0
Get-Content C:\Users\sghar\CascadeProjects\relay\.heartbeat\dispatch.log -Tail 3
gh run list -R sgharlow/relay --workflow production-canary.yml --event workflow_dispatch -L 3
npm run check:cadence                                      # the canary row counts schedule + workflow_dispatch
```

## Rolling it back (under a minute)

```powershell
Unregister-ScheduledTask -TaskName 'relay-canary-dispatch' -Confirm:$false
```

The cron keeps running regardless, so rolling back returns the canary to its pre-2026-10-08
state (~5 runs/day, cadence-watch red as before).
