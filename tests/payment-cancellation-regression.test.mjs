import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OpenPaymentsClientError } from '@interledger/open-payments';
import express from 'express';
import request from 'supertest';
import { TransferService } from '../dist/services/transfer.service.js';
import { TransferController } from '../dist/controllers/transfer.controller.js';
import { createTransferRouter } from '../dist/routes/api/v1/transfer.routes.js';

const id = 'ac669ff7-24f6-4d5d-a7a0-1e7347f4d93a';
const amount = { value: '1000', assetCode: 'ZAR', assetScale: 2 };
const wallet = name => ({ id: `https://provider.example/${name}`, assetCode: 'ZAR', assetScale: 2,
  authServer: 'https://provider.example/auth', resourceServer: 'https://provider.example' });
function fixture(status = 'AWAITING_AUTHORIZATION') {
  const t = { id, sender_user_id: 'sender', recipient_user_id: 'recipient', status,
    sender_wallet: wallet('sender'), recipient_wallet: wallet('recipient'), debit_amount: amount, receive_amount: amount,
    incoming_payment_url: 'https://provider.example/incoming', quote_url: 'https://provider.example/quote',
    created_at: new Date(), updated_at: new Date(), state_changed_at: new Date(),
    expires_at: new Date(Date.now() + 60000), incoming_expires_at: new Date(Date.now() - 1000),
    reconciliation_required: false, reconciliation_attempts: 0 };
  let session = { transferId: id, clientNonce: 'client-nonce', serverInteractNonce: 'server-nonce',
    cancelNonce: 'protected-cancel-nonce', grantRequestUrl: 'https://provider.example/auth', continueAfter: 0,
    expiresAt: Date.now() + 60000, pendingGrant: { interact: { redirect: 'https://provider.example/approve', finish: 'server-nonce' },
      continue: { uri: 'https://provider.example/continue', access_token: { value: 'continuation-secret' } } } };
  let held = false;
  const credentials = new Map();
  const calls = { submit: 0, grantCancel: 0, revoke: 0 };
  const repo = {
    findById: async () => structuredClone(t),
    findByIdempotencyKey: async (user, key) => user === t.sender_user_id && key === 'creation-key' ? structuredClone(t) : undefined,
    cancel: async (_id, user, reason = 'USER_CANCELLED') => {
      if (user !== t.sender_user_id || !['CREATING', 'AWAITING_AUTHORIZATION', 'FINALIZING'].includes(t.status)) return;
      Object.assign(t, { status: 'CANCELLED', error_code: reason, next_attempt_at: new Date(), cleanup_state: 'PENDING' });
      return structuredClone(t);
    },
    claim: async () => { if (held) return; held = true; return structuredClone(t); },
    renew: async () => true, release: async () => { held = false; },
    transition: async (_id, _owner, expected, updates) => {
      if (!expected.includes(t.status)) return;
      Object.assign(t, updates); return structuredClone(t);
    },
    credential: async (_id, purpose) => credentials.get(purpose),
    saveCredential: async (_id, _owner, value) => credentials.set(value.purpose, value),
    clearCredential: async (_id, _owner, purpose) => credentials.delete(purpose),
    findWallet: async user => ({ id: user, walletAddressUrl: wallet(user).id, assetCode: 'ZAR', assetScale: 2 }),
  };
  const grant = { access_token: { value: 'spending-secret', manage: 'https://provider.example/manage',
    access: [{ type: 'outgoing-payment', identifier: wallet('sender').id, actions: ['create', 'read', 'list'],
      limits: { debitAmount: amount, receiver: t.incoming_payment_url } }] } };
  const client = {
    grant: { continue: async () => grant, cancel: async () => { calls.grantCancel++; } },
    token: { revoke: async () => { calls.revoke++; } },
    outgoingPayment: { create: async () => { calls.submit++; throw new Error('not permitted in this test'); } },
  };
  const sessions = { findById: async () => session, save: async s => { session = s; }, delete: async () => { session = null; } };
  const service = new TransferService({ transferRepository: repo, paymentSessionRepository: sessions,
    getOpenPaymentsClient: async () => client, apiPublicUrl: 'http://localhost:9002' });
  const ref = 'interaction-ref';
  const hash = createHash('sha256').update([session.clientNonce, session.serverInteractNonce, ref, session.grantRequestUrl].join('\n')).digest('base64url');
  return { t, repo, sessions, client, service, calls, ref, hash, grant };
}

test('sender can cancel every state before confirmed approval, and cancellation is idempotent', async () => {
  for (const status of ['CREATING', 'AWAITING_AUTHORIZATION', 'FINALIZING']) {
    const f = fixture(status);
    assert.equal((await f.service.cancel('sender', id)).status, 'CANCELLED');
    assert.equal((await f.service.cancel('sender', id)).errorCode, 'USER_CANCELLED');
    assert.equal(f.calls.submit, 0); assert.equal(f.t.cleanup_state, 'PENDING');
  }
});

test('recipient and unrelated users cannot cancel, including an already cancelled transfer', async () => {
  for (const user of ['recipient', 'stranger']) {
    const f = fixture();
    await assert.rejects(f.service.cancel(user, id), { statusCode: 404 });
    assert.equal(f.t.status, 'AWAITING_AUTHORIZATION');
    await f.service.cancel('sender', id);
    await assert.rejects(f.service.cancel(user, id), { statusCode: 404 });
  }
});

test('cancellation rejects confirmed approval and every submitted or ended state', async () => {
  for (const status of ['AUTHORIZED', 'SUBMITTING', 'PENDING', 'UNKNOWN', 'COMPLETED', 'FAILED', 'EXPIRED']) {
    const f = fixture(status);
    await assert.rejects(f.service.cancel('sender', id), { statusCode: 409 });
    assert.equal(f.t.status, status); assert.equal(f.calls.submit, 0);
  }
});

test('cancellation wins against an in-flight approval callback and no payment is submitted', async () => {
  const f = fixture();
  let resume, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.client.grant.continue = async () => { entered(); await new Promise(resolve => { resume = resolve; }); return f.grant; };
  const callback = f.service.handleCallback(id, f.ref, f.hash);
  await started;
  assert.equal(f.t.status, 'FINALIZING');
  assert.equal((await f.service.cancel('sender', id)).status, 'CANCELLED');
  resume();
  assert.equal((await callback).status, 'CANCELLED');
  assert.equal(f.calls.submit, 0);
  const checked = await f.service.get('sender', id);
  assert.equal(checked.status, 'CANCELLED');
  assert.equal(f.calls.grantCancel, 1); assert.equal(f.calls.revoke, 1);
  assert.equal(await f.sessions.findById(id), null);
});

test('cancelled transfers cannot be resurrected by a late approval callback', async () => {
  const f = fixture();
  await f.service.cancel('sender', id);
  assert.equal((await f.service.handleCallback(id, f.ref, f.hash)).status, 'CANCELLED');
  assert.equal(f.calls.submit, 0);
});

test('a verified provider denial is a cancellation rather than a server error', async () => {
  const f = fixture();
  f.client.grant.continue = async () => { throw new OpenPaymentsClientError('denied', { description: 'denied', status: 401, code: 'request_denied' }); };
  assert.equal((await f.service.handleCallback(id, f.ref, f.hash)).status, 'CANCELLED');
  assert.equal(f.t.error_code, 'AUTHORIZATION_DECLINED'); assert.equal(f.calls.submit, 0);
});

test('decline redirects require the protected per-transfer cancellation token', async () => {
  const f = fixture();
  await assert.rejects(f.service.handleDecline(id, 'forged-token'), { statusCode: 400 });
  assert.equal(f.t.status, 'AWAITING_AUTHORIZATION');
  assert.equal((await f.service.handleDecline(id, 'protected-cancel-nonce')).status, 'CANCELLED');
  assert.equal(f.t.error_code, 'AUTHORIZATION_DECLINED'); assert.equal(f.calls.submit, 0);
  const approved = fixture('AUTHORIZED');
  await assert.rejects(approved.service.handleDecline(id, 'protected-cancel-nonce'), { statusCode: 409 });
});

test('provider cleanup failure preserves cancellation and retry credentials', async () => {
  const f = fixture();
  await f.service.cancel('sender', id);
  f.client.grant.cancel = async () => { throw new Error('provider offline'); };
  const first = await f.service.get('sender', id);
  assert.equal(first.status, 'CANCELLED'); assert.equal(f.t.cleanup_state, 'PENDING');
  assert.ok(await f.sessions.findById(id)); assert.ok(f.t.next_attempt_at);
  f.client.grant.cancel = async () => {};
  assert.equal((await f.service.get('sender', id)).status, 'CANCELLED');
  assert.equal(f.t.cleanup_state, 'DONE'); assert.equal(await f.sessions.findById(id), null);
});

test('an in-flight creation can be cancelled using its original idempotency key', async () => {
  const f = fixture('CREATING');
  assert.equal((await f.service.cancelByKey('sender', 'creation-key')).status, 'CANCELLED');
  await assert.rejects(f.service.cancelByKey('other', 'creation-key'), { statusCode: 409 });
  await assert.rejects(f.service.cancelByKey('sender', 'not-reserved'), { statusCode: 409, details: { retryAfter: 1 } });
  assert.equal(f.calls.submit, 0);
});

test('cancelling while creation awaits the provider preserves cleanup and returns no approval URL', async () => {
  const f = fixture('CREATING');
  let reserved = false, resume, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.repo.findByIdempotencyKey = async () => reserved ? structuredClone(f.t) : undefined;
  f.repo.reserve = async input => { Object.assign(f.t, input); reserved = true; return { created: true, transfer: structuredClone(f.t) }; };
  f.client.walletAddress = { get: async ({ url }) => ({ ...wallet('sender'), id: url }) };
  f.client.incomingPayment = {
    create: async () => ({ id: 'https://provider.example/incoming', walletAddress: wallet('recipient').id, completed: false }),
    complete: async () => ({ id: 'https://provider.example/incoming', walletAddress: wallet('recipient').id, completed: true }),
  };
  f.client.quote = { create: async () => ({ id: 'https://provider.example/quote', walletAddress: wallet('sender').id,
    receiver: 'https://provider.example/incoming', debitAmount: amount, receiveAmount: amount }) };
  f.client.grant.request = async (_args, body) => {
    if (body.interact) {
      entered(); await new Promise(resolve => { resume = resolve; });
      return { interact: { redirect: 'https://provider.example/approve', finish: 'server-nonce' },
        continue: { uri: 'https://provider.example/continue', access_token: { value: 'pending-secret' } } };
    }
    return { access_token: { value: 'temporary-secret', manage: 'https://provider.example/manage', access: body.access_token.access } };
  };
  const creating = f.service.create('sender', { recipientUserId: 'recipient', amount: '1000' }, 'creation-key');
  await started;
  assert.equal((await f.service.cancelByKey('sender', 'creation-key')).status, 'CANCELLED');
  resume();
  const created = await creating;
  assert.equal(created.transfer.status, 'CANCELLED'); assert.equal(created.transfer.authorizationUrl, undefined);
  assert.ok((await f.sessions.findById(f.t.id)).cancelNonce);
  assert.equal((await f.service.get('sender', f.t.id)).status, 'CANCELLED');
  assert.equal(f.calls.grantCancel, 1); assert.equal(f.calls.submit, 0);
});

test('cancel HTTP endpoint enforces auth, UUID validation, owner scope and no-store', async () => {
  const f = fixture();
  const app = express();
  const auth = (req, res, next) => {
    if (!req.headers.authorization) { res.sendStatus(401); return; }
    req.user = { id: req.headers.authorization }; next();
  };
  const pass = (_req, _res, next) => next();
  app.use('/api/v1/transfers', createTransferRouter(auth, new TransferController(f.service), { create: pass, status: pass, callback: pass }));
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message }));
  await request(app).post(`/api/v1/transfers/${id}/cancel`).expect(401);
  await request(app).post('/api/v1/transfers/not-a-uuid/cancel').set('Authorization', 'sender').expect(400);
  await request(app).post(`/api/v1/transfers/${id}/cancel`).set('Authorization', 'recipient').expect(404);
  const cancelled = await request(app).post(`/api/v1/transfers/${id}/cancel`).set('Authorization', 'sender').expect(200);
  assert.equal(cancelled.body.data.status, 'CANCELLED'); assert.equal(cancelled.headers['cache-control'], 'no-store');
  assert.equal(cancelled.body.data.authorizationUrl, undefined);
});

test('public decline callback returns a cancellation page without leaking the token', async () => {
  const f = fixture(); const app = express();
  const pass = (_req, _res, next) => next();
  app.use('/api/v1/transfers', createTransferRouter(pass, new TransferController(f.service), { callback: pass, create: pass, status: pass }));
  const response = await request(app).get('/api/v1/transfers/callback')
    .query({ transfer_id: id, result: 'grant_rejected', cancel_token: 'protected-cancel-nonce' }).expect(200);
  assert.ok(response.text.includes('Payment cancelled')); assert.ok(!response.text.includes('protected-cancel-nonce'));
  assert.equal(f.t.status, 'CANCELLED'); assert.equal(f.calls.submit, 0);
});
