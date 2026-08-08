-- Verifiers must be able to say NO.
--
-- /api/triggers/[id]/confirm had no deny path, so a verifier who KNEW a request
-- was illegitimate could only decline to act — indistinguishable from being
-- unreachable. Silence and objection are now different signals (J7-R5).
--
-- DSQL: "ALTER TABLE ADD COLUMN with constraint not supported" — no NOT NULL,
-- no DEFAULT, no CHECK on an added column. Both columns are therefore plain and
-- NULLABLE, and the application supplies the semantics:
--   decision IS NULL          → 'confirm'  (every pre-existing row)
--   received_denials IS NULL  → 0
-- That is also what preserves existing behaviour exactly: rows written before
-- this migration read back as confirmations, which is what they were.
--
-- Requirements: J7-R5, J7-R7, J7-R8

ALTER TABLE verifier_confirmations ADD COLUMN IF NOT EXISTS decision TEXT;

-- Counted separately: received_confirmations keeps counting ONLY confirmations,
-- so the N-of-M semantics are unchanged.
ALTER TABLE release_state ADD COLUMN IF NOT EXISTS received_denials INT;
