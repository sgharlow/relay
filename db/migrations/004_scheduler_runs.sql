-- Scheduler run ledger — the CC9 dead-man's-switch for the heartbeat sweep.
--
-- The sweep's success signal is a side effect (rows transitioned), so the
-- ABSENCE of a run must itself be alarmable. Before this, the cron was never
-- scheduled at all and nothing detected it: the route exported only POST while
-- Vercel Cron issues GET, and no crons declaration existed in the repo.
--
-- Column names mirror SweepResult in lib/release/heartbeat.ts.
--
-- Requirements: 4.6, 4.7, CC9, J5-R7

CREATE TABLE IF NOT EXISTS scheduler_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job          TEXT        NOT NULL DEFAULT 'heartbeat',
  evaluated    INT         NOT NULL DEFAULT 0,
  transitioned INT         NOT NULL DEFAULT 0,
  failures     INT         NOT NULL DEFAULT 0,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_job_ran_at
  ON scheduler_runs (job, ran_at DESC);
