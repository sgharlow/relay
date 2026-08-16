-- 032 — stop every future migration from silently locking out relay_dev.
--
-- 🔴 THE BUG 030 LEFT BEHIND, FOUND THE FIRST TIME IT MATTERED. Migration 030
-- created the least-privilege role and granted it
-- `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`. That reads
-- like a standing rule and is not one: `ON ALL TABLES` is resolved once, at the
-- moment it runs, against the tables that exist then. Every table created
-- afterwards is invisible to it.
--
-- So 031 created `email_send_attempts` and the very next read as relay_dev
-- failed with `permission denied for table email_send_attempts` — one day after
-- the privilege split shipped, on the first new table. Left alone, this would
-- have recurred on 033, 034 and every migration after, each time as a runtime
-- failure in whatever code happened to touch the new table first, and each time
-- looking like a bug in that code rather than in the grant.
--
-- ALTER DEFAULT PRIVILEGES IS THE STRUCTURAL ANSWER: a rule that applies to
-- tables that do not exist yet, instead of a step somebody has to remember in
-- every future migration. That is the portfolio's own preference — make the
-- forgotten step impossible rather than document it — and it is why this is not
-- simply a GRANT on 031's table and a note in a runbook.
--
-- ⚠️ IT BINDS TO THE CREATING ROLE. Default privileges are recorded per grantor,
-- and apply to objects created by the role that ran this statement. Migrations
-- run as `admin` (that is what .env.admin exists for), so `admin`'s defaults are
-- the ones that matter and this is correct as written. A table created by any
-- OTHER role would not be covered — which is a reason to keep creating them the
-- way we already do, not a reason to widen this.
--
-- Verified supported on Aurora DSQL before being written down (2026-08-15);
-- DSQL implements a subset of PostgreSQL and this is not a statement to assume.
--
-- Read alongside 030, which explains why the role exists at all: only Steve,
-- acting as sysadmin, writes to this database outside the product's own APIs.

-- The rule for everything created from here on.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO relay_dev;

-- And the one table that already slipped through, since the rule above is not
-- retroactive. 031 is the only migration between 030 and this one.
GRANT SELECT, INSERT, UPDATE, DELETE ON email_send_attempts TO relay_dev;

-- ⚠️ caregiver_leads STAYS READ-ONLY for relay_dev, exactly as 030 left it: it
-- is the G1 measurement table, and a laptop must not be able to write a row that
-- would later be read as real demand. The default-privileges rule above would
-- have granted writes on it had it been created after this point, so this is
-- recorded here as the standing exception rather than as an accident of
-- ordering.
REVOKE INSERT, UPDATE, DELETE ON caregiver_leads FROM relay_dev;
