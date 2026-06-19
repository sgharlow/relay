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
 * @throws if `KMS_KEY_ID` is unset or KMS returns an incomplete response.
 */
export async function generateDataKey(): Promise<GeneratedDataKey> {
  const keyId = process.env.KMS_KEY_ID;
  if (!keyId) throw new Error('KMS_KEY_ID environment variable is not set');

  const out = await getClient().send(
    new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256' }),
  );

  return {
    plaintextDataKey: toBase64(out.Plaintext),
    wrappedDataKey: toBase64(out.CiphertextBlob),
    kmsKeyId: out.KeyId ?? keyId,
  };
}

/**
 * Unwraps a previously wrapped data key back to its base64 plaintext form.
 * @param wrappedDataKeyB64 base64 of the stored wrapped data key.
 */
export async function decryptDataKey(wrappedDataKeyB64: string): Promise<string> {
  const out = await getClient().send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(wrappedDataKeyB64, 'base64'),
    }),
  );
  return toBase64(out.Plaintext);
}
