# The canary dispatcher (`relay-canary-dispatch`, VICTUS)

> Added 2026-10-08. Steve's decision: the production canary's 15-minute cadence moves off
> GitHub cron to a local scheduled task on VICTUS that dispatches the workflow. The GitHub cron
> in `.github/workflows/production-canary.yml` is **kept** as redundancy.
>
> Extended later on 2026-10-08, same decision, same pattern: the task also dispatches
> `.github/workflows/scheduler-monitor.yml` every 30 minutes. Its cron is kept as redundancy too.

## Why

GitHub drops sub-hourly schedules on this repo (B11, open since 2026-08-29): the canary's
`*/15` cron delivers about 5 of a designed 96 runs a day, and the scheduler monitor's `*/30`
cron about 4 of 48 (cadence-watch run 37855784597: `scheduler-monitor.yml: 4 runs / 24h (floor
12, designed 48)`). Dispatching the same workflows from a machine GitHub does not schedule
restores the cadence without changing what either one checks.

## When each is dispatched

One task, one 15-minute grid, no state file:

- **canary**: every tick (96/day).
- **scheduler monitor**: only when the tick's UTC minute is in `[0,15)` or `[30,45)`. Any
  15-minute grid puts exactly two of its four hourly ticks in that set, so this is every second
  tick (48/day) whatever minute the task was registered on. The live task ticks at :07/:22/:37/:52
  (read off `dispatch.log`), so the scheduler monitor goes at :07 and :37.

  Stateless on purpose: a counter file would need its own failure handling, and a missed or late
  tick would shift it. The cost of the clock rule is that a tick delayed across a 15-minute
  boundary can skip one scheduler-monitor dispatch or double one; at a floor of 12/day neither
  is visible.

The timestamp and the flag come from one PowerShell clock read, so they cannot disagree.

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

## Is 48 scheduler-monitor dispatches a day safe? Yes. Checked 2026-10-08, read from source.

48/day is the cadence the workflow was designed for; the cron never delivered it.

| Step | Request | Side effect |
|---|---|---|
| probe | GET `/api/health/scheduler` (public, no auth), at most twice, 30s apart | none: `getSchedulerHealth` in `lib/release/scheduler-ledger.ts` is one `SELECT` |
| alarm | the job exits 1 | GitHub's own failed-run email to the owner. Nothing else sends mail |

It is dispatched with **no inputs**, so `health_url` takes its default: production. The canary
already GETs the same route on every run.

## What counts the dispatched runs

`lib/ops/cadence-wall.ts → DISPATCHABLE_COUNTED_EVENTS` (`schedule` + `workflow_dispatch`) is the
one definition, used by both `WATCHED` entries. `scripts/check-cadence.ts` (cadence-watch) and
the heartbeat's delivery half both read it. (It was `CANARY_COUNTED_EVENTS` until the scheduler
monitor joined.) If the dispatcher dies, each workflow falls back to its cron (~5/day canary,
~4/day scheduler monitor): cadence-watch goes red the next morning, and the heartbeat alerts once
a 6h window holds no canary run at all. The heartbeat watches only the canary's runs.

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

REM One clock read gives both the log timestamp and the scheduler-monitor flag (SM=1 when the UTC minute is in [0,15) or [30,45)).
set "TS="
set "SM=0"
for /f "usebackq tokens=1,2" %%T in (`powershell -NoProfile -Command "$n = [DateTime]::UtcNow; $m = $n.Minute; '{0} {1}' -f $n.ToString('yyyy-MM-ddTHH:mm:ssZ'), [int](($m -lt 15) -or (($m -ge 30) -and ($m -lt 45)))"`) do (
  set "TS=%%T"
  set "SM=%%U"
)

gh workflow run production-canary.yml -R sgharlow/relay > "%OUT%" 2>&1
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" goto canary_ok

REM The first line of gh's output goes in through PowerShell, so text with & < > | cannot break the echo.
powershell -NoProfile -Command "$l = Get-Content -LiteralPath $env:OUT -TotalCount 1 -ErrorAction SilentlyContinue; Add-Content -LiteralPath $env:LOG -Value ('{0} FAIL rc={1} {2}' -f $env:TS, $env:RC, $l)"
goto scheduler

:canary_ok
>>"%LOG%" echo %TS% ok

:scheduler
if not "%SM%"=="1" exit /b %RC%

gh workflow run scheduler-monitor.yml -R sgharlow/relay > "%OUT%" 2>&1
set "SRC=%ERRORLEVEL%"

if "%SRC%"=="0" goto scheduler_ok

powershell -NoProfile -Command "$l = Get-Content -LiteralPath $env:OUT -TotalCount 1 -ErrorAction SilentlyContinue; Add-Content -LiteralPath $env:LOG -Value ('{0} FAIL rc={1} {2} scheduler-monitor' -f $env:TS, $env:SRC, $l)"
exit /b %SRC%

:scheduler_ok
>>"%LOG%" echo %TS% ok scheduler-monitor
exit /b %RC%
```

(The live file also carries a REM header with the reasoning above; the two are otherwise
identical, CRLF in the live file.) It writes one line per dispatch to
`relay\.heartbeat\dispatch.log`, which is gitignored with the rest of `.heartbeat/`:

| Dispatch | Success | Failure |
|---|---|---|
| canary (unchanged) | `<utc> ok` | `<utc> FAIL rc=<n> <first line of gh output>` |
| scheduler monitor | `<utc> ok scheduler-monitor` | `<utc> FAIL rc=<n> <first line of gh output> scheduler-monitor` |

Nothing parses this log; people read it (TaskDeck only displays a job's log). The canary's
format is unchanged so existing readings stay valid. The task's exit code is the scheduler-monitor
dispatch's when that failed, otherwise the canary's. It needs `gh` signed in as an account with
the `workflow` scope (checked 2026-10-08: `sgharlow`, scopes include `workflow`).

Tested 2026-10-08 against copies that swap `gh workflow run` for the read-only `gh workflow view`
and log to a scratch file: both dispatches ok; scheduler monitor skipped; a scheduler-monitor
failure (a workflow name that does not exist → `FAIL rc=1 HTTP 404 … scheduler-monitor`, exit 1);
and the clock pinned to minutes 0, 7, 14, 15, 22, 29, 30, 37, 44, 45, 52 and 59, where the
scheduler monitor fired at exactly 0, 7, 14, 30, 37 and 44.

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
  -Settings $settings -Description 'Relay: dispatch production-canary.yml every 15 min and scheduler-monitor.yml every 30 (GitHub drops both crons; the crons stay as redundancy). Log: relay\.heartbeat\dispatch.log. Doc: relay docs/canary-dispatch.md'
```

The task registered on 2026-10-08 carries the earlier, canary-only description. Adding the
scheduler monitor changed only the job file, not the task, so the task was not re-registered.

## Verifying it, after the first two intervals

```powershell
schtasks /query /tn relay-canary-dispatch /v /fo list      # Logon Mode: Interactive only; Last Result: 0
Get-Content C:\Users\sghar\CascadeProjects\relay\.heartbeat\dispatch.log -Tail 3
gh run list -R sgharlow/relay --workflow production-canary.yml --event workflow_dispatch -L 3
gh run list -R sgharlow/relay --workflow scheduler-monitor.yml --event workflow_dispatch -L 3
npm run check:cadence                                      # both rows count schedule + workflow_dispatch
```

## Rolling it back (under a minute)

```powershell
Unregister-ScheduledTask -TaskName 'relay-canary-dispatch' -Confirm:$false
```

The crons keep running regardless, so rolling back returns both workflows to their
pre-2026-10-08 state (~5 and ~4 runs/day, cadence-watch red as before).

To drop only the scheduler monitor, restore the job file from this document's previous version
(`git log -p docs/canary-dispatch.md`). cadence-watch then reads the scheduler monitor red again.
