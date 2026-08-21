-- 039 — `relay_ro`: a database identity that can only READ.
--
-- WHY THIS EXISTS. Relay has no non-production environment: `.env.local` points
-- at the production cluster, so "a credential" and "production access" have been
-- the same object. The consequence showed up on 2026-08-21, when an agent
-- running anywhere but this laptop could not check ANYTHING about the live
-- system — not whether the schema matches the migrations, not whether the
-- owner's vault is populated, not whether a walk left rows behind — because the
-- only credentials that exist can also write.
--
-- Five of the seven read-only verification scripts talk ONLY to the database:
--   verify:schema · verify:dogfood · verify:orphans · flight:snapshot · verify:roles
-- (`verify:iam` and `verify:kms` read the AWS API instead, and are deliberately
-- NOT unlocked by this role — a credential that lives in someone else's cloud
-- has no business enumerating IAM.)
--
-- WHAT MAKES THIS SAFER THAN THE ROLE IT SITS BESIDE. `relay-dev`'s IAM policy
-- carries `kms:GenerateDataKey` and `kms:Decrypt`. `relay-ro-policy` carries
-- `dsql:DbConnect` and NOTHING ELSE — no KMS at all. So this identity can read
-- every metadata column in the product and can never turn a `ciphertext` column
-- into a secret: the vault stays ciphertext with no key. That is the whole point
-- of the split, and it is enforced by the absence of a permission rather than by
-- anyone remembering not to use one.
--
-- ⚠️ IT IS STILL A PRODUCTION CREDENTIAL AND IT STILL READS PII. Emails, display
-- names and vault item TITLES are plaintext columns. This role is appropriate for
-- an automated verifier; it is not appropriate for anywhere the metadata itself
-- would be a problem.
--
-- ⚠️ TWO REGIONS. Failover here is an env switch (`DSQL_USE_SECONDARY`), so a
-- role that exists in one region and not the other is invisible until the day
-- somebody flips it. Apply this to BOTH, and note the recorded gotcha: migrate.ts
-- does NOT honour DSQL_USE_SECONDARY — the secondary run must override
-- DSQL_PRIMARY_ENDPOINT with the secondary endpoint (shell env wins over
-- --env-file).
--
-- Feature: relay-h0-mvp
-- Requirements: 17.4 (least privilege), and PROJECT.yaml → deferred →
--               verify-live-cannot-enter-ci (the partial mitigation half)

CREATE ROLE relay_ro WITH LOGIN;

AWS IAM GRANT relay_ro TO 'arn:aws:iam::461293170793:user/relay-ro';

GRANT SELECT ON ALL TABLES IN SCHEMA public TO relay_ro;

-- The grant above resolves ONCE, against the tables that exist at this moment.
-- Migration 031 created a table the day after 030 ran and the first read failed
-- with `permission denied`, which is the incident this line prevents. It binds to
-- the creating role, so a table made by any other identity drops back into the
-- same hole — `npm run verify:schema` is what notices, because it asks whether
-- each declared table is READABLE and not merely present.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO relay_ro;
