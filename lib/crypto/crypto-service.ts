/**
 * Client-side crypto boundary (browser trust boundary).
 *
 * Implements AWS envelope encryption with the plaintext secret never leaving the
 * browser (design.md "Encrypt Path"):
 *
 *   1. POST /api/kms/wrap        → { plaintext_data_key, wrapped_data_key, kms_key_id }
 *   2. import plaintext data key → AES-GCM-256 CryptoKey; encrypt the payload
 *   3. discard the plaintext data key from memory
 *   4. POST /api/vault/items     → { ciphertext, iv, wrapped_data_key, kms_key_id, ...metadata }
 *
 * The server stores only ciphertext + the KMS-wrapped data key; it never sees
 * the plaintext payload or the plaintext data key at rest. Any crypto or KMS
 * failure aborts the save and transmits nothing (throws {@link CryptoError}).
 *
 * Uses Web Crypto (`globalThis.crypto.subtle`), available in browsers and in the
 * Node test runtime — so the encrypt/decrypt core is testable without a DOM.
 *
 * NOTE: `saveItem` POSTs to `/api/vault/items`, which is implemented by task 7
 * (not yet built). The wrap call and the crypto core are fully functional; the
 * vault POST is the documented integration seam.
 *
 * Feature: relay-h0-mvp
 * Requirements: 2.1, 2.2, 2.3, 2.7
 */

// ---------------------------------------------------------------------------
// Errors + types
// ---------------------------------------------------------------------------

export class CryptoError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CryptoError';
    Object.setPrototypeOf(this, CryptoError.prototype);
  }
}

export interface EncryptedPayload {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

/** Non-secret metadata persisted alongside the ciphertext. */
export interface VaultItemMetadata {
  type: 'login' | 'account' | 'document' | 'note' | 'instruction';
  title: string;
  service_name?: string;
  url?: string;
  category?: string;
  criticality?: string;
}

/** Server-ready encrypted item (metadata + base64 ciphertext/wrapped key). */
export interface EncryptedItemPayload extends VaultItemMetadata {
  ciphertext: string;
  wrapped_data_key: string;
  kms_key_id: string;
}

interface WrapResponse {
  plaintext_data_key: string;
  wrapped_data_key: string;
  kms_key_id: string;
}

const AES_GCM = 'AES-GCM';
const IV_BYTES = 12; // 96-bit nonce, recommended for AES-GCM

// ---------------------------------------------------------------------------
// Cross-environment helpers
// ---------------------------------------------------------------------------

function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new CryptoError('Web Crypto (SubtleCrypto) is not available in this environment');
  }
  return c.subtle;
}

function randomBytes(n: number): Uint8Array {
  return (globalThis as { crypto: Crypto }).crypto.getRandomValues(new Uint8Array(n));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Packs the 12-byte AES-GCM IV in front of the ciphertext into one blob.
 *
 * The DB stores a single `ciphertext BYTEA` (no separate `iv` column), and the
 * design's vault POST body carries no `iv` field — so the IV travels prepended
 * to the ciphertext, the conventional AES-GCM layout. Use {@link unpackIvCiphertext}
 * on the decrypt path to recover both halves.
 */
export function packIvCiphertext(iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return out;
}

/** Splits a packed blob back into its leading IV and the ciphertext remainder. */
export function unpackIvCiphertext(blob: Uint8Array): { iv: Uint8Array; ciphertext: Uint8Array } {
  if (blob.length <= IV_BYTES) {
    throw new CryptoError('Packed ciphertext is too short to contain an IV');
  }
  return {
    iv: blob.slice(0, IV_BYTES),
    ciphertext: blob.slice(IV_BYTES),
  };
}

async function importAesKey(plainDataKeyB64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(plainDataKeyB64);
  if (raw.length !== 32) {
    throw new CryptoError(`Expected a 256-bit data key, got ${raw.length * 8} bits`);
  }
  // Cast to BufferSource: a Uint8Array is always a valid BufferSource at
  // runtime; the cast sidesteps the TS lib's ArrayBuffer/SharedArrayBuffer split.
  return getSubtle().importKey('raw', raw as BufferSource, { name: AES_GCM }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// ---------------------------------------------------------------------------
// CryptoService
// ---------------------------------------------------------------------------

export class CryptoService {
  /**
   * Injected fetch — defaults to the global. Lets tests stub network calls.
   * The default is bound to globalThis: calling `this.fetchImpl(...)` would
   * otherwise invoke the global `fetch` with `this` = this CryptoService
   * instance, which the browser/undici rejects ("Illegal invocation").
   */
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  /**
   * Encrypts `plaintext` under the supplied base64 plaintext data key using
   * AES-GCM-256 with a fresh random IV.
   */
  async encryptItem(plaintext: string, plainDataKeyB64: string): Promise<EncryptedPayload> {
    try {
      const key = await importAesKey(plainDataKeyB64);
      const iv = randomBytes(IV_BYTES);
      const data = new TextEncoder().encode(plaintext);
      const buf = await getSubtle().encrypt(
        { name: AES_GCM, iv: iv as BufferSource },
        key,
        data as BufferSource,
      );
      return { ciphertext: new Uint8Array(buf), iv };
    } catch (err) {
      if (err instanceof CryptoError) throw err;
      throw new CryptoError('Encryption failed', err);
    }
  }

  /** Decrypts AES-GCM ciphertext back to the original UTF-8 string. */
  async decryptItem(
    ciphertext: Uint8Array,
    iv: Uint8Array,
    plainDataKeyB64: string,
  ): Promise<string> {
    try {
      const key = await importAesKey(plainDataKeyB64);
      const buf = await getSubtle().decrypt(
        { name: AES_GCM, iv: iv as BufferSource },
        key,
        ciphertext as BufferSource,
      );
      return new TextDecoder().decode(buf);
    } catch (err) {
      if (err instanceof CryptoError) throw err;
      throw new CryptoError('Decryption failed', err);
    }
  }

  /**
   * Wraps a fresh data key, encrypts the plaintext in-browser, and returns the
   * server-ready payload (base64 IV-prepended ciphertext + wrapped key + metadata)
   * WITHOUT uploading. Used by the bulk-import flow, which encrypts every row
   * first and aborts the whole batch if any encryption fails (Req 10.4).
   *
   * @throws {CryptoError} on KMS or crypto failure — nothing is transmitted.
   */
  async encryptForUpload(plaintext: string, metadata: VaultItemMetadata): Promise<EncryptedItemPayload> {
    // 1. Fresh wrapped data key from the KMS proxy.
    const wrapRes = await this.fetchImpl('/api/kms/wrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!wrapRes.ok) {
      throw new CryptoError(`KMS wrap request failed (${wrapRes.status})`);
    }
    const wrap = (await wrapRes.json()) as WrapResponse;

    // 2-3. Encrypt with the plaintext key, then let it fall out of scope.
    let encrypted: EncryptedPayload;
    try {
      encrypted = await this.encryptItem(plaintext, wrap.plaintext_data_key);
    } catch (err) {
      throw err instanceof CryptoError ? err : new CryptoError('Encryption failed', err);
    }

    const packed = packIvCiphertext(encrypted.iv, encrypted.ciphertext);
    return {
      ciphertext: bytesToBase64(packed),
      wrapped_data_key: wrap.wrapped_data_key,
      kms_key_id: wrap.kms_key_id,
      ...metadata,
    };
  }

  /**
   * Full encrypt-and-save flow for a single item. Encrypts (never uploads
   * plaintext) then persists ciphertext + wrapped key + metadata.
   *
   * @throws {CryptoError} on any KMS, crypto, or persistence failure.
   */
  async saveItem(plaintext: string, metadata: VaultItemMetadata): Promise<{ id: string }> {
    const payload = await this.encryptForUpload(plaintext, metadata);
    const saveRes = await this.fetchImpl('/api/vault/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!saveRes.ok) {
      throw new CryptoError(`Vault save failed (${saveRes.status})`);
    }
    return (await saveRes.json()) as { id: string };
  }
}
