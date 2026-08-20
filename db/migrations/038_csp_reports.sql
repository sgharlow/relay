-- 038 — a sink for CSP violation reports that outlives a day.
--
-- 🔴 WHAT WAS WRONG. `next.config.mjs` has shipped a full
-- Content-Security-Policy-Report-Only header — including `script-src` — whose
-- stated purpose is a plan: "observe real traffic, remove what nothing needs,
-- then take the middleware decision on evidence." `/api/csp-report` received
-- those reports and wrote them to **stderr and nowhere else**.
--
-- Vercel runtime log retention was measured on 2026-08-20 at approximately 24
-- hours: a 7-day query and a 24-hour query returned identical counts, and
-- `/api/csp-report` did not appear among the 29 distinct request paths in the
-- retained window at all. So the evidence the plan depended on expired before
-- anybody could read it, and the decision it was meant to inform could never
-- arrive. A report-only header with a sink that forgets is a header that costs
-- bytes on every response and protects nothing — the "decorative guard" category
-- ROADMAP.md §1 had to invent to classify it.
--
-- ⚠️ READ "no reports observed" AS "we could not see", never as "no violations".
-- One day of mostly-synthetic traffic is not evidence in either direction.
--
-- ── WHY `disposition` IS THE COLUMN THAT MATTERS ────────────────────────────
-- From 2026-08-20 this product ships TWO policies at once: an ENFORCING one
-- (what is actually blocked today) and a stricter REPORT-ONLY one (the next
-- rung — the same policy with `unsafe-inline` and `unsafe-eval` removed from
-- script-src, which is the nonce/middleware question).
--
-- Both generate reports, to the same endpoint, in the same shape. Without
-- `disposition` the two are indistinguishable, and the difference is the whole
-- point: `enforce` means something on the live site was ACTUALLY BLOCKED and a
-- user may have seen a broken page; `report` means the stricter policy WOULD
-- have blocked it and nothing broke. Collapsing those would turn this table
-- into a pile of undifferentiated noise, which is a more expensive kind of
-- nothing than stderr was.
--
-- ── WHAT IS DELIBERATELY NOT STORED ─────────────────────────────────────────
-- `script-sample` — up to 40 characters of the offending inline script. On a
-- page that has just decrypted a vault item, forty characters of the DOM is
-- plaintext. The route already drops it explicitly rather than merely not
-- reading it, and there is no column here for it to land in even if that
-- changed. Two independent reasons it cannot be stored, which is the right
-- number for something that would be a zero-knowledge breach.
--
-- No owner id, no session, no IP. These reports arrive unauthenticated from
-- real browsers by design; this table is about the POLICY, not about people.
--
-- ── UNAUTHENTICATED WRITES, AND THE BOUND ON THEM ───────────────────────────
-- ⚠️ This is the first table in the product written by an endpoint that anybody
-- on the internet can POST to with no credential. That is not avoidable — a
-- browser sends CSP reports on its own, with no session — so the bound is
-- elsewhere and it is worth stating where:
--
--   * `/api/csp-report` rate-limits to 20/minute per client key, and
--   * caps the body at 8 KB and every stored field at 200 characters, and
--   * writes at most one row per violation in the body.
--
-- The rate limit is per-INSTANCE memory (lib/http/rate-limit.ts says so in its
-- own header), so on serverless it is a speed bump and not a wall. The real
-- protection is that a row is tiny and bounded. If this table ever needs
-- pruning, prune by `ts` — nothing references it and nothing depends on its
-- history beyond the window being studied.
--
-- ── NO GRANTS HERE, AND THAT IS DELIBERATE ──────────────────────────────────
-- 032 and 033 set `ALTER DEFAULT PRIVILEGES IN SCHEMA public` for relay_dev and
-- relay_app, so a table created from here on is readable and writable by the
-- application without a per-table GRANT. That rule binds to the CREATING role,
-- and migrations run as `admin` — the same identity that ran 032 and 033 — so it
-- applies. 031 is the counter-example: it created a table before 032 existed and
-- the first read as relay_dev failed with `permission denied`, silently, at
-- runtime.
--
-- ⚠️ If `npm run verify:schema` reports this table present but unreadable after
-- applying, that is this paragraph being wrong, and the fix is an explicit
-- GRANT rather than a shrug.
--
-- ── APPLY TO BOTH REGIONS, AND THE CODE IS SAFE EITHER WAY ──────────────────
-- `/api/csp-report` detects a missing relation (SQLSTATE 42P01) once, latches,
-- and falls back to stderr — exactly the shape lib/auth/signin-attempts.ts uses,
-- and a deliberate departure from 029, which threw when its table was absent and
-- took passkey sign-in down for four minutes while it was being applied.
--
-- A REPORTING endpoint especially must never escalate: it is called by a browser
-- that has just had something blocked, on a page a person is looking at, and the
-- response is discarded. There is no failure here worth turning into a second
-- failure.
--
--   npx tsx --env-file=.env.admin db/migrations/migrate.ts 038_csp_reports.sql
--
-- Feature: relay-h0-mvp

CREATE TABLE IF NOT EXISTS csp_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'enforce' = actually blocked on the live site. 'report' = the stricter
  -- policy would have blocked it and nothing broke. See the note above.
  disposition TEXT,
  -- e.g. 'script-src-elem'. The directive the browser actually evaluated.
  directive   TEXT,
  -- What was blocked. Often an origin; sometimes the literal 'inline' or 'eval'.
  blocked     TEXT,
  -- Page path only — the route strips the query string before it reaches here.
  document    TEXT
);

-- ASYNC because DSQL supports no other kind, and no sort order on the key
-- columns for the same reason (reference-aurora-dsql-migration-gotchas).
-- `ts` because every question asked of this table is "in the last N days";
-- `disposition` because the first cut is always enforce-vs-report.
CREATE INDEX ASYNC idx_csp_reports_ts ON csp_reports (ts);
CREATE INDEX ASYNC idx_csp_reports_disposition ON csp_reports (disposition);
