/**
 * How many recovery codes an owner is issued. One definition, two audiences.
 *
 * 🔴 THE SIGNUP SCREEN PROMISED TEN AND THE PRODUCT ISSUED EIGHT. Found by
 * signing up on production on 2026-08-14 and counting what arrived. The number
 * lived only in recovery-code.ts, and the sentence describing it lived in a
 * client component that could not import from there — so the two were written
 * separately and drifted, exactly as the volatile-numbers rule predicts.
 *
 * IT LIVES IN ITS OWN FILE BECAUSE OF THE CLIENT BOUNDARY. recovery-code.ts
 * imports `crypto`, the database pool, the notifier and the guess-watch ledger.
 * Importing it from a `'use client'` component drags all of that into the
 * browser bundle and fails the build — which is precisely what happened on the
 * first attempt at this fix. A constant with no imports can be read from both
 * sides, so the promise and the behaviour cannot disagree again.
 *
 * Feature: relay-h0-mvp
 * Requirements: J1-R3, 17.1
 */

/**
 * Eight, not ten. Deliberately more than a handful and few enough to print on
 * one line of a card — and whatever it becomes, both the generator and the
 * sentence describing it read THIS.
 */
export const RECOVERY_CODE_COUNT = 8;
