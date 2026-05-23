// scripts/reports/iracing-auth.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePassword } from './iracing-auth.js';

test('encodePassword lowercases the email before hashing', () => {
  assert.equal(encodePassword('Foo@Bar.com', 'pw123'), encodePassword('foo@bar.com', 'pw123'));
});

test('encodePassword is deterministic and base64 sha256 (44 chars)', () => {
  const a = encodePassword('foo@bar.com', 'pw123');
  const b = encodePassword('foo@bar.com', 'pw123');
  assert.equal(a, b);
  assert.match(a, /^[A-Za-z0-9+/]{43}=$/);
});

test('encodePassword changes with a different password', () => {
  assert.notEqual(encodePassword('foo@bar.com', 'pw123'), encodePassword('foo@bar.com', 'pw124'));
});
