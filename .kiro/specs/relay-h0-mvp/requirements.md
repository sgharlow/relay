# Requirements Document

## Introduction

Relay is a living-continuity platform that lets owners build an encrypted vault of accounts, credentials, documents, and instructions, then assign scoped, reversible access to trusted recipients under verified trigger conditions. When a trigger fires — a missed check-in, a manual emergency request, or a verified estate event — the system advances through a controlled release state machine (ARMED → PENDING → GRACE → RELEASED) using optimistic concurrency control. Emergencies are reversible: when the owner checks back in, access closes automatically. Estate handoffs are permanent.

The platform is built for the H0 hackathon, targeting Amazon Aurora DSQL (multi-region active-active) as the hero database, Next.js on Vercel as the frontend, and AWS KMS for client-side envelope encryption. The MVP covers all must-have functional requirements (FR1–FR9, FR17) and their supporting non-functional requirements, with AI-powered ingestion and importance scoring as high-priority additions.

**Demo spine** (the four moments that win):
1. Reversible emergency-access story end to end
2. Real region failover (disable a regional endpoint live)
3. OCC release correctness (can never double-release)
4. Importance moment — risk-graph reveal ("this email gates 40 resets")

---

## Glossary

- **Owner**: A registered user who creates and manages an encrypted vault, defines recipients and verifiers, and configures trigger rules.
- **Recipient**: A person designated by the Owner to receive scoped access to vault items after a verified trigger fires.
- **Verifier**: A trusted third party who confirms a trigger condition via the N-of-M verification subsystem; Verifiers may overlap with Recipients but are modeled separately.
- **Vault_Item**: An encrypted unit of information stored by the Owner. Types: `login`, `account`, `document`, `note`, `instruction`.
- **Release_State**: A state-machine row per (owner, trigger_type) that advances through `ARMED → PENDING → GRACE → RELEASED` (or `CANCELLED`).
- **Trigger_Type**: The class of life event that can initiate a release. Values: `emergency`, `travel`, `caregiver`, `business`, `estate`.
- **OCC**: Optimistic Concurrency Control — Aurora DSQL's default isolation mechanism using snapshot isolation and serialization-failure codes (SQLSTATE 40001).
- **CAS**: Compare-and-Set — a guarded UPDATE that checks both `state` and `version` columns before committing a state transition.
- **N-of-M Verification**: A configurable threshold where N Verifiers out of M designated Verifiers must confirm a trigger before RELEASED is allowed.
- **Grace_Window**: The time interval after N-of-M threshold is reached during which the Owner can still interrupt (cancel) a reversible trigger.
- **Heartbeat**: A periodic check-in signal from the Owner. Absence beyond the configured interval initiates a PENDING transition.
- **Envelope_Encryption**: A two-layer encryption scheme: a per-item data key (AES-GCM-256) encrypts the secret payload; AWS KMS wraps the data key. Only ciphertext, wrapped_data_key, and kms_key_id are persisted server-side.
- **Wrapped_Data_Key**: The KMS-encrypted form of a per-item AES-GCM-256 data key stored alongside ciphertext in the database.
- **Importance_Score**: A numeric ranking of a Vault_Item's consequence-in-absence, computed from non-secret metadata (category, flags, dependency edges) by the Importance_Engine. Range: [0.0, 1.0].
- **Root_Credential**: A Vault_Item (e.g., primary email, phone number, password manager) whose compromise or absence blocks access to many other accounts.
- **Risk_Graph**: A directed graph where edges (`depends_on_item_id`) represent credential dependencies; Root_Credentials have high centrality.
- **Intake_Agent**: A serverless function that classifies and scores Vault_Items on non-secret metadata after import.
- **Prioritization_Agent**: A serverless function that ranks completion gaps by consequence rather than mere presence.
- **Triage_Agent**: A serverless function that produces a sequenced, dependency-aware handoff plan for Recipients at release time.
- **Audit_Log**: An append-only, hash-chained table recording every state change and access event.
- **DSQL**: Amazon Aurora DSQL — a multi-region active-active serverless PostgreSQL-compatible database that enforces no foreign keys and uses OCC.
- **KMS**: AWS Key Management Service — used to generate, wrap, and unwrap per-item data keys.
- **Simulate_Trigger**: A demo-only control that fast-forwards the Release_State machine through all states without waiting for real time or real verifier confirmations.
- **Scope**: The access level granted to a Recipient for a specific Vault_Item. Values: `view` (read only), `act` (can perform on behalf of Owner).
- **ZK-preserving**: A processing mode in which the Importance_Engine and Ingestion subsystems operate only on non-secret metadata, never on decrypted secrets.
- **Reversible_Trigger**: A trigger where the Release_State can be returned to ARMED or CANCELLED during GRACE; all trigger types except `estate` are reversible.

---

## Requirements

---

### Requirement 1: Owner Vault and Item Management

**User Story:** As an Owner, I want to create an encrypted vault and add typed items to it, so that I can store my accounts, credentials, documents, and instructions in a single organized place.

#### Acceptance Criteria

1. WHEN an authenticated Owner requests vault creation, THE Vault_System SHALL create exactly one vault associated with that Owner; IF the Owner already has a vault, THEN THE Vault_System SHALL reject the creation request with a conflict error.
2. WHEN an Owner submits a new Vault_Item with a valid `type`, THE Vault_System SHALL accept items of type `login`, `account`, `document`, `note`, or `instruction`.
3. IF an Owner submits a new Vault_Item with a `type` value not in the set [`login`, `account`, `document`, `note`, `instruction`], THEN THE Vault_System SHALL reject the request with a validation error and SHALL NOT persist any data.
4. WHEN an Owner creates or updates a Vault_Item, THE Vault_System SHALL store `title` (1–200 characters), `service_name`, `url` (max 2048 characters), `category` (one of: `finance`, `health`, `government`, `utilities`, `communication`, `professional`, `personal`, `other`), `criticality` (one of: `critical`, `high`, `medium`, `low`), and `type` as non-secret metadata alongside the encrypted payload.
5. THE Vault_System SHALL reject any query that does not include a validated Owner identity claim matching the row's `owner_id`; no query SHALL join or return rows across different `owner_id` values; IF an authenticated Owner's identity is valid but they attempt to access a row belonging to a different Owner, THEN THE Vault_System SHALL leave the Owner's session intact and return an authorization error for the specific cross-owner request.
6. WHEN an Owner updates a Vault_Item, THE Vault_System SHALL replace the stored ciphertext and wrapped_data_key with the newly supplied values and update `updated_at`.
7. WHEN an Owner deletes a Vault_Item, THE Vault_System SHALL remove the item and cascade-delete all associated Access_Rules in application logic before committing.
8. IF an Owner attempts to read, update, or delete a Vault_Item not owned by that Owner, THEN THE Vault_System SHALL return an authorization error without revealing whether the item exists.

---

### Requirement 2: Client-Side Envelope Encryption

**User Story:** As an Owner, I want my secrets encrypted before they leave my browser, so that the server never holds plaintext credentials.

#### Acceptance Criteria

1. WHEN an Owner saves a Vault_Item, THE Crypto_Boundary SHALL generate a per-item 256-bit AES-GCM data key in the browser, encrypt the secret payload with that key, and produce a ciphertext blob before any network transmission occurs.
2. THE Crypto_Boundary SHALL call the backend KMS proxy to wrap the per-item data key using AWS KMS; only the wrapped_data_key, ciphertext, and kms_key_id SHALL be transmitted to and stored by the server; the plaintext data key SHALL never leave the browser.
3. THE Vault_System SHALL persist zero plaintext secrets at rest; the database SHALL contain only ciphertext, wrapped_data_key, kms_key_id, and non-secret metadata fields (`title`, `service_name`, `url`, `category`, `criticality`, `type`, and importance-engine flags).
4. WHEN an authorized Recipient session requests a Vault_Item after RELEASED, THE Crypto_Boundary SHALL call AWS KMS to unwrap only the data keys for Vault_Items covered by that Recipient's Access_Rules.
5. IF any step in the decryption process fails (KMS unwrap, AES-GCM decryption, or authorization validation), THEN THE Crypto_Boundary SHALL surface a browser-visible error message to the Recipient and SHALL prevent all plaintext exposure; no plaintext secret content SHALL be returned under any failure condition, including partial failures.
6. THE Crypto_Boundary SHALL use IAM-based authentication for all KMS API calls from the backend.
7. IF the AES-GCM encryption step fails during item save (e.g., SubtleCrypto API error), THEN THE Crypto_Boundary SHALL abort the save operation, surface a browser-visible error message to the Owner in all cases (silent abort is not acceptable), and SHALL NOT transmit any data to the server.

---

### Requirement 3: Recipients, Verifiers, and Access Rules

**User Story:** As an Owner, I want to define recipients and verifiers and assign per-item access rules, so that the right people get exactly the access they need under the right conditions.

#### Acceptance Criteria

1. THE Relay_System SHALL allow an Owner to create one or more Recipients, each with a name, relationship label, email, phone, and role (`recipient`, `executor`, `caregiver`, `partner`).
2. THE Relay_System SHALL allow an Owner to create one or more Verifiers, each with a name, email, and phone; a Verifier MAY also be a Recipient.
3. WHEN an Owner creates an Access_Rule with all required fields present, THE Rule_Engine SHALL accept the rule; required fields are `vault_item_id`, `recipient_id`, `trigger_type`, `scope` (`view` or `act`), and `reversible` (`true` or `false`).
4. IF an Owner submits an Access_Rule with one or more required fields absent or invalid, THEN THE Rule_Engine SHALL reject the request with a validation error listing the missing or invalid fields; no partial rule SHALL be persisted.
5. THE Rule_Engine SHALL enforce that `reversible` is set to `false` for all Access_Rules whose `trigger_type` is `estate`; IF an Owner attempts to create an `estate` rule with `reversible = true`, THEN THE Rule_Engine SHALL reject the request with an explicit error stating that estate rules must be irreversible.
6. WHEN an Owner deletes a Recipient, THE Rule_Engine SHALL cascade-delete all Access_Rules associated with that Recipient in application logic before committing.
7. WHEN an Owner deletes a Verifier, THE Rule_Engine SHALL remove all Verifier_Confirmation records for that Verifier in application logic before committing.
8. IF an Owner attempts to create an Access_Rule referencing a Vault_Item that does not belong to that Owner OR a Recipient that does not belong to that Owner, THEN THE Rule_Engine SHALL reject the operation with a referential-integrity error.
9. THE Rule_Engine SHALL allow an Owner to configure `required_confirmations` (N ≥ 1) and the total Verifier count (M ≥ 1) per Trigger_Type, where N ≤ M; IF an Owner submits N > M or N < 1 or M < 1, THEN THE Rule_Engine SHALL reject the request with a validation error.

---

### Requirement 4: Heartbeat and Check-In

**User Story:** As an Owner, I want to set a check-in cadence and record my activity, so that my system can detect when I'm unreachable and initiate the appropriate trigger.

#### Acceptance Criteria

1. THE Relay_System SHALL allow an Owner to configure a `checkin_interval_days` value in the range [1, 365]; IF the Owner submits a value outside this range, THEN THE Relay_System SHALL reject the request with a validation error; when not configured, `checkin_interval_days` SHALL default to 30.
2. WHEN an Owner submits a heartbeat signal, THE Heartbeat_Service SHALL update `last_active_at` to the current UTC timestamp for that Owner.
3. WHEN the Scheduler evaluates an Owner's heartbeat and the elapsed time since `last_active_at` exceeds `checkin_interval_days` AND the Owner's Release_State for the relevant Trigger_Type is `ARMED`, THE Scheduler SHALL initiate a PENDING transition for that Trigger_Type.
4. WHEN the Scheduler initiates a PENDING transition, THE Notification_Service SHALL send the Owner an alert via email containing a check-in link.
5. WHEN an Owner submits a heartbeat and the Release_State for a reversible Trigger_Type is in PENDING or GRACE, THE Heartbeat_Service SHALL return that Release_State to ARMED via a CAS transition; IF the Trigger_Type is `estate` (non-reversible) and Release_State is in PENDING or GRACE, THEN THE Heartbeat_Service SHALL reject the check-in with an error stating the release cannot be reversed.
6. THE Scheduler SHALL evaluate heartbeats for all active Owners at intervals no greater than 1 hour.
7. IF the Scheduler fails to evaluate a heartbeat due to a transient error, THEN THE Scheduler SHALL retry with exponential backoff (base 5 seconds, max 3 retries) before logging the failure and continuing to the next Owner.

---

### Requirement 5: Release State Machine with OCC

**User Story:** As an Owner, I want my release process to follow a safe, auditable state machine, so that access is only granted after proper verification and I can interrupt it if it was a false alarm.

#### Acceptance Criteria

1. THE Release_State_Machine SHALL maintain a single active Release_State row per (owner_id, trigger_type) pair.
2. THE Release_State_Machine SHALL advance Release_State only through the permitted transitions: `ARMED` → `PENDING`, `PENDING` → `GRACE`, `GRACE` → `RELEASED`, `GRACE` → `ARMED` (false alarm, reversible triggers only), `GRACE` → `CANCELLED` (Owner cancel, reversible triggers only), and `PENDING` → `ARMED` (heartbeat reset, reversible triggers only).
3. WHILE the Release_State is in GRACE and the Trigger_Type is reversible, THE Release_State_Machine SHALL allow transition from `GRACE` → `CANCELLED` when the Owner explicitly cancels; IF the current state is not GRACE or the Trigger_Type is non-reversible, THEN the cancellation SHALL be rejected.
4. WHILE the Release_State is in PENDING and the Trigger_Type is reversible, THE Release_State_Machine SHALL allow transition from `PENDING` → `ARMED` when the Owner submits a heartbeat; IF the current state is not PENDING or the Trigger_Type is non-reversible, THEN the reset SHALL be rejected.
5. WHEN a GRACE → RELEASED transition is evaluated, THE Release_State_Machine SHALL only proceed if `received_confirmations ≥ required_confirmations` AND the Grace_Window has elapsed; IF either condition is not met, THEN the transition SHALL be deferred.
6. WHEN any Release_State transition is committed, THE Release_State_Machine SHALL execute a CAS UPDATE that checks both `state = :expected_state` AND `version = :expected_version` in the WHERE clause.
7. IF a Release_State transition commit returns SQLSTATE 40001, THEN THE Release_State_Machine SHALL retry with exponential backoff (base 100 ms, jitter ±50 ms, max 1 second per attempt) up to a maximum of 3 attempts, re-reading the current row and re-evaluating the transition before each retry; if all retries are exhausted, THE system SHALL abort safely and default to the ARMED state.
8. WHEN a Release_State transitions to RELEASED, THE Release_State_Machine SHALL record `released_at` and increment `version` atomically in the same CAS commit.
9. THE Release_State_Machine SHALL default to the locked (ARMED) state when the outcome of any transition is ambiguous or retries are exhausted.
10. THE Release_State_Machine SHALL not allow estate-type Release_State records to transition from RELEASED back to any other state.


---

### Requirement 6: N-of-M Verifier Confirmation

**User Story:** As an Owner, I want to require multiple trusted verifiers to confirm a trigger before access is granted, so that no single person can unlock my vault alone.

#### Acceptance Criteria

1. THE Verification_Subsystem SHALL allow an Owner to configure `required_confirmations` (N) and a set of Verifiers (M) per Trigger_Type before a trigger is active; N and M must satisfy N ≥ 1, M ≥ 1, and N ≤ M.
2. WHEN a Release_State enters PENDING, THE Notification_Service SHALL notify all designated Verifiers for that Trigger_Type via email requesting confirmation.
3. WHEN a Verifier submits a confirmation, THE Verification_Subsystem SHALL record the confirmation with `confirmed_at` and `method` (`app`, `document`, or `manual`), then increment `received_confirmations` on the Release_State row via a CAS update.
4. THE Verification_Subsystem SHALL enforce idempotency: a single Verifier SHALL contribute at most one confirmation per Release_State instance; duplicate submissions SHALL be silently ignored without modifying `received_confirmations`.
5. WHEN `received_confirmations` reaches `required_confirmations` AND the Grace_Window has elapsed, THE Verification_Subsystem SHALL initiate the GRACE → RELEASED CAS transition; IF confirmations arrive after the Grace_Window has already elapsed, THE Verification_Subsystem SHALL initiate the GRACE → RELEASED CAS transition immediately upon receiving the threshold confirmation without waiting for any additional condition.
6. WHEN `received_confirmations` reaches `required_confirmations` but the Grace_Window has not yet elapsed, THE Verification_Subsystem SHALL remain in GRACE and notify the Owner that release is pending the grace window.
7. WHEN the Grace_Window elapses AND `received_confirmations` is below `required_confirmations`, THE Verification_Subsystem SHALL still initiate the GRACE → RELEASED CAS transition; N-of-M threshold is evaluated at time of first transition attempt, not blocking release past the Grace_Window; no Owner notification SHALL be sent when the Grace_Window elapses without the threshold being met, as the notification was already sent at PENDING entry.
8. THE Verification_Subsystem SHALL never grant Verifiers read access to vault ciphertext or decrypted Vault_Item contents.
9. IF a Verifier confirmation CAS commit returns SQLSTATE 40001, THEN THE Verification_Subsystem SHALL retry with exponential backoff (base 100 ms, max 3 retries) before reporting failure to the Verifier.

---

### Requirement 7: Recipient Access Dashboard

**User Story:** As a Recipient, I want to see the vault items I've been granted access to in a clear, prioritized dashboard after a trigger fires, so that I can act quickly and confidently.

#### Acceptance Criteria

1. WHEN a Recipient authenticates and the Release_State for the relevant Trigger_Type is `RELEASED`, THE Access_Dashboard SHALL display only the Vault_Items covered by that Recipient's Access_Rules.
2. THE Access_Dashboard SHALL read Release_State from Aurora DSQL using a strongly consistent read path before rendering any items; IF the Recipient has no Access_Rules for the RELEASED trigger_type, THEN THE Access_Dashboard SHALL display a pending-status page with a message indicating no items are scoped to this Recipient, regardless of any other authorization means.
3. IF a Recipient authenticates and the Release_State is not `RELEASED`, THEN THE Access_Dashboard SHALL display a pending-status page showing only `title`, `service_name`, `url`, `category`, and `type` of scoped items; no ciphertext or decrypted secret content SHALL be accessible.
4. THE Access_Dashboard SHALL present Vault_Items with Root_Credentials (is_root_credential = true) ranked first, then remaining items ordered by `importance_score` descending; ties in importance_score SHALL be broken alphabetically by `title`.
5. WHEN a Recipient requests decryption of a Vault_Item, THE Crypto_Boundary SHALL verify that a valid RELEASED state exists and the Recipient's Access_Rules cover the requested item before calling KMS to unwrap the data key; IF either check fails, THEN THE Crypto_Boundary SHALL return an authorization error without calling KMS.
6. THE Access_Dashboard SHALL display each item's `title`, `service_name`, `url`, `category`, and `scope` without requiring decryption.
7. WHEN a Recipient views the Access_Dashboard (page render), THE Access_Dashboard SHALL write an Audit_Log entry with `action = "recipient_dashboard_viewed"` and `entity = "release_state"`.
8. WHEN a Recipient requests decryption of a specific Vault_Item, THE Access_Dashboard SHALL write an Audit_Log entry with `action = "vault_item_decrypted"`, `entity = "vault_item"`, and `entity_id` set to the item's UUID; this log entry SHALL be written for all decryption requests including those that fail authorization before any decryption work begins, with `detail.outcome` set to `"authorized"` or `"denied"` accordingly.

---

### Requirement 8: Append-Only Hash-Chained Audit Log

**User Story:** As an Owner, I want every state change and access event recorded in a tamper-evident log, so that I (and any auditor) can verify the integrity of the release process.

#### Acceptance Criteria

1. THE Audit_Service SHALL write an Audit_Log entry for every Release_State transition, Verifier confirmation, Recipient access event, Vault_Item creation/update/deletion, and Owner heartbeat.
2. WHEN THE Audit_Service writes an Audit_Log entry, THE entry SHALL include: `owner_id`, `seq` (monotonically increasing per owner), `actor`, `action`, `entity`, `entity_id`, `detail`, `prev_hash`, `entry_hash`, and `ts`.
3. THE Audit_Service SHALL compute `entry_hash = SHA-256(prev_hash ‖ canonical(entry))`, where canonical serialization is deterministic sorted-key JSON.
4. THE Audit_Service SHALL set `prev_hash` to the `entry_hash` of the most recent prior entry for the same `owner_id`; for the first entry for a given Owner, `prev_hash` SHALL be the 64-character hex string of all zeros (`"0000000000000000000000000000000000000000000000000000000000000000"`).
5. THE Audit_Service SHALL never issue DELETE or UPDATE statements against Audit_Log rows; all writes SHALL be INSERT-only.
6. WHEN an Owner requests the audit log, THE Audit_Service SHALL return entries in ascending `seq` order for that Owner only; entries from other Owners SHALL never appear in the response.
7. IF an Audit_Log write fails, THEN THE Audit_Service SHALL retry up to 3 times with exponential backoff (base 500 ms); IF all retries are exhausted, THE Audit_Service SHALL emit an operator alert and block the triggering operation from being surfaced as complete until the Audit_Log entry succeeds.

---

### Requirement 9: Demo Simulate-Trigger Control

**User Story:** As a demonstrator, I want a control that fast-forwards the release state machine, so that I can run the full release story in a live demo without waiting for real time windows or actual verifier responses.

#### Acceptance Criteria

1. THE Simulate_Trigger_Control SHALL be available only to authenticated Owner accounts flagged as demo accounts in the system configuration; IF a non-demo account attempts to activate Simulate_Trigger, THEN THE system SHALL return an authorization error; authentication and demo-account status SHALL be evaluated before any state is inspected or modified.
2. WHEN an Owner activates Simulate_Trigger for a given Trigger_Type, THE Simulate_Trigger_Control SHALL advance the Release_State from ARMED through PENDING, GRACE, and RELEASED within 10 seconds total, bypassing time windows.
3. THE Simulate_Trigger_Control SHALL use the same CAS UPDATE transitions as the production state machine; it SHALL NOT bypass OCC checks or skip version increments.
4. THE Simulate_Trigger_Control SHALL write all intermediate state transitions to the Audit_Log with a `detail` field containing `"simulated": true`.
5. WHEN the Simulate_Trigger_Control runs, THE Notification_Service MAY suppress actual email/SMS delivery; notification events SHALL be written to the Audit_Log with `detail.suppressed = true`.
6. THE Simulate_Trigger_Control SHALL bypass the N-of-M confirmation requirement during simulation, auto-satisfying `received_confirmations = required_confirmations`; this bypass SHALL be recorded in the Audit_Log detail.
7. IF Simulate_Trigger is invoked on a Release_State that is already in PENDING, GRACE, RELEASED, or CANCELLED, THEN THE Simulate_Trigger_Control SHALL first verify authentication and demo-account status, then return an error without modifying state; no state changes SHALL occur during the error path.


---

### Requirement 10: Bulk CSV Import (Cold-Start Defeat)

**User Story:** As an Owner, I want to import my password manager's CSV export, so that I can populate my vault instantly instead of entering accounts one by one.

#### Acceptance Criteria

1. THE Ingestion_Service SHALL accept a CSV file exported from 1Password, Bitwarden, LastPass, Chrome, or Firefox in the Owner's browser; unrecognized formats SHALL trigger a user-visible error.
2. THE Ingestion_Service SHALL parse the CSV entirely client-side; no raw CSV content or plaintext credential data SHALL be transmitted to the server at any point.
3. WHEN the Ingestion_Service parses a CSV row with all required columns present, THE Ingestion_Service SHALL extract `service_name`, `url`, `username`, and `password` fields (mapping source-specific column names to these canonical fields) and create a Vault_Item of type `login` per row.
4. THE Ingestion_Service SHALL encrypt each imported Vault_Item using the Envelope_Encryption scheme (Requirement 2) before uploading ciphertext to the server; IF encryption fails for any item, THEN THE Ingestion_Service SHALL abort the entire import operation and SHALL NOT upload any data, including data from items that encrypted successfully before the failure.
5. WHEN a CSV import completes, THE Ingestion_Service SHALL report the count of successfully imported items, the count of skipped rows, and the specific reason for each skip.
6. WHEN a CSV row would produce a duplicate (case-insensitive match on `service_name` + `url` combination already present in the vault), THE Ingestion_Service SHALL skip the row and include it in the skip report.
7. IF parsing fails for any individual row (malformed CSV, missing required field, or encoding error), THE Ingestion_Service SHALL skip that row, record the row number and reason in the import report, and continue processing remaining rows.
8. THE Ingestion_Service SHALL support a minimum batch of 300 rows within a single import operation, completing the full parse-encrypt-upload cycle within 60 seconds.
9. IF the whole-file parse fails (e.g., file is not valid CSV, file exceeds 10 MB, or encryption setup fails), THEN THE Ingestion_Service SHALL abort the import, surface a user-visible error, and SHALL NOT upload any partial data.

---

### Requirement 11: Importance Engine — Intake Agent

**User Story:** As an Owner, I want my imported accounts automatically classified and scored, so that I can quickly see which items matter most instead of triaging a raw 300-row list.

#### Acceptance Criteria

1. WHEN a Vault_Item is created or imported, THE Intake_Agent SHALL analyze non-secret metadata (`title`, `service_name`, `url`, `category`, `type`) to set `is_root_credential`, `recurring_billing`, `irreplaceable`, and a base `importance_score`.
2. THE Intake_Agent SHALL classify as `is_root_credential = true` any item identified as a primary email account, phone number, or password manager credential.
3. THE Intake_Agent SHALL classify as `recurring_billing = true` any item identified as a bank, credit card, brokerage, or known subscription service; all other items SHALL have `recurring_billing` set to `false`.
4. THE Intake_Agent SHALL classify as `irreplaceable = true` any item identified as a government ID, deed, will, or other document that cannot be regenerated from an account login; all other items SHALL have `irreplaceable` set to `false`.
5. THE Intake_Agent SHALL operate exclusively on non-secret metadata; THE Intake_Agent SHALL never call KMS Decrypt and SHALL never receive plaintext secrets; the Intake_Agent's IAM role SHALL be restricted from calling `kms:Decrypt` and vault item queries to the Intake_Agent SHALL filter out ciphertext and wrapped_data_key columns.
6. WHEN the Intake_Agent infers a `depends_on_item_id` edge (e.g., an account whose password-reset path routes through a root email), THE Intake_Agent SHALL set the `depends_on_item_id` field on the dependent Vault_Item.
7. THE Intake_Agent SHALL return an `importance_score` in the range [0.0, 1.0] where higher values indicate greater consequence-in-absence.
8. WHEN the Intake_Agent assigns an `importance_score` or sets a flag, THE system SHALL display the reasoning to the Owner and allow the Owner to override any classification; Owner overrides SHALL persist and SHALL NOT be overwritten on subsequent re-analyses of the same item.
9. IF the Intake_Agent fails to score one or more items (e.g., LLM timeout or classification error), THEN THE Intake_Agent SHALL assign a default `importance_score` of 0.5 to the failed items, surface a warning to the Owner listing which items used the default, and SHALL NOT block vault item creation.
10. THE Intake_Agent SHALL complete scoring for a batch of 300 items within 30 seconds.

---

### Requirement 12: Importance Engine — Prioritization Agent (Gap Detection)

**User Story:** As an Owner, I want to see which accounts are incomplete and why it matters, so that I can fix the most consequential gaps first.

#### Acceptance Criteria

1. THE Prioritization_Agent SHALL scan the Owner's Vault_Items on vault load and on each individual Vault_Item update to identify items missing high-consequence fields: recovery email annotation, two-factor authentication notes, beneficiary designation, or a plain-language "what this is for" note.
2. THE Prioritization_Agent SHALL rank identified gaps by consequence: items with `is_root_credential = true` SHALL rank first; items with `importance_score` in any range (including low-to-moderate scores of 1–5 on a 0–10 equivalent scale, i.e., importance_score < 0.5) SHALL receive positive consequence priority when gaps are identified; within the same gap type, higher `importance_score` items SHALL rank above lower `importance_score` items.
3. THE Prioritization_Agent SHALL flag `irreplaceable = true` items that have no designated Recipient OR have an empty `backup_note` field as custody candidates; flagged items SHALL have their gap type set to `CUSTODY_RISK` in the gap record, and SHALL be surfaced to the Owner with a "Custody Risk" label.
4. THE Prioritization_Agent SHALL present each identified gap with a plain-language explanation of the consequence (e.g., "This account has no recovery email note. If a Recipient can't log in, there is no recovery path.").
5. THE Prioritization_Agent SHALL operate exclusively on non-secret metadata; it SHALL never call KMS Decrypt.
6. WHEN an Owner updates a Vault_Item in a way that resolves a previously flagged gap (e.g., adds a recovery email annotation), THE Prioritization_Agent SHALL remove that specific gap from the active list within 2 seconds of the item update, without waiting for a full vault re-scan.
7. THE Prioritization_Agent output SHALL be shown with reasoning and SHALL be fully owner-overridable; no gap flag SHALL silently block any Owner action in the system.

---

### Requirement 13: Release Sequencing — Triage and Handoff Plan

**User Story:** As a Recipient, I want a step-by-step prioritized plan rather than a flat list of items, so that I know exactly what to do first and in what order when I need access.

#### Acceptance Criteria

1. WHEN a Release_State reaches RELEASED, THE Triage_Agent SHALL produce a time-ordered handoff plan for each Recipient scoped to that trigger.
2. THE Triage_Agent SHALL order plan steps such that Root_Credentials and items with no `depends_on_item_id` (or whose dependency has already been resolved in the plan) appear before items that depend on unresolved credentials; a dependency is considered resolved when it appears earlier in the plan sequence.
3. THE Triage_Agent SHALL group items into time-horizon buckets: "Do today" (importance_score ≥ 0.7), "This week" (0.4 ≤ importance_score < 0.7), and "Within 30 days" (importance_score < 0.4); Root_Credentials SHALL always be placed in "Do today" regardless of their scored importance_score.
4. IF the trigger_type of the Release_State is `estate`, THEN THE Triage_Agent SHALL include provider-specific guidance for each relevant Vault_Item: Apple Legacy Contact steps for Apple ID items, Google Inactive Account Manager steps for Google account items, and Meta memorialization steps for Meta account items.
5. THE Triage_Agent SHALL operate exclusively on non-secret metadata and Vault_Item `title` fields; it SHALL never call KMS Decrypt or receive plaintext secret content.
6. THE Triage_Agent output SHALL be accessible to the Owner for review and annotation before the first release event; Recipients SHALL see the same plan (plus any Owner annotations) at access time.
7. THE Triage_Agent SHALL produce a complete plan for a vault of 300 items within 15 seconds of the RELEASED state being committed.
8. IF the Triage_Agent fails to produce a plan within the 15-second window, THEN THE Access_Dashboard SHALL fall back to presenting Vault_Items sorted by `importance_score` descending with no time-horizon grouping, and SHALL display a warning indicating the handoff plan is unavailable.


---

### Requirement 14: Multi-Region Availability and Failover

**User Story:** As a system operator, I want the release and access path to continue functioning during a single-region outage, so that a Recipient's emergency access is never blocked by infrastructure failure.

#### Acceptance Criteria

1. THE Relay_System SHALL provision Aurora DSQL across two AWS regions such that both regional endpoints accept reads and writes at all times (active-active).
2. WHEN the primary regional DSQL endpoint becomes unavailable, THE Relay_System SHALL route all read and write requests to the secondary regional endpoint within 30 seconds; no acknowledged committed write SHALL be absent from the secondary endpoint after failover.
3. WHEN operating on the secondary regional endpoint, THE Relay_System SHALL perform Release_State transitions using the same OCC CAS pattern with no application logic changes; the retry policy (max 3 attempts, base 100 ms) SHALL apply identically on the secondary endpoint.
4. WHEN the secondary endpoint has been formally designated active (first successful strongly-consistent read against the secondary endpoint after primary unavailability is detected), THE Access_Dashboard SHALL serve Recipients with Release_State and scope data from the secondary endpoint; the system SHALL NOT serve cached or assumed-consistent data prior to formal detection.
5. THE Relay_System SHALL demonstrate live failover in the submission demo: disable the primary regional endpoint mid-flow and show Recipient access continuing uninterrupted from the secondary endpoint.
6. IF both regional endpoints are simultaneously unavailable, THEN THE Relay_System SHALL return HTTP 503 to all users and SHALL NOT issue any write against `release_state` or dependent tables.

---

### Requirement 15: Consistency and Authorization Correctness

**User Story:** As a security-conscious operator, I want all authorization decisions to be strongly consistent, so that no stale read can incorrectly grant or deny access.

#### Acceptance Criteria

1. THE Access_Dashboard SHALL execute a read against Aurora DSQL with strong consistency (read from the leader or a fully synchronized replica) before authorizing any Recipient session; cached or eventually-consistent reads SHALL NOT be used for authorization decisions.
2. WHEN a Recipient's session token is issued, THE Auth_Service SHALL record the `release_state_id` and `version` at issuance time.
3. WHEN a Recipient submits any item request within an active session, THE Auth_Service SHALL re-read the Release_State and verify the current `version` matches the version captured at token issuance; IF the version has changed, THEN THE Auth_Service SHALL block the request and return an authorization error without serving any decryption keys; this version check SHALL apply only when a Recipient actively submits a request, not as a background global constraint.
4. IF the Release_State transitions to `cancelled` or `armed` after a Recipient session is issued, THEN THE Auth_Service SHALL invalidate that Recipient session within 60 seconds.
5. THE Relay_System SHALL not serve Vault_Item decryption keys to a Recipient whose Release_State is not `released` at the moment of the KMS unwrap call.
6. THE Relay_System SHALL not expose one Owner's Release_State, Vault_Items, Recipients, or Verifiers to any other Owner's queries.

---

### Requirement 16: Application-Level Referential Integrity

**User Story:** As a developer operating on Aurora DSQL (which does not enforce foreign keys), I want the application layer to enforce all referential constraints, so that the data model remains consistent without relying on database-level FK enforcement.

#### Acceptance Criteria

1. WHEN any write operation references a foreign entity (e.g., Access_Rule referencing vault_item_id or recipient_id), THE Data_Access_Layer SHALL verify the referenced row exists and belongs to the correct Owner within the same OCC transaction boundary before committing; IF a referenced row does not exist or belongs to a different Owner, THEN THE Data_Access_Layer SHALL reject the write without committing any partial data.
2. WHEN a parent row is deleted (Owner, Vault_Item, Recipient, Verifier, Release_State), THE Data_Access_Layer SHALL delete all dependent rows that have no independent meaning (e.g., Access_Rules, Verifier_Confirmations) and nullify reference columns on rows that can exist independently; all cascade operations SHALL complete before the parent delete commits.
3. IF a concurrent delete of a referenced row causes a referential violation at commit time, THEN THE Data_Access_Layer SHALL roll back the dependent write and retry up to 3 times; if all retries are exhausted, THE Data_Access_Layer SHALL return a conflict error to the caller.
4. THE Data_Access_Layer SHALL enforce uniqueness of (release_state_id, verifier_id) on Verifier_Confirmation rows using an OCC intent-read pattern: read for existence before insert, then commit; IF the commit returns SQLSTATE 40001, THEN the confirmation SHALL be treated as a duplicate and silently ignored.
5. THE Data_Access_Layer SHALL log all referential-integrity enforcement actions to the Audit_Log with `action` set to one of: `ref_integrity_parent_not_found`, `ref_integrity_owner_mismatch`, `ref_integrity_cascade_delete`, or `ref_integrity_uniqueness_enforced`.

---

### Requirement 17: Security Hardening and Least Privilege

**User Story:** As a security-conscious operator, I want all system actors to operate with minimum necessary access, so that a compromise of any single component exposes the minimum possible data.

#### Acceptance Criteria

1. THE Auth_Service SHALL require email and at least one additional authentication factor (TOTP or push notification) for all Owner accounts; IF the MFA factor validation fails, THEN THE Auth_Service SHALL reject the login and SHALL NOT issue a session token.
2. THE Auth_Service SHALL issue time-boxed, scoped session tokens for Recipient sessions; Recipient tokens SHALL expire no later than 24 hours after issuance; IF a Recipient presents an expired token, THEN THE Auth_Service SHALL reject the request with an authentication error and return no data.
3. THE Auth_Service SHALL use IAM-based authentication for all Aurora DSQL connections from backend services; no static database passwords SHALL be present in configuration or environment variables.
4. THE Relay_System SHALL configure AWS KMS key policies so that only authorized backend service IAM roles can call `kms:GenerateDataKey` and `kms:Decrypt`; the Intake_Agent IAM role SHALL be explicitly excluded from `kms:Decrypt`.
5. THE Relay_System SHALL enforce HTTPS for all client-to-server communication; IF a client attempts a plaintext HTTP connection, THEN the edge layer SHALL redirect or reject the connection without returning any application data.
6. THE Relay_System SHALL apply per-Owner row-level access controls at the data access layer; every query SHALL include an `owner_id = :current_owner` predicate and SHALL return no rows from other Owners.
7. WHEN a Recipient's granted release is cancelled (Release_State transitions to `cancelled` or `armed`), THE Auth_Service SHALL revoke or invalidate all Recipient session tokens associated with that release within 60 seconds of the state change.
