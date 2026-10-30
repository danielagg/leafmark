// Trusted setup-machine check. Creates and removes only its own test fixtures.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ownerId = process.env.VITE_OWNER_ID;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const ref = new URL(url).hostname.split('.')[0];
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '--reveal', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const secret = keys.find(item => item.type === 'secret')?.api_key;
assert(secret, 'A trusted project API key is required for the temporary non-owner identity.');
const admin = createClient(url, secret, options);
const owner = createClient(url, key, options);
const stranger = createClient(url, key, options);
const anon = createClient(url, key, options);
const id = randomUUID();
const path = `${ownerId}/${id}.pdf`;
let strangerId;

function ok(result, message) { assert(!result.error, message); return result.data; }
async function denied(client, label) {
  assert.deepEqual((await client.from('books').select('id')).data ?? [], [], `${label} must not list books`);
  assert((await client.storage.from('books').download(path)).error, `${label} must not download books`);
  assert.deepEqual((await client.from('books').update({ progress: 0.99 }).eq('id', id).select('id')).data ?? [], [], `${label} must not change progress`);
  assert.deepEqual((await client.from('books').delete().eq('id', id).select('id')).data ?? [], [], `${label} must not delete book records`);
  await client.storage.from('books').remove([path]);
  assert(!(await owner.storage.from('books').download(path)).error, `${label} must not delete file bytes`);
  const fresh = randomUUID();
  const row = { id: fresh, owner_id: ownerId, filename: 'denied.pdf', format: 'pdf', storage_path: `${ownerId}/${fresh}.pdf`, byte_size: 8 };
  assert((await client.from('books').insert(row)).error, `${label} must not insert library records`);
  assert((await client.storage.from('books').upload(`${ownerId}/${fresh}.pdf`, new Blob(['%PDF-1.7']), { contentType: 'application/pdf' })).error, `${label} must not upload to owner storage`);
}

try {
  const settings = await (await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })).json();
  assert.equal(settings.disable_signup, true, 'Public signup must be disabled');
  assert.equal(settings.external.email, true, 'Owner password login must remain enabled');
  assert((await anon.auth.signUp({ email: `denied-${id}@leafmark.invalid`, password: randomBytes(24).toString('base64url') })).error, 'Public signup must fail');
  const signed = ok(await owner.auth.signInWithPassword({ email: process.env.VITE_OWNER_EMAIL, password: process.env.LEAFMARK_ACCESS_CODE }), 'Owner must sign in');
  assert.equal(signed.user.id, ownerId);
  assert.equal(ok(await owner.rpc('is_library_owner'), 'Owner allowlist check must succeed'), true);
  const bytes = await readFile('public/samples/The art of noticing.pdf');
  ok(await owner.storage.from('books').upload(path, bytes, { contentType: 'application/pdf', upsert: false }), 'Owner upload must work');
  ok(await owner.from('books').insert({ id, owner_id: ownerId, filename: `security-test-${id}.pdf`, format: 'pdf', storage_path: path, byte_size: bytes.length }), 'Owner must create metadata');
  const publicUrl = owner.storage.from('books').getPublicUrl(path).data.publicUrl;
  assert(!(await fetch(publicUrl)).ok, 'A public URL must not expose private bytes');
  await denied(anon, 'Anonymous visitor');

  const password = randomBytes(24).toString('base64url');
  const email = `security-${id}@leafmark.invalid`;
  strangerId = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Temporary unrelated identity must be created').user.id;
  ok(await stranger.auth.signInWithPassword({ email, password }), 'Unrelated identity must authenticate for the RLS test');
  assert.equal(ok(await stranger.rpc('is_library_owner'), 'Allowlist RPC must be available to authenticated users'), false);
  await denied(stranger, 'Unrelated authenticated user');
  assert((await stranger.storage.from('books').upload(`${strangerId}/${randomUUID()}.pdf`, new Blob(['%PDF-1.7']), { contentType: 'application/pdf' })).error, 'An unrelated user must not upload even under their own folder');
  assert((await stranger.schema('private').from('library_owner').insert({ singleton: true, user_id: strangerId })).error, 'Clients cannot self-allowlist');

  assert((await owner.from('books').update({ byte_size: 999 }).eq('id', id)).error, 'Stored file identity must be immutable');
  assert((await owner.from('books').update({ reading_position: { type: 'pdf', page: 0, offset: 0 } }).eq('id', id)).error, 'Invalid positions must be rejected');
  ok(await owner.from('books').update({ reading_position: { type: 'pdf', page: 2, offset: 0.25 }, progress: 0.4, last_read_at: '2000-01-01T00:00:00Z' }).eq('id', id), 'Owner progress update must work');
  const book = ok(await owner.from('books').select('reading_position,last_read_at,progress').eq('id', id).single(), 'Owner must read progress');
  assert.equal(book.reading_position.page, 2);
  assert.equal(book.progress, 0.4);
  assert(Date.parse(book.last_read_at) > Date.now() - 60_000, 'The server must assign the saved timestamp');
  console.log('PASS: public signup disabled, owner sign-in, private bucket, anonymous and unrelated-user denial, immutable file identity, validated positions, server timestamps.');
} finally {
  ok(await admin.storage.from('books').remove([path]), 'Test file cleanup must succeed');
  ok(await admin.from('books').delete().eq('id', id), 'Test metadata cleanup must succeed');
  if (strangerId) ok(await admin.auth.admin.deleteUser(strangerId), 'Temporary identity cleanup must succeed');
  await Promise.all([owner, stranger, anon].map(client => client.auth.signOut({ scope: 'local' })));
}
