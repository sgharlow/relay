# Retired surface

Endpoints and capabilities deliberately removed, with the reason and what
replaced them. This file exists so that "it used to be here" has an answer other
than `git log`, and so a spec requirement whose route is gone is not mistaken for
an unimplemented one.

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

## Not retired, but unreached

`lib/ops/api-reachability.ts` carries a second list, `KNOWN_UNREACHABLE`, for
handlers that are dead today but whose removal is a product decision rather than
a cleanup. Each entry is dated. They are listed rather than deleted because
silently dropping a capability is the same failure as silently shipping one.
