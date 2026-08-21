'use client';

/**
 * Naming somebody, once, whatever they would do (J4-R1).
 *
 * 🔴 THE SCREEN CONTRADICTED THE MODEL, at the only point an owner ever meets
 * it. `lib/people/people.ts` opens with "One people list; roles are attributes",
 * and this page carried TWO add forms — one under "Who would step in", one under
 * "Who confirms it is real". A spouse who does both was typed in twice, because
 * the product asked the owner to know that it keeps two tables.
 *
 * The cost was never the extra typing. Two rows for one human means two
 * invitations to send, two claim codes to read down a phone, two standby lights
 * to chase, and a circle whose headcount says more people are standing by than
 * there are people. J4-R1 names this exact failure.
 *
 * ⚠️ TICKING BOTH IS AN ADD, NEVER AN EDIT. Naming someone who is already in the
 * circle adds the hat they are missing and touches nothing about the row they
 * already have — their claimed identity, their confirmed fingerprint phrase and
 * any break-glass marking are left exactly as they are. `lib/people/add-person.ts`
 * enforces that by holding no write path capable of doing otherwise.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1, 3.1, 3.2
 */

import { useState } from 'react';

import { apiSend } from '../_lib/api';
import { SELECTABLE_ROLES, field, card, primaryButton } from './PeopleSections';
import type { RecipientRole } from '../../../../lib/domain/enums';

/** What the server says it did, per hat. `created: false` = they already had it. */
export interface AddPersonResponse {
  name: string;
  email: string;
  recipient: { id: string; created: boolean } | null;
  verifier: { id: string; created: boolean } | null;
  createdAnything: boolean;
}

/**
 * What to tell the owner, in the same nouns the two sections below use.
 *
 * 🔴 "ADDED" IS NOT SAID UNLESS SOMETHING WAS ADDED. Naming a person who already
 * holds every hat asked for writes nothing, and a green "Added Sam" over that is
 * the false-green shape this codebase keeps finding — a screen reporting success
 * because nothing errored. It is a perfectly ordinary thing for an owner to do
 * (they forgot they had already named their sister), so it gets a true sentence
 * rather than an error.
 *
 * Pure and exported so the sentence itself is tested rather than eyeballed.
 */
export function describeAddOutcome(r: AddPersonResponse): string {
  const newRecipient = r.recipient?.created === true;
  const newVerifier = r.verifier?.created === true;

  if (newRecipient && newVerifier) {
    return `${r.name} is on both lists now — they would step in, and they can confirm an emergency is real. They need to accept each one separately, so there are two codes to give them.`;
  }
  if (newRecipient && r.verifier) {
    return `${r.name} was already someone who confirms an emergency. They would now step in as well.`;
  }
  if (newVerifier && r.recipient) {
    return `${r.name} was already someone who would step in. They can now confirm an emergency is real as well.`;
  }
  if (newRecipient) return `${r.name} would now step in.`;
  if (newVerifier) return `${r.name} can now confirm an emergency is real.`;

  return `${r.name} was already here, doing everything you ticked. Nothing changed.`;
}

const EMPTY = {
  name: '',
  email: '',
  phone: '',
  relationship: '',
  role: 'recipient' as RecipientRole,
  recipient: true,
  verifier: false,
};

export default function AddPersonForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const noHat = !form.recipient && !form.verifier;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaid(null);
    setBusy(true);
    try {
      const result = await apiSend<AddPersonResponse>('/api/people', 'POST', {
        name: form.name,
        email: form.email,
        phone: form.phone,
        relationship: form.relationship,
        // Sent only when it means something. The role belongs to the recipient
        // row; a person who only confirms emergencies does not have one.
        role: form.recipient ? form.role : undefined,
        roles: { recipient: form.recipient, verifier: form.verifier },
      });
      setSaid(describeAddOutcome(result));
      setForm(EMPTY);
      await onAdded();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div style={{ marginBottom: 'var(--s3)' }}>
        <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600, letterSpacing: '-0.01em' }}>
          Add someone
        </h2>
        {/*
          The sentence is half the fix. Two checkboxes with no explanation read
          as a choice between two things; what an owner needs to know is that one
          person can wear both hats and that they only enter them once.
        */}
        <p style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', marginTop: 'var(--s1)' }}>
          One person, however many jobs they do. If your husband would both step in and confirm an
          emergency is real, that is <strong style={{ color: 'var(--ink)' }}>one person</strong> —
          tick both, and enter him once.
        </p>
      </div>

      <form
        onSubmit={add}
        style={{ ...card, display: 'grid', gap: 'var(--s3)', padding: 'var(--s4)' }}
      >
        <div
          style={{
            display: 'grid',
            gap: 'var(--s2)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          <input
            style={field}
            placeholder="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            style={field}
            type="email"
            placeholder="Email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            style={field}
            placeholder="Phone (optional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>

        {/*
          A fieldset with a legend, not a bare pair of inputs: these two
          checkboxes are one question, and without the grouping a screen reader
          reads two unrelated toggles in the middle of a name-and-address form.
        */}
        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend style={{ fontSize: 'var(--t2)', fontWeight: 600, color: 'var(--ink)' }}>
            What would they do?
          </legend>

          <label
            style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)', alignItems: 'flex-start' }}
          >
            <input
              type="checkbox"
              checked={form.recipient}
              onChange={(e) => setForm({ ...form, recipient: e.target.checked })}
              style={{ marginTop: '3px', width: 18, height: 18, flexShrink: 0 }}
            />
            <span>
              <span style={{ display: 'block', fontSize: 'var(--t2)', color: 'var(--ink)' }}>
                Step in — receive what you set aside for them
              </span>
              <span style={{ display: 'block', fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
                Nothing opens for them until a trigger fires and your trusted contacts confirm it is
                real.
              </span>
            </span>
          </label>

          <label
            style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)', alignItems: 'flex-start' }}
          >
            <input
              type="checkbox"
              checked={form.verifier}
              onChange={(e) => setForm({ ...form, verifier: e.target.checked })}
              style={{ marginTop: '3px', width: 18, height: 18, flexShrink: 0 }}
            />
            <span>
              {/*
                THE NOUN THAT SENT THEM HERE. The readiness blocker says "No
                trusted contact yet" and /rules says "Add a trusted contact",
                both linking to this screen. It used to be the label on the
                verifier form's button; when that form was folded into this one
                the phrase had to come with it, or an owner following their own
                to-do list arrives and is offered a stranger. role-noun.test.ts
                reads this file for exactly that reason.
              */}
              <span style={{ display: 'block', fontSize: 'var(--t2)', color: 'var(--ink)' }}>
                Add a trusted contact — confirm an emergency is real when someone asks
              </span>
              <span style={{ display: 'block', fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
                They never see what is inside your vault — only how much, and only when they are
                asked.
              </span>
            </span>
          </label>
        </fieldset>

        {/*
          Shown only when it applies. `role` and `relationship` live on the
          recipient row; asking a person who will only ever confirm emergencies
          to pick a role would be asking for a value that is never stored.
        */}
        {form.recipient ? (
          <div
            style={{
              display: 'grid',
              gap: 'var(--s2)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            {/* aria-label because a <select> has no placeholder to name it —
                axe flagged exactly this on the form this one replaces. */}
            <select
              aria-label="Their role"
              style={field}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as RecipientRole })}
            >
              {SELECTABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <input
              style={field}
              placeholder="Relationship (optional)"
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
            />
          </div>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={busy || noHat}
            style={{ ...primaryButton, opacity: busy || noHat ? 0.6 : 1 }}
          >
            Add this person
          </button>
          {/*
            Says WHY it is disabled rather than leaving a dead button. A person
            with no hat is a row that can do nothing, and the server refuses it
            too — this is the same refusal, said before the click is wasted.
          */}
          {noHat ? (
            <p style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', marginTop: 'var(--s1)' }}>
              Tick at least one — otherwise there is nothing for them to do.
            </p>
          ) : null}
        </div>

        {said ? (
          <p role="status" style={{ fontSize: 'var(--t2)', color: 'var(--ink)' }}>
            {said}
          </p>
        ) : null}
        {error ? (
          <p role="alert" style={{ fontSize: 'var(--t2)', color: 'var(--clay)' }}>
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
