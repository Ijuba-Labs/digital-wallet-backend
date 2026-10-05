import test from 'node:test';
import assert from 'node:assert/strict';
import { TransferService } from '../dist/services/transfer.service.js';
import { PaymentTokenService } from '../dist/services/payment-token.service.js';

const amount = { value: '1000', assetCode: 'ZAR', assetScale: 2 };
const wallet = id => ({ id: `https://provider.example/${id}`, assetCode: 'ZAR', assetScale: 2,
  authServer: 'https://provider.example/auth', resourceServer: 'https://provider.example' });

async function fixture(options = {}) {
  const now = new Date();
  const rows = Array.from({ length: options.count ?? 1 }, (_, i) => ({
    id: `transfer-${i}`, sender_user_id: 'sipho', recipient_user_id: 'patience',
    sender_wallet: wallet('sender'), recipient_wallet: wallet('recipient'),
    status: options.status ?? 'PENDING', debit_amount: amount, receive_amount: amount,
    incoming_payment_url: 'https://provider.example/incoming', quote_url: 'https://provider.example/quote',
    outgoing_payment_url: 'https://provider.example/outgoing', received_amount: null,
    provider_failed: options.providerFailed ?? false, reconciliation_required: true, reconciliation_attempts: 0,
    created_at: now, updated_at: now, state_changed_at: now, expires_at: new Date(Date.now() - 60000),
    incoming_expires_at: new Date(Date.now() - 60000), last_provider_checked_at: options.checkedAt ?? null,
  }));
  const credentials = new Map();
  const calls = { incoming: 0, outgoing: 0, submit: 0, grants: [], active: 0, maxActive: 0, claims: 0 };
  const repo = {
    findById: async id => structuredClone(rows.find(t => t.id === id)),
    list: async (_user, limit, offset) => structuredClone(rows.slice(offset, offset + limit)),
    claim: async id => { calls.claims++; return options.locked ? undefined : structuredClone(rows.find(t => t.id === id)); },
    renew: async () => true, release: async () => {},
    transition: async (id, _owner, _expected, updates) => {
      const row = rows.find(t => t.id === id); Object.assign(row, updates); return structuredClone(row);
    },
    credential: async (id, purpose) => credentials.get(`${id}:${purpose}`),
    saveCredential: async (id, _owner, value) => credentials.set(`${id}:${value.purpose}`, value),
    clearCredential: async (id, _owner, purpose) => credentials.delete(`${id}:${purpose}`),
  };
  const client = {
    grant: { request: async (_args, body) => {
      calls.grants.push(body.access_token.access);
      return options.interactive ? { interact: { redirect: 'https://provider.example/approve' } } : {
        access_token: { value: 'receipt-token', manage: 'https://provider.example/manage', access: options.broad ?
          [{ type: 'incoming-payment', actions: ['read', 'complete', 'read-all'] }] : body.access_token.access },
      };
    } },
    incomingPayment: { get: async () => {
      calls.incoming++; calls.active++; calls.maxActive = Math.max(calls.maxActive, calls.active);
      await new Promise(resolve => setTimeout(resolve, 2)); calls.active--;
      if (options.unavailable) throw new Error('provider unavailable');
      return { id: 'https://provider.example/incoming', walletAddress: options.mismatch ? wallet('other').id : wallet('recipient').id,
        receivedAmount: { ...amount, value: options.received ?? '1000' }, completed: true };
    } },
    outgoingPayment: {
      get: async () => { calls.outgoing++; return { id: 'https://provider.example/outgoing', walletAddress: wallet('sender').id,
        receiver: 'https://provider.example/incoming', quoteId: 'https://provider.example/quote', metadata: { transferId: 'transfer-0' },
        debitAmount: amount, receiveAmount: amount, sentAmount: amount, failed: options.outgoingFailed ?? false }; },
      create: async () => { calls.submit++; throw new Error('status reads must not submit'); },
    },
    token: { revoke: async () => {} },
  };
  const tokens = new PaymentTokenService(repo, async () => client);
  for (const row of rows) {
    await tokens.store(row.id, 'owner', 'outgoing', { value: 'outgoing-token', manage: 'https://provider.example/manage',
      access: [{ type: 'outgoing-payment', identifier: wallet('sender').id, actions: ['create', 'read', 'list'],
        limits: { debitAmount: amount, receiver: row.incoming_payment_url } }] }, () => {});
    if (options.expiredOutgoing) credentials.get(`${row.id}:outgoing`).expires_at = new Date(Date.now() - 1000);
    if (options.legacy) {
      await tokens.store(row.id, 'owner', 'incoming', { value: 'legacy-receipt', manage: 'https://provider.example/manage',
        access: [{ type: 'incoming-payment', identifier: row.incoming_payment_url, actions: ['read', 'complete'] }] }, () => {});
      Object.assign(credentials.get(`${row.id}:incoming`), { state: 'UNAVAILABLE', expires_at: new Date(Date.now() - 1000) });
    }
  }
  const service = new TransferService({ transferRepository: repo, paymentSessionRepository: { delete: async () => {} },
    getOpenPaymentsClient: async () => client, apiPublicUrl: 'http://localhost:9002' });
  return { service, rows, calls };
}

test('history confirms full receipt despite expired sender and legacy unavailable receipt credentials', async () => {
  const t = await fixture({ expiredOutgoing: true, legacy: true });
  const page = await t.service.list('sipho', 20, 0);
  assert.equal(page.transfers[0].status, 'COMPLETED');
  assert.equal(page.transfers[0].statusRefreshAvailable, true);
  assert.deepEqual(page.transfers[0].receivedAmount, amount);
  assert.equal(t.rows[0].status, 'COMPLETED');
  assert.deepEqual(t.calls.grants, [[{ type: 'incoming-payment', identifier: wallet('recipient').id, actions: ['read', 'complete'] }]]);
  assert.equal(t.calls.outgoing, 0); assert.equal(t.calls.submit, 0);
});

test('partial receipt stays pending even when the sender has sent the full amount', async () => {
  const t = await fixture({ received: '500' });
  const result = await t.service.get('patience', 'transfer-0');
  assert.equal(result.status, 'PENDING'); assert.equal(result.receivedAmount.value, '500');
  assert.equal(result.sentAmount.value, '1000'); assert.equal(t.calls.submit, 0);
});

test('full receipt takes precedence over provider failure, partial failed receipt remains failed', async () => {
  const full = await fixture({ providerFailed: true });
  assert.equal((await full.service.get('sipho', 'transfer-0')).status, 'COMPLETED');
  const partial = await fixture({ providerFailed: true, received: '500' });
  assert.equal((await partial.service.get('sipho', 'transfer-0')).status, 'FAILED');
});

test('wrong wallet, broad grants, interactive grants and unavailable provider never imply completion', async () => {
  for (const options of [{ mismatch: true }, { broad: true }, { interactive: true }, { unavailable: true }]) {
    const t = await fixture(options);
    const page = await t.service.list('sipho', 20, 0);
    assert.equal(page.transfers[0].status, 'PENDING');
    assert.equal(page.transfers[0].statusRefreshAvailable, false); assert.equal(t.calls.submit, 0);
  }
});

test('status access is restricted to sender and recipient before contacting a provider', async () => {
  const t = await fixture();
  await assert.rejects(t.service.get('other-user', 'transfer-0'), { statusCode: 404 });
  assert.equal(t.calls.claims, 0); assert.equal(t.calls.incoming, 0);
});

test('recent or terminal history does not contact a provider or expose authorization URLs', async () => {
  for (const options of [{ checkedAt: new Date() }, { status: 'COMPLETED' }, { status: 'AUTHORIZED' }]) {
    const t = await fixture(options);
    const page = await t.service.list('sipho', 20, 0);
    assert.equal(t.calls.incoming, 0); assert.equal(t.calls.submit, 0);
    assert.equal('authorizationUrl' in page.transfers[0], false);
  }
});

test('history preserves pagination and order, refreshing at most ten rows with four concurrent reads', async () => {
  const t = await fixture({ count: 13 });
  const page = await t.service.list('sipho', 12, 0);
  assert.deepEqual(page.pagination, { limit: 12, offset: 0, hasMore: true });
  assert.deepEqual(page.transfers.map(row => row.transferId), Array.from({ length: 12 }, (_, i) => `transfer-${i}`));
  assert.equal(t.calls.incoming, 10); assert.ok(t.calls.maxActive <= 4);
  assert.equal(page.transfers[11].status, 'PENDING'); assert.equal(t.calls.submit, 0);
});

test('history preserves pending state when another worker owns the transfer lease', async () => {
  const t = await fixture({ locked: true });
  const page = await t.service.list('sipho', 20, 0);
  assert.equal(page.transfers[0].status, 'PENDING'); assert.equal(t.calls.incoming, 0);
});
