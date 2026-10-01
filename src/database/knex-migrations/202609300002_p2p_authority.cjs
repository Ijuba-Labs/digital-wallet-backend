const { ensureTable, ensureIndexes, addColumns, amountFunction, noRollback } = require('../upgrade-utils.cjs');

exports.up = async (knex) => {
  await amountFunction(knex);
  const existing = await knex.schema.hasTable('transfers');
  await ensureTable(knex, 'transfers');
  await addColumns(knex, 'transfers', {
    received_amount: 'JSONB', provider_failed: 'BOOLEAN', quote_expires_at: 'TIMESTAMPTZ', incoming_expires_at: 'TIMESTAMPTZ',
    last_provider_checked_at: 'TIMESTAMPTZ', reconciliation_required: 'BOOLEAN NOT NULL DEFAULT false',
    reconciliation_attempts: 'INTEGER NOT NULL DEFAULT 0', next_attempt_at: "TIMESTAMPTZ DEFAULT (now() + interval '60 seconds')",
    lease_owner: 'UUID', lease_until: 'TIMESTAMPTZ',
    cleanup_state: "TEXT NOT NULL DEFAULT 'PENDING' CHECK (cleanup_state IN ('PENDING','DONE'))",
    cleanup_error: 'TEXT', incoming_completed_at: 'TIMESTAMPTZ', state_changed_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
  });
  const constraints = await knex.raw("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'transfers'::regclass AND contype = 'c'");
  for (const row of constraints.rows) {
    if (row.definition.includes('sent_amount') && row.definition.includes('debit_amount')) {
      await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', ['transfers', row.conname]);
    }
  }
  await knex.raw(`ALTER TABLE transfers ADD CONSTRAINT transfers_sent_amount_matches_debit CHECK (
    sent_amount IS NULL OR (sent_amount->>'assetCode' = debit_amount->>'assetCode'
      AND sent_amount->>'assetScale' = debit_amount->>'assetScale'
      AND (sent_amount->>'value')::numeric <= (debit_amount->>'value')::numeric))`);
  for (const [column, positive] of [['debit_amount',true],['receive_amount',true],['sent_amount',false],['received_amount',false]]) {
    const name = `transfers_${column}_valid`;
    const found = await knex('pg_constraint').where({ conname: name }).first();
    if (!found) await knex.raw('ALTER TABLE transfers ADD CONSTRAINT ?? CHECK (?? IS NULL OR valid_payment_amount(??, ' + (positive ? 'true' : 'false') + '))', [name, column, column]);
  }
  await ensureIndexes(knex, 'transfers');
  await ensureTable(knex, 'transfer_credentials');
  await knex.raw('ALTER TABLE transfer_credentials DROP CONSTRAINT IF EXISTS transfer_credentials_purpose_check');
  await knex.raw("ALTER TABLE transfer_credentials ADD CONSTRAINT transfer_credentials_purpose_check CHECK (purpose IN ('incoming','outgoing','incoming-create','quote'))");
  await knex.raw('ALTER TABLE transfer_credentials DROP CONSTRAINT IF EXISTS transfer_credentials_state_check');
  await knex.raw("ALTER TABLE transfer_credentials ADD CONSTRAINT transfer_credentials_state_check CHECK (state IN ('READY','ROTATING','UNAVAILABLE','REJECTED'))");
  if (existing && await knex.schema.hasColumn('transfers', 'outgoing_access_token_enc')) {
    // Legacy ciphertext has no scope/management/key metadata. Preserve it, mark
    // unfinished payments for manual recovery, and never resend an instruction.
    await knex('transfers').whereNotIn('status', ['COMPLETED','FAILED','EXPIRED'])
      .update({ reconciliation_required: true, next_attempt_at: knex.fn.now() });
    await knex('transfers').where({ status: 'SUBMITTING' }).update({ status: 'UNKNOWN', error_code: 'LEGACY_PAYMENT_OUTCOME_UNKNOWN' });
  }
};
exports.down = noRollback;
