# G2 counsel brief — questions for digital-assets/estate counsel (DRAFT 2026-07-03)

> Purpose: walk into the first counsel conversation with a tight, answerable question set instead
> of an open-ended product pitch. Gate `g2-counsel-opinion` (due **2026-09-30**) requires a
> WRITTEN opinion before any paying customer. This brief poses the questions; it does not answer
> them — nothing here is legal analysis, and none of it should be treated as such.

## One-paragraph product description (for counsel)

Relay is an encrypted "living-continuity" vault. An owner stores account information, credentials,
documents, and instructions, encrypted in the browser (Relay holds only ciphertext). The owner
designates recipients and trigger conditions (missed check-in, manual emergency, verified estate
event) with N-of-M human verifiers and a grace window. On a verified trigger, designated
recipients gain scoped access to the specific items granted to them. Emergency releases are
reversible (owner recovery re-seals access); estate releases are permanent. Planned pricing:
$119/yr consumer subscription; a later "activation fee at the moment of need" is deliberately
deferred pending this opinion.

## Background frame (verified 2026-07-03, for orientation only — counsel confirms)

RUFADAA (Revised Uniform Fiduciary Access to Digital Assets Act) is enacted in the large majority
of states (all but roughly six; California has a closely-modeled variant the ULC doesn't count as
adoption). It defines "custodians" (entities that carry, maintain, or store digital assets) and a
three-tier priority: (1) a custodian's **online tool** designation, (2) estate documents,
(3) the custodian's terms of service.

## The questions

### A. Relay's own status
1. Is Relay a **custodian** under RUFADAA with respect to the vault contents it stores? What
   obligations follow (disclosure standards, response to fiduciary requests, immunity provisions)?
2. Should Relay's recipient-designation flow be built to qualify as a RUFADAA **online tool**
   (tier-1 priority) for the vault's own contents? What statutory features does that require?
3. Does operating the release mechanism make Relay a **fiduciary** (or quasi-fiduciary) to the
   owner or recipients? Can ToS disclaim that status effectively, and should it?

### B. The credential-release problem (the hard one)
4. Relay releases owner-stored *credentials* to a recipient, who may then log into third-party
   accounts. The third parties' ToS typically prohibit credential sharing; unauthorized-access
   statutes (CFAA and state analogs) loom behind ToS violations. What is Relay's exposure for
   *facilitating* that access, and what is the recipient's? What disclosures/consents mitigate?
5. Does the analysis change between the reversible **emergency** release (owner alive,
   incapacitated or unreachable) and the permanent **estate** release (owner deceased, where
   RUFADAA's fiduciary-access process is the "official" path)?

### C. Verification and wrongful release
6. What death/incapacity verification standard is defensible for the estate trigger — death
   certificate, court letters, N-of-M attestation alone, or tiered by item sensitivity? Is there a
   negligence standard or safe harbor for a **wrongful release** (false positive)? For a
   **failure to release** (false negative)?
7. Do the N-of-M verifiers take on any legal role or liability by attesting? Should verifier
   consent language address this?

### D. Instructions, consent, and formation
8. Are in-app owner instructions/directives enforceable **records** under ESIGN/UETA? Any
   categories (e.g., testamentary-adjacent wishes) that CANNOT be validly expressed in-app?
9. What must the ToS/consent flow contain for the owner's designation of recipients to constitute
   lawful consent to disclosure under RUFADAA §-4-style provisions?

### E. Business model
10. The deferred **activation fee at the moment of need**: any consumer-protection or
    probate-services regulation implicated by charging at death/emergency? Framing constraints?
11. **B2B2C distribution** through banks/wealth managers/benefits providers: does distributing
    through regulated fiduciaries change Relay's own status or add regulatory surface (GLBA
    vendor obligations, state insurance rules)?
12. Governing law/venue selection given state variance (CA divergence; the ~6 non-adopting states).

## Deliverable to request

A written opinion covering: (1) custodian/fiduciary status, (2) the required consent + verification
framework per trigger type, (3) ToS language requirements, (4) explicit go/no-go conditions for
charging money. Per the ratified gate: **adverse opinion → B2B2C-through-regulated-partners only,
or park.**

## Finding counsel (shortlist strategy — Steve executes)

- **ACTEC** (American College of Trust & Estate Counsel) fellows — search the directory for
  digital-assets committee members; this is the densest pool of RUFADAA-fluent practitioners.
- Estate/probate attorneys who have **published on RUFADAA** (several firms maintain practice
  pages and analyses — e.g., the PA and NY firm write-ups surfaced in research; authorship of a
  RUFADAA explainer is a good fluency signal).
- State bar **estate planning & probate section** referral in Steve's home state (governing-law
  convenience) — ask specifically for "digital assets / RUFADAA experience."
- Budget expectation: scope a fixed-fee opinion engagement rather than open-ended hourly; the
  question set above is deliberately sized for that ask.

## Named starting points (researched 2026-07-03 — leads, not endorsements)

> Verification status is stated per lead; Steve validates fit on the intro call. Fluency with
> RUFADAA specifically (not just "estate planning") is the screen.

1. **Justin H. Brown — Ballard Spahr** (ballardspahr.com/people/attorneys/b/brown-justin).
   Surfaced 7-03 as having spoken and written extensively on RUFADAA/digital-asset estate topics;
   profile page live. Big-firm rates, but a scoped fixed-fee opinion ask keeps it bounded — and a
   national-firm opinion carries weight with future B2B2C partners.
2. **ACTEC directory route** (actec.org → Find a Fellow): filter for digital-property/technology
   committee involvement. This is the densest pool of RUFADAA-fluent practitioners; 30 minutes of
   directory work yields 3–5 candidates in the preferred state.
3. **RUFADAA-explainer authors at boutique firms** — several surfaced in research (e.g., the PA
   estate practice of David M. Frees III, which published a RUFADAA adoption analysis; a NY
   trusts-and-estates firm's digital-assets write-up at oalaw.com). Authorship is the fluency
   signal; boutique rates suit a startup budget. Verify each is active before outreach.

## Drafted outreach email (Steve sends from his own account)

> **Subject:** Fixed-fee opinion engagement — digital-asset vault startup (RUFADAA/fiduciary-status
> questions)
>
> Hi [name] — I'm the founder of Relay, an encrypted "digital continuity" vault: owners store
> account credentials and instructions, designate recipients, and a verified trigger (missed
> check-in, emergency, or death) releases scoped access — reversibly for emergencies, permanently
> for estates. Before we take a dollar of revenue I want a written opinion on our custodian/
> fiduciary status under RUFADAA and the consent/verification framework we need. I have a
> 12-question brief ready (custodian status, the credential-release/ToS problem, wrongful-release
> standards, ESIGN validity of in-app directives) — sized deliberately for a fixed-fee engagement.
> Would you have 20 minutes in the next couple of weeks to scope it? [signature]
