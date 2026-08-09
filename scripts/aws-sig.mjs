/**
 * Minimal SigV4-signed AWS request helper.
 *
 * WHY THIS EXISTS RATHER THAN THE AWS CLI. On the Windows workstation this repo
 * is maintained from, Norton intercepts TLS, and the AWS CLI (Python) fails
 * certificate verification against every AWS endpoint. Node's TLS stack is not
 * affected. Rather than disable certificate checking — on the tooling that
 * administers the database holding customer vaults, of all things — the same
 * calls are signed here and made with fetch.
 *
 * Committed rather than left as a scratch file because the backup runbook tells
 * someone to run it, and a runbook that references an untracked file works on
 * exactly one computer.
 *
 * Feature: relay-h0-mvp
 */

import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { readFileSync } from 'fs';
import { homedir } from 'os';

/**
 * Reads one profile from the shared credentials file.
 *
 * Hand-parsed rather than regex-matched: the file is CRLF on Windows, and a
 * `(.+)$` capture silently matches nothing there because `.` will not consume
 * the carriage return. That failure looks exactly like an absent profile.
 */
export function credentialsFromProfile(name) {
  const lines = readFileSync(homedir() + '/.aws/credentials', 'utf8').split(/\r?\n/);
  const found = {};
  let inBlock = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inBlock = line === '[' + name + ']';
      continue;
    }
    if (!inBlock || !line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    found[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }

  if (!found.aws_access_key_id) {
    throw new Error(`No credentials found in profile "${name}" (~/.aws/credentials)`);
  }

  const creds = {
    accessKeyId: found.aws_access_key_id,
    secretAccessKey: found.aws_secret_access_key,
  };
  if (found.aws_session_token) creds.sessionToken = found.aws_session_token;
  return creds;
}

/**
 * Signs and sends one request.
 *
 * @returns {Promise<{status:number, json?:unknown, text?:string}>}
 */
export async function awsRequest({
  credentials,
  service,
  region,
  host,
  path,
  method = 'GET',
  query = {},
  body,
}) {
  const signer = new SignatureV4({ service, region, credentials, sha256: Sha256 });

  const headers = { host };
  let payload;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }

  const signed = await signer.sign({
    method,
    protocol: 'https:',
    hostname: host,
    path,
    headers,
    query,
    body: payload,
  });

  const qs = Object.keys(query).length ? '?' + new URLSearchParams(query) : '';
  const res = await fetch('https://' + host + path + qs, {
    method,
    headers: signed.headers,
    body: payload,
  });

  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, text };
  }
}

/** Convenience: AWS Backup in a region. */
export const backup = (credentials, region) => (path, opts = {}) =>
  awsRequest({ credentials, service: 'backup', region, host: `backup.${region}.amazonaws.com`, path, ...opts });

/** Convenience: Aurora DSQL control plane in a region. */
export const dsql = (credentials, region) => (path, opts = {}) =>
  awsRequest({ credentials, service: 'dsql', region, host: `dsql.${region}.api.aws`, path, ...opts });
