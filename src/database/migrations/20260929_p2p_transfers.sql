BEGIN;

CREATE TABLE transfers (
    id UUID PRIMARY KEY,
    sender_user_id UUID NOT NULL REFERENCES users(id),
    recipient_user_id UUID NOT NULL REFERENCES users(id),
    sender_wallet_id UUID NOT NULL REFERENCES wallets(id),
    recipient_wallet_id UUID NOT NULL REFERENCES wallets(id),
    sender_wallet JSONB NOT NULL,
    recipient_wallet JSONB NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash TEXT NOT NULL,
    description VARCHAR(280),
    -- Amounts retain the Open Payments {value: string, assetCode, assetScale} shape.
    debit_amount JSONB NOT NULL,
    receive_amount JSONB,
    sent_amount JSONB,
    incoming_payment_url TEXT,
    quote_url TEXT,
    outgoing_payment_url TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'CREATING' CHECK (status IN (
      'CREATING', 'AWAITING_AUTHORIZATION', 'FINALIZING', 'AUTHORIZED',
      'SUBMITTING', 'PENDING', 'COMPLETED', 'FAILED', 'EXPIRED', 'UNKNOWN'
    )),
    error_code TEXT,
    callback_fingerprint TEXT,
    -- Only the finalized token is durable, to read/reconcile submitted payments.
    -- Pending continuation credentials live exclusively in encrypted Redis sessions.
    outgoing_access_token_enc TEXT,
    outgoing_token_expires_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_transfer_sender_idempotency UNIQUE(sender_user_id, idempotency_key),
    CONSTRAINT transfer_distinct_users CHECK (sender_user_id <> recipient_user_id)
);

CREATE INDEX idx_transfers_sender_history ON transfers(sender_user_id, created_at DESC, id DESC);
CREATE INDEX idx_transfers_recipient_history ON transfers(recipient_user_id, created_at DESC, id DESC);

COMMIT;
