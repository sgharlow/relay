/**
 * Thin AWS KMS boundary used by the `/api/kms/*` proxy routes.
 *
 * This module is the single place the backend talks to KMS, so route handlers
 * and their tests mock exactly one seam. It performs envelope-encryption key
 * operations only:
 *
 *  - generateDataKey() → KMS GenerateDataKey(AES_256): returns a fresh
 *    plaintext data key (for the browser's in-memory AES-GCM encrypt) plus its
 *    KMS-wrapped form (for storage).
 *  - decryptDataKey()  → KMS Decrypt: unwraps a stored data key back to
 *    plaintext (returned to the browser over TLS for the final AES-GCM decrypt).
 *
 * Values cross the wire as base64 strings. The plaintext data key is NEVER
 * logged here or by callers.
 *
 * ── PHASE B OF THE ENCRYPTION-CONTEXT ROLLOUT ─────────────────────────────
 * docs/encryption-context-rollout.md splits this change into three deploys, and
 * this module is the middle one: it learns to READ a context while nothing
 * writes one. Every row's `vault_items.kms_context_era` is NULL today, so every
 * decrypt still takes the legacy path and this deploy is observably a no-op.
 *
 * The property that buys is the only reason the split exists: by the time
 * anything writes a context, the ability to read one is already deployed and
 * proven, so phase C is reversible by turning a flag off rather than by
 * reverting code — and a revert after the first context wrap would leave those
 * rows intact and permanently unreachable.
 *
 * 🔴 THE ERA IS A STORED FACT, READ FROM THE ROW, AND NEVER INFERRED FROM A
 * FAILURE. There is deliberately no try-with-context-then-retry-without: a
 * no-context fallback is a permanently available bypass, reachable by anyone
 * who can make the first attempt fail — which is exactly what submitting
 * somebody else's blob does. An era this build does not recognise therefore
 * REFUSES rather than decrypting weaker. docs/encryption-context-design.md §2.
 *
 * Feature: relay-h0-mvp
 * Requirements: 2.2, 2.4, 17.4
 */

import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms';

let _client: KMSClient | null = null;

/** Lazily construct the KMS client so importing this module never needs creds. */
function getClient(): KMSClient {
  if (!_client) {
    _client = new KMSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  }
  return _client;
}

/** Test seam — inject a stub client (or null to reset to lazy construction). */
export function _setKmsClientForTesting(client: KMSClient | null): void {
  _client = client;
}

/**
 * KMS additional authenticated data. A blob wrapped with a context can only be
 * unwrapped by presenting the identical context, which is what moves tenant
 * separation from an application check into KMS itself.
 */
export type EncryptionContext = Record<string, string>;

/**
 * The only era this build knows how to read: wrapped with
 * `{ owner_id: <the owning user's id> }`. The value is the one migration 037
 * declares — the code that reads it owns that list.
 */
export const KMS_CONTEXT_ERA_OWNER_V1 = 'owner_v1';

/**
 * Phase C's switch, and it is OFF in this build.
 *
 * It is consulted at the wrap call site rather than here, so the decision is
 * visible where the wrap happens. This build cannot stamp `kms_context_era` on
 * the row it is wrapping for, so it must never wrap WITH a context — see the
 * refusal in `src/app/api/kms/wrap/route.ts`, which phase C replaces with the
 * wrap-and-stamp path in the same change that makes stamping possible.
 *
 * Exactly `'true'`, so a half-set variable (`1`, `yes`, an empty string left
 * behind by a deleted value) cannot cross the one boundary in this product
 * that cannot be crossed back.
 */
export function wrapsWithContext(): boolean {
  return process.env.KMS_WRAP_WITH_CONTEXT === 'true';
}

/**
 * How a stored data key was wrapped — read from the vault row it belongs to,
 * never accepted from a caller. A caller-supplied era is a caller-supplied
 * instruction to skip the context, which is the body-trusting mistake of
 * 2026-08-13 in a new costume.
 *
 * Both fields are REQUIRED on purpose. An optional provenance would let a new
 * call site silently take the legacy path, and the failure would be invisible
 * until the day a context-era row reached it.
 */
export interface WrapProvenance {
  /** `vault_items.kms_context_era`. NULL/undefined = wrapped before phase C. */
  era: string | null | undefined;
  /** The vault row's owner id — the value `owner_v1` binds to. */
  ownerId: string;
}

/**
 * The context a row's era calls for, or `undefined` for a legacy row.
 * @throws on any era this build does not recognise — fail closed, never weaker.
 */
function encryptionContextFor(provenance: WrapProvenance): EncryptionContext | undefined {
  const { era } = provenance;
  if (era === null || era === undefined) return undefined;
  if (era === KMS_CONTEXT_ERA_OWNER_V1) return { owner_id: provenance.ownerId };

  throw new Error(
    `Unrecognised kms_context_era ${JSON.stringify(era)} — refusing to decrypt. ` +
      'This build does not know which EncryptionContext that row was wrapped ' +
      'with, and decrypting without one would be a silent downgrade.',
  );
}

/** The CMK this build wraps and unwraps under. @throws when it is unset. */
function requireKeyId(): string {
  const keyId = process.env.KMS_KEY_ID;
  if (!keyId) throw new Error('KMS_KEY_ID environment variable is not set');
  return keyId;
}

export interface GeneratedDataKey {
  /** base64 of the plaintext AES-256 data key — browser-only, never persisted. */
  plaintextDataKey: string;
  /** base64 of the KMS-wrapped data key — safe to persist. */
  wrappedDataKey: string;
  /** The CMK id/ARN the data key was generated under. */
  kmsKeyId: string;
}

function toBase64(bytes: Uint8Array | undefined): string {
  if (!bytes) throw new Error('KMS returned an empty key blob');
  return Buffer.from(bytes).toString('base64');
}

/**
 * Generates a new AES-256 data key under the configured CMK.
 *
 * @param context optional `EncryptionContext` to bind the wrapped key to. Phase
 *   B passes nothing, so the call is byte-for-byte what it has always been; the
 *   parameter is the seam phase C flips on. A key wrapped with a context can
 *   ONLY be unwrapped with the identical context, so a row wrapped this way
 *   must also be stamped with the era that records it.
 * @throws if `KMS_KEY_ID` is unset or KMS returns an incomplete response.
 */
export async function generateDataKey(context?: EncryptionContext): Promise<GeneratedDataKey> {
  const keyId = requireKeyId();

  const out = await getClient().send(
    new GenerateDataKeyCommand({
      KeyId: keyId,
      KeySpec: 'AES_256',
      ...(context ? { EncryptionContext: context } : {}),
    }),
  );

  return {
    plaintextDataKey: toBase64(out.Plaintext),
    wrappedDataKey: toBase64(out.CiphertextBlob),
    kmsKeyId: out.KeyId ?? keyId,
  };
}

/**
 * Unwraps a previously wrapped data key back to its base64 plaintext form.
 *
 * `KeyId` is named explicitly. Without it KMS decrypts under whichever CMK the
 * ciphertext itself names; naming it makes KMS refuse a blob wrapped under any
 * other key. That is a no-op while there is one CMK, and it is required before
 * a context is ever used.
 *
 * @param wrappedDataKeyB64 base64 of the stored wrapped data key.
 * @param provenance how that row says it was wrapped — see `WrapProvenance`.
 * @throws before any KMS call if the era is unrecognised or `KMS_KEY_ID` is unset.
 */
export async function decryptDataKey(
  wrappedDataKeyB64: string,
  provenance: WrapProvenance,
): Promise<string> {
  const keyId = requireKeyId();
  const context = encryptionContextFor(provenance);

  const out = await getClient().send(
    new DecryptCommand({
      KeyId: keyId,
      CiphertextBlob: Buffer.from(wrappedDataKeyB64, 'base64'),
      ...(context ? { EncryptionContext: context } : {}),
    }),
  );
  return toBase64(out.Plaintext);
}
