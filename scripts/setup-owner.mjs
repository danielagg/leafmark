// Run only on your computer after applying the database migration. Credentials
// are obtained through the logged-in Supabase CLI and never bundled by Vite.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ref = 'wvcwmujpnhrpzjkmuhsw';
const filename = '.env.local';
const source = await readFile(filename, 'utf8').catch(() => '');
const values = Object.fromEntries(
  source
    .split(/\r?\n/)
    .filter((line) => /^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => {
      const equals = line.indexOf('=');
      let value = line.slice(equals + 1).trim();
      if (value.startsWith('"')) {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.slice(1, -1);
        }
      } else if (value.startsWith("'")) value = value.slice(1, -1);
      return [line.slice(0, equals).trim(), value];
    }),
);
const keys = JSON.parse(
  execFileSync(
    'supabase',
    ['projects', 'api-keys', '--project-ref', ref, '--reveal', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ),
);
const secret = keys.find((key) => key.type === 'secret')?.api_key;
const publishable = keys.find((key) => key.type === 'publishable')?.api_key;
if (!secret || !publishable)
  throw new Error('The project must have publishable and secret API keys.');
const url = `https://${ref}.supabase.co`;
const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = values.VITE_OWNER_EMAIL || 'owner@leafmark.invalid';
const code = values.LEAFMARK_ACCESS_CODE || randomBytes(24).toString('base64url');
const { data: listed, error: listError } = await admin.auth.admin.listUsers();
if (listError) throw new Error('Could not inspect the owner account.');
let owner = listed.users.find((user) => user.email === email);
if (!owner) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: code,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not create the owner account: ${error.message}`);
  owner = data.user;
} else if (!values.LEAFMARK_ACCESS_CODE) {
  throw new Error(
    'The owner already exists. Set LEAFMARK_ACCESS_CODE to the existing code; this script never resets an existing credential.',
  );
}
if (!owner || !/^[0-9a-f-]{36}$/i.test(owner.id)) throw new Error('Invalid owner identity.');
// Persist the generated code before any remaining setup step can fail. No secret
// API key is written here. This file is ignored by Git and readable by its owner.
const additions = {
  VITE_SUPABASE_URL: url,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
  VITE_OWNER_EMAIL: email,
  VITE_OWNER_ID: owner.id,
  LEAFMARK_ACCESS_CODE: code,
};
const retained = source
  .split(/\r?\n/)
  .filter((line) => !Object.keys(additions).some((key) => line.trimStart().startsWith(`${key}=`)));
await writeFile(
  filename,
  retained.join('\n').trimEnd() +
    '\n\n' +
    Object.entries(additions)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') +
    '\n',
  { mode: 0o600 },
);
await chmod(filename, 0o600);
const query = `insert into private.library_owner (singleton, user_id) values (true, '${owner.id}'::uuid) on conflict (singleton) do nothing; select user_id from private.library_owner where singleton;`;
const output = JSON.parse(
  execFileSync(
    'supabase',
    ['db', 'query', '--linked', '--project-ref', ref, '--output', 'json', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ),
);
if (!output.rows?.some((row) => row.user_id === owner.id))
  throw new Error('The library owner allowlist does not match this account.');
const browser = createClient(url, publishable, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await browser.auth.signInWithPassword({ email, password: code });
if (error || data.user?.id !== owner.id)
  throw new Error('The owner credential could not be verified.');
await browser.auth.signOut({ scope: 'local' });
console.log(
  'Owner account ready. Public connection settings and the private access code are saved in .env.local.',
);
console.log('No billing, compute, or subscription settings were changed.');
