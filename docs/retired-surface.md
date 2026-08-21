# Retired surface

Endpoints and capabilities deliberately removed, with the reason and what
replaced them. This file exists so that "it used to be here" has an answer other
than `git log`, and so a spec requirement whose route is gone is not mistaken for
an unimplemented one.

---

## `POST /api/triggers/[id]/cancel` — retired 2026-08-21

**Requirement 5.3** (owner stops a release) — **survives**, on
`POST /api/triggers/[id]/stand-down`, which re-arms.

**Why.** Ruled by Steve on 2026-08-21. CANCELLED is a terminal state:
`PERMITTED_TRANSITIONS` has no edge out of it, and nothing re-provisions a
cancelled row. So one two-tap control permanently retired the whole trigger TYPE
for that owner — every access rule and every recipient hanging off it — with no
owner-side recovery of any kind. Stand-down was built for the case this control
was reached for (a false alarm), it re-arms rather than ending anything, and
CANCELLED was only ever reachable from GRACE, so the two controls sat side by
side with one of them being a trap.

**The two corrections that preceded it, and why they were not enough.** The
screen used to tell an owner the remedy was to "recreate the access rule", which
does not work — `ensureReleaseState` returns the existing cancelled row rather
than making a new one, so the trigger stays dead. That copy was corrected first,
which made the screen honest and left the trap in place. Retiring the control is
the structural version of the same fix.

**What survives, deliberately.** The `grace → cancelled` edge stays in
`PERMITTED_TRANSITIONS` with **no caller**, and `lib/release/state-machine.ts`
carries the argument for keeping it: the state machine is the product's
correctness story and narrowing it is a separate decision from removing a button.
`KNOWN_UNREACHABLE` stays EMPTY — the route was deleted, not parked.

**If it is ever wanted back**, the shape the journey doc already specifies is
re-provisioning (a fresh ARMED row), not an un-cancel edge — see
`docs/user-journeys.md`.

---

## `POST /api/ai/prioritize` — retired 2026-08-13

**Requirements 12.1–12.4** (Prioritization Agent — gap detection).

**Why.** No caller. Found by `lib/ops/api-reachability.ts`, and confirmed by
hand: nothing in the product ever invoked it. The user-facing job it was built
for — telling an owner what is missing and what to do next — is done by the
readiness banner (`lib/vault/readiness.ts`) and the coverage matrix on `/circle`,
both of which were built later, are reachable, and are what the manual actually
describes.

**Risk it carried.** An owner-authenticated endpoint that sent vault metadata to
OpenAI on request and fed nothing. Live third-party surface and spend for a
feature no screen consumed.

**What survives.** `lib/ai/prioritize-agent.ts` and its tests are kept: the
requirement is still on the books, and the agent is the starting point if gap
detection is ever wanted as a distinct product surface rather than a banner.

---

## `POST /api/ai/triage` — retired 2026-08-13

**Requirements 13.1–13.5, 13.8** (Triage Agent — dependency-ordered handoff plan).

**Why.** No caller, same sweep. The recipient's ranked, dependency-aware list is
produced by `rankAccessItems` in `lib/access/dashboard.ts`, which is what the
access screen actually renders.

**Risk it carried.** Same shape: authenticated OpenAI surface with no consumer.

**What survives.** `lib/ai/triage-agent.ts` and its tests.

---

## `PUT` and `DELETE /api/policies/[id]` — retired 2026-08-13

**Requirements J4-R14, J4-R15** (policy edit preview; policy deletion cascade).

**Why.** Both sat in `KNOWN_UNREACHABLE` marked *undecided* — "retire or wire" and
"a real product question" — and the pre-release audit called carrying two
undecided handlers into a release what it is: how debt becomes permanent. The
product question has an answer. A policy is a **proposal** that materialises into
`access_rules`, and `access_rules` is the authoritative grant table. An owner who
wants different access edits the rules on `/rules`, where the effect is visible
and per-item. Editing an already-accepted proposal changes nothing a person can
see, and un-accepting one would have to reconcile the grants it already wrote —
a materialising layer that silently widens or narrows access is precisely the
hazard J4-R14/R15 exist to prevent.

**Risk it carried.** `DELETE` removed every `access_rules` row a policy had
generated, through an owner-authenticated route with no screen behind it. A
capability that can revoke access and cannot be reached is a capability that can
only ever be invoked by accident or by an attacker.

**How policies are still removed.** As a cascade of deleting the person — which
is the path the product has always actually used.

**What survives.** `lib/rules/policy-materialize.ts` and its tests, including
`previewPolicyChange`, which now has no caller in the product. Kept deliberately:
the reconciliation logic is the hard part of ever building a real edit surface,
it is property-tested, and J4-R14 is still on the books. Recorded here so it is a
known orphan rather than a discovered one — `api-reachability.ts` does not check
for unused library functions, by design.

---

## Not retired, but unreached

`lib/ops/api-reachability.ts` carries a second list, `KNOWN_UNREACHABLE`, for
handlers that are dead today but whose removal is a product decision rather than
a cleanup. Each entry is dated. They are listed rather than deleted because
silently dropping a capability is the same failure as silently shipping one.
