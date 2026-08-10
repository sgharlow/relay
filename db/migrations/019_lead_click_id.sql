-- Ad click identifiers on caregiver leads.
--
-- `src` records the channel WE tagged. These record the platform's own
-- identifier for the specific click that was paid for, which is what makes
-- "which creative produced this lead" answerable and an offline conversion
-- upload possible at all.
--
-- Nullable by design: organic and direct arrivals have no click ID, and a lead
-- without one is still a lead. Nothing in the funnel may require it.
--
-- Aurora DSQL: no FKs, no sequences; ALTER ... ADD COLUMN is supported.

ALTER TABLE caregiver_leads ADD COLUMN IF NOT EXISTS click_platform TEXT;
ALTER TABLE caregiver_leads ADD COLUMN IF NOT EXISTS click_id TEXT;
