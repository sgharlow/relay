-- 027 — what actually happened to the mail we sent.
--
-- 🔴 THE PRODUCT COULD NOT TELL A DELIVERED MESSAGE FROM A SWALLOWED ONE.
-- Resend accepts a send to a SUPPRESSED address and returns 200 with a message
-- id; `sendEmailBestEffort` therefore returns true and every caller reports
-- success. A previously-bounced address is muted permanently, silently, and the
-- owner is told "we notified your verifiers" when nobody was notified.
--
-- That is the catastrophic shape for this product: a release starts, verifier
-- notices go nowhere, nobody answers, quorum is never met, and access never
-- opens on the one day it was built for.
--
-- The production Resend API key is deliberately SEND-ONLY (`restricted_api_key`
-- — verified 2026-08-14), so the app cannot ASK what happened, and broadening a
-- credential shared with another project to find out would be the wrong trade.
-- Resend can PUSH instead: this table is where those events land.
--
-- Append-only by convention, like audit_log — a delivery outcome is a fact that
-- happened, and correcting one by overwriting it would lose the sequence that
-- makes "bounced, then later delivered" readable.
--
-- NOT owner-scoped, deliberately: the fact lives against an ADDRESS, and the
-- same address can be a recipient for one owner and a verifier for another. The
-- reader joins to whichever person they are entitled to see, so this table
-- grants nothing on its own.

CREATE TABLE IF NOT EXISTS email_delivery_events (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lowercased at write time; every reader compares lowercased.
  email        TEXT         NOT NULL,
  -- Resend's event vocabulary, stored as sent: email.delivered,
  -- email.bounced, email.complained, email.delivery_delayed. Kept as the raw
  -- string rather than an enum — a provider that adds an event type must not
  -- fail an insert, and a CHECK constraint here would turn new information into
  -- a 500 on a webhook we do not control.
  event        TEXT         NOT NULL,
  -- Bounce subtype or reason, bounded by the writer. Never a message body:
  -- our bodies carry live access codes.
  detail       TEXT,
  -- Resend's own id, so a duplicate delivery of the same webhook is detectable.
  provider_id  TEXT,
  occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- DSQL: indexes must be CREATE INDEX ASYNC with no sort order on keys.
CREATE INDEX ASYNC idx_email_delivery_email ON email_delivery_events (email);
CREATE INDEX ASYNC idx_email_delivery_provider ON email_delivery_events (provider_id);
