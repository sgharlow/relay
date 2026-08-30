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

> ⚠️ **THE FOUR ENTRIES BELOW WERE WRITTEN ON 2026-08-21, EIGHT DAYS AFTER THE
> RETIREMENT THEY RECORD.**
>
> Commit `c63accd` (2026-08-13) retired six handlers, and its message says "all
> six retired into docs/retired-surface.md with the reason and the replacement".
> The `KNOWN_UNREACHABLE` comment in `lib/ops/api-reachability.ts` says the same
> thing and lists all six by name. **Two of them arrived** — the
> `PUT`/`DELETE /api/policies/[id]` pair above. The other four were retired in
> the code and annotated in their own route files, and were never written up
> here.
>
> That is precisely the failure this document exists to prevent, one level up.
> Two files asserted a section that did not exist, so a reader following the
> pointer finds nothing and concludes the retirement never happened — which
> turns a decided removal back into what looks like an unimplemented
> requirement. It was found from the other direction: while shipping
> `POST /api/people` on 2026-08-21, whose header comment records the dangling
> pointer it could not fix from inside a route file.
>
> Every reason below is taken from the comment the retiring commit left in the
> route file itself. Those comments are the contemporaneous record; nothing here
> is reconstructed from memory.

---

## `GET /api/people` — retired 2026-08-13

> 🔴 **THIS IS NOT THE `POST /api/people` THAT SHIPPED ON 2026-08-21.** Same
> path, different method, opposite direction. `src/app/api/people/route.ts` was
> deleted on 2026-08-13 and **re-created on 2026-08-21 holding only a `POST`** —
> the unified add-a-person form (J4-R1). Nothing in this entry retires,
> deprecates, or argues against that endpoint. Read the method, not the path:
> **the read is retired; the write is new and reached.** The file's own header
> says so, and says it in more detail than this line can.

**Requirement J4-R1** (one list of people, roles as attributes) — the READ half
**survives** on `GET /api/circle`.

**Why.** Superseded. It returned `{ people: listPeople(ownerId) }` and nothing
else, while `/api/circle` returns that same roster embedded in the coverage
matrix and proposed policies the `/circle` screen actually renders — one call
behind one page. It had had no caller from the day `/circle` was built. Two
endpoints answering "who is in my circle?" is a contract with two definitions,
which this repo bans everywhere else.

**What survives.** `listPeople` in `lib/people/people.ts` — the merge-on-read
that folds a person holding two roles into one row. `GET /api/delegations` calls
it, and so does `lib/people/add-person.ts`, which is the logic behind the new
`POST`. Deleting the route never touched it.

---

## `GET /api/policies` — retired 2026-08-13

The read half of `/api/policies`; the file cites **J4-R3, J4-R6, J4-R7, J4-R14
and CC6** for the endpoint as a whole. Reading an owner's policies **survives**
on `GET /api/circle`.

**Why.** The same sweep and the same reason as `GET /api/people`, in the words
of the comment left in `src/app/api/policies/route.ts`: superseded by
`/api/circle`, "which returns the same policies embedded in the roster and
coverage matrix the screen actually renders. It had had no caller since /circle
was built."

**What survives.** `POST /api/policies` is untouched and is reached — it is how
an owner accepts a proposed policy. Note the asymmetry rather than tidying it
away: `/api/policies` is now **write-only**, and the read that used to sit
beside the write is served from a different endpoint.

⚠️ **Do not read this as one decision with the `PUT`/`DELETE` entry above.** The
policy edit and delete handlers were retired the same day for an entirely
different reason — a product ruling about what a policy *is* — while this one is
a plain supersession. Same file, same date, unrelated arguments.

---

## `PUT /api/rules/[id]` — retired 2026-08-13

**Requirements 3.3, 3.5, 3.8** (the owner changes an access rule) — **survive**
as delete-and-rewrite.

**Why.** Redundant, and it had never had a caller. A rule is changed by removing
it and writing another: the rule builder sits directly beneath the rule list on
`/rules`, so both steps are on one screen and no edit surface was ever built.
`DELETE` on the same route is reached and stays — the route file is now that
verb alone.

**What survives.** `updateRule` in `lib/rules/access-rules.ts`, with its tests,
and with no caller in the product. Recorded here so it is a known orphan rather
than a discovered one — the same disposition as `previewPolicyChange` above, for
the same reason: `api-reachability.ts` does not check for unused library
functions, by design.

---

## `GET /api/vault/items/[id]` — retired 2026-08-13

**Requirements 1.5–1.8** (a single owner vault item). **1.8's coverage moved
rather than going with the GET** — see below.

**Why.** It fetched one item, and there was nothing it returned that anything
wanted. The list endpoint already carries the metadata every screen needs, and —
this is the part specific to this product — **the ciphertext is never served
back to an owner**: an owner re-encrypts on update rather than reading the old
value, because Relay cannot decrypt it. The one thing only this route could
return was the one thing no screen ever asks for.

**Risk it carried.** It was the only handler that would return base64
`ciphertext` plus `wrapped_data_key` over HTTP to an owner session. That is not
a hole in the zero-knowledge boundary — the data key is wrapped and the server
still cannot open it — but it is a reachable path shipping the payload to no
consumer.

**What survives.** `PUT` and `DELETE` on this same route, both reached from
`/vault` (`src/app/(owner)/vault/ItemControls.tsx`, `lib/vault/declare-factors.ts`
and `lib/crypto/crypto-service.ts` all call them).

⚠️ **A NEARBY COMMENT DESCRIBES A DIFFERENT EVENT, and the two are easy to
merge.** The header of `lib/ops/api-reachability.ts` names "`PUT` and
`DELETE /api/vault/items/[id]`" as the worst of the four callerless handlers
found by hand between 2026-08-12 and 2026-08-13 — implemented, validated,
audited, tested, and reachable from nothing. Those two were **wired**, not
retired, and they are the two that survive here. Only the `GET` was removed.

**Requirement 1.8** — a row you do not own and a row that does not exist must
return the SAME 403, so existence is never revealed — was written against the
`GET`. Its assertions now sit on `DELETE` in
`src/app/api/vault/items/[id]/route.test.ts`, which is why deleting a handler
did not delete the guarantee. Moving a requirement's coverage to another verb is
the step that is easiest to skip and the one that turns a retirement into a
regression.

---

## `POST /api/demo/simulate` — retired 2026-08-30

**Ruled at Sitting D-1 (D25). Reason: exercisable by nobody.**

The route fast-forwarded the release state machine (ARMED → PENDING → GRACE →
RELEASED) for a demo-flagged account, using the real CAS transitions. It checked
auth and `is_demo_account` before reading any state, which was the right shape.

**Why it went.** It required a demo-owner session, and one can no longer be
minted: `TOTP_SECRET` was retired on 2026-08-13, and there are **zero
demo-flagged users in the cluster**. `scripts/demo-run.ts` was bannered
HISTORICAL on 2026-08-29 (B37) for the same reason. So the handler was
code-reachable and account-unreachable — and this repo has already retired six
handlers on exactly that argument: *a capability a user cannot reach can still be
reached by an attacker.*

**Replacement: none, and that is the point rather than an omission.** FR9 is
WITHDRAWN, not moved. `/demo` is a read-only walkthrough that renders seeded
data; it does not drive the state machine and is not a substitute. If a demo
fast-forward is ever wanted again it is a new decision, with a demo account
standing on the production cluster as its first cost.

> ⚠️ **A requirement's coverage was not moved, because there was nowhere to move
> it.** The `/api/vault/items/[id]` retirement above records the rule: *"Moving a
> requirement's coverage to another verb is the step that is easiest to skip and
> the one that turns a retirement into a regression."* Requirements 9.1, 9.2 and
> 9.7 were about this route's own gating and have no second home. They lapse with
> it, deliberately.

**⚠️ NOW CALLERLESS AND DELIBERATELY LEFT: `lib/release/simulate.ts`.** This route
was its only non-test caller. Deleting the library is a further step than the
ruling asked for, and bundling it would be exactly the "while I'm here" change
this repo's debugging rules refuse. Recorded here so it is a named debt rather
than a discovery: `runSimulation` and `lib/release/simulate.test.ts` now serve
nothing, and removing them is a one-line decision whenever somebody wants to make
it.

---

## Not retired, but unreached

`lib/ops/api-reachability.ts` carries a second list, `KNOWN_UNREACHABLE`, for
handlers that are dead today but whose removal is a product decision rather than
a cleanup. Each entry is dated. They are listed rather than deleted because
silently dropping a capability is the same failure as silently shipping one.
