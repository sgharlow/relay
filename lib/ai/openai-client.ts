/**
 * OpenAI boundary for the importance-engine agents.
 *
 * `classifyVaultItems` sends NON-SECRET metadata only (the ZK boundary is
 * enforced upstream by lib/ai/metadata-query.ts) and asks the model to classify
 * each item. Returns raw classifications — callers clamp/normalise (the
 * importance_score range invariant lives in the agent, Property 18).
 *
 * Single seam so agents/tests mock exactly one place.
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.1–11.7
 */

import OpenAI from 'openai';
import type { VaultMetadata } from './metadata-query';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

/** Test seam — inject a stub OpenAI client (or null to reset). */
export function _setOpenAIClientForTesting(client: OpenAI | null): void {
  _client = client;
}

function model(): string {
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}

/** Raw per-item classification as returned by the model (unclamped). */
export interface RawClassification {
  id: string;
  is_root_credential: boolean;
  recurring_billing: boolean;
  irreplaceable: boolean;
  importance_score: number;
  /** Title of the item this one depends on for recovery (or null). */
  depends_on_title: string | null;
}

const SYSTEM_PROMPT =
  'You classify password-vault items from NON-SECRET metadata only. For each item return: ' +
  'is_root_credential (true for a primary email, phone, or password manager), ' +
  'recurring_billing (true for banks, credit cards, brokerages, or subscriptions), ' +
  'irreplaceable (true for government IDs, deeds, wills, or documents not regenerable from a login), ' +
  'importance_score in [0,1] (consequence-in-absence; higher = more critical), and ' +
  'depends_on_title (the title of the item this one\'s password reset routes through, e.g. a root email, else null). ' +
  'Respond ONLY as JSON: {"items":[{"id","is_root_credential","recurring_billing","irreplaceable","importance_score","depends_on_title"}]}.';

export async function classifyVaultItems(items: VaultMetadata[]): Promise<RawClassification[]> {
  if (items.length === 0) return [];

  const userPayload = items.map((i) => ({
    id: i.id,
    title: i.title,
    service_name: i.service_name,
    url: i.url,
    category: i.category,
    type: i.type,
  }));

  const resp = await getClient().chat.completions.create({
    model: model(),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ items: userPayload }) },
    ],
  });

  const content = resp.choices[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');

  const parsed = JSON.parse(content) as { items?: RawClassification[] };
  if (!Array.isArray(parsed.items)) throw new Error('OpenAI response missing items array');
  return parsed.items;
}
