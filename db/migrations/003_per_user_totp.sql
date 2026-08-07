-- Per-user TOTP secrets (security patch, 2026-08-06).
--
-- TOTP was validated against a single process.env.TOTP_SECRET shared by every
-- owner, so a code minted for one account authenticated any account. Latent
-- while the deployment had one dogfooded owner; an account-takeover
-- vulnerability the moment self-serve signup exists.
--
-- Additive and backward-compatible: existing rows keep totp_secret NULL and
-- continue to resolve to the env secret via lib/auth/resolve-totp-secret.ts.
-- New accounts created by signup carry their own secret.
--
-- Requirements: 17.1

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
