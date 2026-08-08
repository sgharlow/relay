/** Creates a throwaway account for the G1 funnel walk and prints a live TOTP code. */
import { beginSignup, completeSignup } from './lib/auth/signup';
import { generateTotpCodeFor } from './lib/auth/totp';
import { query } from './lib/db/connection';

const EMAIL = 'g1-funnel-probe@relay.test';

async function main() {
  await query(`DELETE FROM vault_items WHERE owner_id IN (SELECT id FROM users WHERE email=$1)`,[EMAIL]);
  await query(`DELETE FROM users WHERE email=$1`,[EMAIL]);

  const b = await beginSignup(EMAIL);
  const { ownerId } = await completeSignup(b.enrolmentToken, generateTotpCodeFor(b.totpSecret));

  console.log(`EMAIL=${EMAIL}`);
  console.log(`SECRET=${b.totpSecret}`);
  console.log(`OWNER=${ownerId}`);
  console.log(`CODE=${generateTotpCodeFor(b.totpSecret)}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error('FAILED:',e?.message??e);process.exit(1);});
