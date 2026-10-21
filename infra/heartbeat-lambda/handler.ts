/**
 * AWS Lambda entry for the cloud heartbeat (B12.i). Wiring only — every
 * decision is in lib/ops/heartbeat-cloud.ts, which is unit-tested. This file
 * plugs in S3 (alert state), SNS (mail), Secrets Manager (GitHub token) and the
 * real canary. Invoked every 15 minutes by EventBridge Scheduler; see
 * docs/canary-dispatch.md and ./deploy.sh.
 *
 * It never throws for a probe, GitHub, state or mail failure: an async Lambda
 * error is retried, and a retry would dispatch the workflows again.
 *
 * Feature: relay-h0-mvp
 * Requirements: B12.i
 */

import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client, NoSuchKey } from '@aws-sdk/client-s3';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { cloudHeartbeat, githubRest } from '../../lib/ops/heartbeat-cloud.ts';
import { runCanary } from '../../lib/ops/canary-run.ts';
import { policyFromEnv } from '../../lib/ops/heartbeat-alert.ts';

const env = (k: string, fallback?: string): string => {
  const v = process.env[k]?.trim() || fallback;
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const s3 = new S3Client({});
const sns = new SNSClient({});
const secrets = new SecretsManagerClient({});
let token: string | undefined; // cached across warm invocations

/** SNS subjects must be ASCII, single-line and under 100 characters. */
function snsSubject(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 99) || 'relay heartbeat';
}

/**
 * `{"drill": true}` proves the alert path end to end without touching anything real:
 * the canary is pointed at a path that does not exist (so it must fail), the state is
 * a separate object, nothing is dispatched, and the subject says DRILL.
 *   aws lambda invoke --function-name relay-heartbeat --payload '{"drill":true}' --cli-binary-format raw-in-base64-out out.json
 */
export async function handler(event?: { drill?: boolean }): Promise<unknown> {
  const drill = event?.drill === true;
  const bucket = env('STATE_BUCKET');
  const key = drill ? 'heartbeat/drill-state.json' : env('STATE_KEY', 'heartbeat/alert-state.json');
  const topicArn = env('ALERT_TOPIC_ARN');
  const realBase = env('CANARY_BASE_URL', 'https://relaystandby.com');
  const baseUrl = drill ? `${realBase}/__heartbeat-drill__` : realBase;

  let githubError: string | null = null;
  if (!token) {
    try {
      const s = await secrets.send(new GetSecretValueCommand({ SecretId: env('GITHUB_TOKEN_SECRET_ID') }));
      token = s.SecretString?.trim() || undefined;
      if (!token) githubError = 'GitHub token secret is empty';
    } catch (e) {
      githubError = `GitHub token unavailable: ${(e as Error).name}`;
    }
  }
  const real = token ? githubRest({ token, repo: env('HEARTBEAT_REPO', 'sgharlow/relay') }) : null;
  const github = real
    ? drill
      ? { listCanaryRuns: real.listCanaryRuns, dispatch: async () => { throw new Error('drill: no dispatch'); } }
      : real
    : {
        // No token: dispatch and the delivery count both report "could not", never "healthy".
        listCanaryRuns: async () => { throw new Error(githubError ?? 'no GitHub token'); },
        dispatch: async () => { throw new Error(githubError ?? 'no GitHub token'); },
      };

  const report = await cloudHeartbeat(
    {
      now: () => new Date(),
      canary: () => runCanary(baseUrl),
      github,
      loadState: async () => {
        try {
          const o = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          return (await o.Body?.transformToString('utf-8')) ?? null;
        } catch (e) {
          if (e instanceof NoSuchKey) return null;
          throw e;
        }
      },
      saveState: async (raw) => {
        if (raw === null) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        else await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: raw, ContentType: 'application/json' }));
      },
      send: async (subject, text) => {
        try {
          const r = await sns.send(
            new PublishCommand({
              TopicArn: topicArn,
              Subject: snsSubject(drill ? `[DRILL] ${subject}` : subject),
              Message: `${drill ? '[DRILL] This is a test of the alert path; nothing is wrong.\n\n' : ''}${subject}\n\n${text}`,
            }),
          );
          return Boolean(r.MessageId);
        } catch (e) {
          console.error(`alert publish failed: ${(e as Error).message}`);
          return false;
        }
      },
    },
    {
      baseUrl,
      windowHours: Number(process.env.HEARTBEAT_WINDOW_HOURS ?? 6),
      minRuns: Number(process.env.HEARTBEAT_MIN_RUNS ?? 1),
      policy: policyFromEnv({
        HEARTBEAT_REMIND_HOURS: process.env.HEARTBEAT_REMIND_HOURS,
        HEARTBEAT_RECOVERY_HOURS: process.env.HEARTBEAT_RECOVERY_HOURS,
      }),
    },
  );

  // A rotated or revoked token: drop the cached one so the next tick re-reads the secret.
  if (/HTTP 401/.test(`${report.dispatch.canary} ${report.why ?? ''}`)) token = undefined;
  if (drill) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});

  // One JSON line per tick — the CloudWatch equivalent of .heartbeat/runs.jsonl + dispatch.log.
  console.log(JSON.stringify({ at: new Date().toISOString(), ...(drill ? { drill: true } : {}), ...report }));
  return report;
}
