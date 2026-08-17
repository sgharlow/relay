/**
 * What actually leaves for OpenAI.
 *
 * The zero-knowledge boundary has two halves and only one of them was pinned.
 * `metadata-query.ts` decides which COLUMNS leave the database, and its test
 * covers that. This decides which of those fields leave the BUILDING, and it had
 * no test at all — `classifyVaultItems` builds an explicit six-field projection,
 * and nothing would have noticed if it stopped.
 *
 * 🔴 WHY THIS BECAME WORTH WRITING ON 2026-08-17. `backup_note` is in
 * `VaultMetadata`, so it is available at this seam. Until today it was NULL for
 * every item in every real vault, because no write path existed — so widening
 * this projection to `...i` would have leaked nothing and looked harmless in
 * review. Now owners can write it, it is the one field here that holds a
 * sentence a person composed, and the placeholder the product suggests for it is
 * "the codes are in the desk drawer". That is not a field to send to a
 * third-party API by accident.
 *
 * The tidy-up this exists to catch is real and looks like an improvement:
 * replacing six named lines with a spread. `toLimited` in lib/access/dashboard.ts
 * carries the same shape and the same guard, for the same reason.
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.1-11.7, CC2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type OpenAI from 'openai';

import { classifyVaultItems, _setOpenAIClientForTesting } from './openai-client';
import type { VaultMetadata } from './metadata-query';

/** Exactly what the model needs to classify an item, and nothing else. */
const PERMITTED = ['id', 'title', 'service_name', 'url', 'category', 'type'] as const;

const create = vi.fn();

function stubClient(): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

function item(over: Partial<VaultMetadata> = {}): VaultMetadata {
  return {
    id: 'i-1',
    title: 'Gmail',
    service_name: 'Google',
    url: 'https://mail.google.com',
    category: 'communication',
    type: 'login',
    criticality: 'critical',
    is_root_credential: true,
    recurring_billing: false,
    irreplaceable: false,
    importance_score: 0.9,
    depends_on_item_id: null,
    backup_note: 'The spare key is under the third plant pot.',
    ...over,
  } as VaultMetadata;
}

/** The JSON actually handed to the model. */
async function sentPayload(items: VaultMetadata[]): Promise<Array<Record<string, unknown>>> {
  create.mockResolvedValueOnce({ choices: [{ message: { content: '{"items":[]}' } }] });
  await classifyVaultItems(items);
  const body = create.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
  const user = body.messages.find((m) => m.role === 'user');
  return (JSON.parse(user!.content) as { items: Array<Record<string, unknown>> }).items;
}

beforeEach(() => {
  vi.clearAllMocks();
  _setOpenAIClientForTesting(stubClient());
});

afterEach(() => {
  _setOpenAIClientForTesting(null);
});

describe('the AI seam sends non-secret descriptive metadata and nothing else', () => {
  it('sends exactly the permitted fields', async () => {
    const [sent] = await sentPayload([item()]);
    expect(Object.keys(sent).sort()).toEqual([...PERMITTED].sort());
  });

  it('never sends the owner-written note', async () => {
    /*
      The field most likely to contain something a person would not choose to
      hand to a third party, and the newest arrival here. The model does not need
      it: the classification asks whether an account is a root credential,
      recurring, irreplaceable, and what it depends on — all answerable from the
      title, service and category.
    */
    const [sent] = await sentPayload([item()]);
    expect(sent).not.toHaveProperty('backup_note');
    expect(JSON.stringify(sent)).not.toContain('plant pot');
  });

  it('never sends the classification it is being asked to produce', async () => {
    // Sending is_root_credential or importance_score back would let the model
    // anchor on the previous run's answer instead of re-deciding.
    const [sent] = await sentPayload([item()]);
    for (const leaked of ['is_root_credential', 'importance_score', 'irreplaceable', 'recurring_billing', 'depends_on_item_id', 'criticality']) {
      expect(sent, `${leaked} should not be sent to the model`).not.toHaveProperty(leaked);
    }
  });

  it('holds for every item in a batch, not only the first', async () => {
    const sent = await sentPayload([item(), item({ id: 'i-2', title: 'Bank', backup_note: 'PIN is my birthday' })]);
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent)).not.toContain('birthday');
  });

  it('does not call the model at all for an empty vault', async () => {
    await classifyVaultItems([]);
    expect(create).not.toHaveBeenCalled();
  });
});
