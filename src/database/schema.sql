CREATE TYPE account_type AS ENUM ('USER', 'SYSTEM_RESERVE', 'MERCHANT');
CREATE TYPE transaction_status AS ENUM ('POSTED', 'PENDING', 'VOIDED');
CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');
CREATE TYPE wallet_link_status AS ENUM ('LINKED', 'UNLINKED');
CREATE TYPE reward_events_type AS ENUM ('EARNED', 'REDEEMED', 'EXPIRED', 'ADJUSTMENT');

CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        email VARCHAR(255) UNIQUE NOT NULL,
        phone_number VARCHAR(32) UNIQUE,
        password_hash VARCHAR(255), -- Nullable if using OAuth/Magic Link
        status user_status NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX idx_users_email ON users(email);

-- User-entered loyalty cards are not retailer-authorized ownership records.
CREATE TABLE loyalty_programs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    requires_custom_name BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO loyalty_programs (id, name, requires_custom_name) VALUES
    ('xtra-savings', 'Xtra Savings', false),
    ('clicks-clubcard', 'Clicks ClubCard', false),
    ('smart-shopper', 'Smart Shopper', false),
    ('other', 'Other', true);

CREATE TABLE loyalty_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_id TEXT NOT NULL REFERENCES loyalty_programs(id),
    custom_program_name TEXT,
    nickname TEXT,
    membership_number_enc TEXT,
    membership_number_mask TEXT,
    barcode_payload_enc TEXT,
    barcode_payload_mask TEXT,
    barcode_format TEXT,
    image_enc TEXT,
    image_mime TEXT,
    image_detection TEXT,
    image_detection_value_enc TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (membership_number_enc IS NOT NULL OR barcode_payload_enc IS NOT NULL OR image_enc IS NOT NULL),
    CHECK ((barcode_payload_enc IS NULL) = (barcode_format IS NULL)),
    CHECK ((image_enc IS NULL) = (image_mime IS NULL)),
    CHECK ((program_id = 'other' AND nullif(trim(custom_program_name), '') IS NOT NULL)
        OR (program_id <> 'other' AND custom_program_name IS NULL))
);
CREATE INDEX idx_loyalty_cards_user ON loyalty_cards(user_id, created_at DESC);
CREATE TABLE loyalty_card_identifiers (
    card_id UUID NOT NULL REFERENCES loyalty_cards(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_id TEXT NOT NULL REFERENCES loyalty_programs(id),
    fingerprint CHAR(64) NOT NULL,
    PRIMARY KEY (card_id, fingerprint),
    UNIQUE (user_id, program_id, fingerprint)
);


-- Data-driven loyalty wallet; additive to the encrypted card vault.
ALTER TABLE loyalty_programs ADD COLUMN configuration JSONB NOT NULL DEFAULT '{"retailerName":"Independent program","category":"OTHER","barcodeFormat":"UNKNOWN","capabilities":{"digitalCard":false,"staticBarcode":false,"manualEntry":true,"barcodeScanning":true,"rewardsInformation":true},"verification":{"barcodeFormatVerified":false,"numberFormatVerified":false,"digitalReproductionAllowed":false,"templateVerified":false},"status":"CATALOGUE_ONLY","active":true}'::jsonb, ADD COLUMN current_template_version INTEGER, ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ADD CHECK (jsonb_typeof(configuration) = 'object');
INSERT INTO loyalty_programs (id,name,requires_custom_name) VALUES ('xtra-savings','Xtra Savings',false) ON CONFLICT (id) DO NOTHING;
UPDATE loyalty_programs SET configuration = '{"retailerName":"Shoprite / Checkers","category":"GROCERY","barcodeFormat":"UNKNOWN","capabilities":{"digitalCard":false,"staticBarcode":false,"manualEntry":true,"barcodeScanning":true,"rewardsInformation":true},"verification":{"barcodeFormatVerified":false,"numberFormatVerified":false,"digitalReproductionAllowed":false,"templateVerified":false},"status":"CATALOGUE_ONLY","active":true,"officialUrl":"https://www.checkers.co.za/","rewardType":"MEMBER_OFFERS"}'::jsonb WHERE id = 'xtra-savings';
INSERT INTO loyalty_programs (id,name,requires_custom_name) VALUES ('smart-shopper','Smart Shopper',false) ON CONFLICT (id) DO NOTHING;
UPDATE loyalty_programs SET configuration = '{"retailerName":"Pick n Pay","category":"GROCERY","barcodeFormat":"UNKNOWN","capabilities":{"digitalCard":false,"staticBarcode":false,"manualEntry":true,"barcodeScanning":true,"rewardsInformation":true},"verification":{"barcodeFormatVerified":false,"numberFormatVerified":false,"digitalReproductionAllowed":false,"templateVerified":false},"status":"CATALOGUE_ONLY","active":true,"officialUrl":"https://smartshopper.pnp.co.za/","rewardType":"REWARDS"}'::jsonb WHERE id = 'smart-shopper';
INSERT INTO loyalty_programs (id,name,requires_custom_name) VALUES ('clicks-clubcard','Clicks ClubCard',false) ON CONFLICT (id) DO NOTHING;
UPDATE loyalty_programs SET configuration = '{"retailerName":"Clicks","category":"HEALTH_AND_BEAUTY","barcodeFormat":"UNKNOWN","capabilities":{"digitalCard":false,"staticBarcode":false,"manualEntry":true,"barcodeScanning":true,"rewardsInformation":true},"verification":{"barcodeFormatVerified":false,"numberFormatVerified":false,"digitalReproductionAllowed":false,"templateVerified":false},"status":"CATALOGUE_ONLY","active":true,"officialUrl":"https://clicks.co.za/clubcard","rewardType":"REWARDS"}'::jsonb WHERE id = 'clicks-clubcard';
INSERT INTO loyalty_programs (id,name,requires_custom_name) VALUES ('dis-chem-better-rewards','Better Rewards',false) ON CONFLICT (id) DO NOTHING;
UPDATE loyalty_programs SET configuration = '{"retailerName":"Dis-Chem","category":"PHARMACY","barcodeFormat":"UNKNOWN","capabilities":{"digitalCard":false,"staticBarcode":false,"manualEntry":true,"barcodeScanning":true,"rewardsInformation":true},"verification":{"barcodeFormatVerified":false,"numberFormatVerified":false,"digitalReproductionAllowed":false,"templateVerified":false},"status":"CATALOGUE_ONLY","active":true,"officialUrl":"https://www.dischem.co.za/better-rewards","rewardType":"MEMBER_OFFERS"}'::jsonb WHERE id = 'dis-chem-better-rewards';
INSERT INTO loyalty_programs (id,name,requires_custom_name) VALUES ('spar-rewards','SPAR Rewards',false) ON CONFLICT (id) DO NOTHING;
UPDATE loyalty_programs SET configuration = '{"retailerName":"SPAR","category":"GROCERY","barcodeFormat":"UNKNOWN","capabilities":{"digitalCard":false,"staticBarcode":false,"manualEntry":true,"barcodeScanning":true,"rewardsInformation":true},"verification":{"barcodeFormatVerified":false,"numberFormatVerified":false,"digitalReproductionAllowed":false,"templateVerified":false},"status":"CATALOGUE_ONLY","active":true,"officialUrl":"https://www.spar.co.za/","rewardType":"MEMBER_OFFERS"}'::jsonb WHERE id = 'spar-rewards';
INSERT INTO loyalty_programs (id,name,requires_custom_name) VALUES ('shell-v-plus','V+ Rewards',false) ON CONFLICT (id) DO NOTHING;
UPDATE loyalty_programs SET configuration = '{"retailerName":"Shell","category":"FUEL","barcodeFormat":"UNKNOWN","capabilities":{"digitalCard":false,"staticBarcode":false,"manualEntry":true,"barcodeScanning":true,"rewardsInformation":true},"verification":{"barcodeFormatVerified":false,"numberFormatVerified":false,"digitalReproductionAllowed":false,"templateVerified":false},"status":"CATALOGUE_ONLY","active":true,"officialUrl":"https://www.shell.co.za/motorists/loyalty-payment/vplus-rewards.html","rewardType":"REWARDS"}'::jsonb WHERE id = 'shell-v-plus';
INSERT INTO loyalty_programs (id,name,requires_custom_name) VALUES ('other','Other',true) ON CONFLICT (id) DO NOTHING;
UPDATE loyalty_programs SET configuration = '{"retailerName":"Independent program","category":"OTHER","barcodeFormat":"UNKNOWN","capabilities":{"digitalCard":false,"staticBarcode":false,"manualEntry":true,"barcodeScanning":true,"rewardsInformation":true},"verification":{"barcodeFormatVerified":false,"numberFormatVerified":false,"digitalReproductionAllowed":false,"templateVerified":false},"status":"CATALOGUE_ONLY","active":true}'::jsonb WHERE id = 'other';
CREATE TABLE loyalty_card_templates (
    program_id TEXT NOT NULL REFERENCES loyalty_programs(id),
    version INTEGER NOT NULL CHECK (version > 0),
    template_json JSONB NOT NULL CHECK (jsonb_typeof(template_json) = 'object'),
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (program_id, version)
);
INSERT INTO loyalty_card_templates (program_id, version, template_json) SELECT id, 1, '{"aspectRatio":1.585772508336421,"background":{"type":"solid","colors":["#F3F0E8"]},"barcode":{"x":0.07,"y":0.52,"width":0.86,"height":0.33,"backgroundColor":"#FFFFFF","foregroundColor":"#000000","showNumber":true},"attribution":"Independent loyalty wallet. No retailer affiliation is implied."}'::jsonb FROM loyalty_programs;
UPDATE loyalty_programs SET current_template_version = 1;
ALTER TABLE loyalty_programs ADD FOREIGN KEY (id, current_template_version) REFERENCES loyalty_card_templates(program_id, version);
ALTER TABLE loyalty_cards ADD COLUMN template_version INTEGER, ADD FOREIGN KEY (program_id, template_version) REFERENCES loyalty_card_templates(program_id, version);

-- Linked Wallet Addresses
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_address_url TEXT NOT NULL, -- e.g. "https://ilp.interledger-test.dev/ijubane"
    asset_code VARCHAR(12) NOT NULL,  -- e.g. "ZAR"
    asset_scale SMALLINT NOT NULL DEFAULT 2,
    auth_server TEXT NOT NULL,        -- e.g. "https://rafiki-auth.interledger-test.dev"
    resource_server TEXT NOT NULL,    -- e.g. "https://ilp.interledger-test.dev"
    status wallet_link_status NOT NULL DEFAULT 'LINKED', -- Linkage only; credentials have independent lifecycles.
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    public_name TEXT,
    verified_at TIMESTAMPTZ,
    development_fixture BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT uq_user_wallet UNIQUE(user_id, wallet_address_url)
);

CREATE UNIQUE INDEX uq_wallets_active_address ON wallets(wallet_address_url) WHERE status = 'LINKED';

CREATE INDEX idx_wallets_user ON wallets(user_id);

-- Immutable ownership proof; contains no authorization or credential lifecycle.
CREATE TABLE wallet_ownership_attestations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    transaction_id TEXT UNIQUE NOT NULL,
    verified_subject_uri TEXT NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL,
    callback_fingerprint CHAR(64) NOT NULL,
    client_id TEXT NOT NULL DEFAULT 'api',
    return_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wallet_ownership_wallet ON wallet_ownership_attestations(wallet_id);

-- Optional reusable authority, independent of wallet ownership/linkage.
CREATE TABLE wallet_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    transaction_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED','UNAVAILABLE')),
    access_token_enc TEXT NOT NULL,
    key_id TEXT NOT NULL,
    manage_url TEXT NOT NULL,
    access JSONB NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wallet_access_wallet ON wallet_access_grants(wallet_id);

-- Durable mobile retry identity; callback/session secrets remain in Redis.
CREATE TABLE onboarding_requests (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash CHAR(64) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    session_id TEXT NOT NULL,
    session_created_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, key_hash)
);
CREATE INDEX idx_onboarding_requests_session ON onboarding_requests(session_id);

-- Accounts (Users, Merchants, and System Liquidity Reserves)
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    type account_type NOT NULL, -- 'USER', 'SYSTEM_RESERVE', 'MERCHANT'
    -- Types:
    --   'USER_POINTS'           (User's points balance)
    --   'USER_CASH'             (User's fiat deposit if custodial)
    --   'SYSTEM_POINTS_RESERVE' (Points pool from which rewards are minted)
    --   'SYSTEM_CASH_SETTLEMENT'(Operating bank liquidity)
    --   'MERCHANT_PAYOUT'       (Settlement for partners)
    asset_code VARCHAR(12) NOT NULL, -- 'PTS', 'ZAR'
    asset_scale SMALLINT NOT NULL DEFAULT 0, -- 0 for points (integer), 2 for fiat cents
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_accounts_user_type ON accounts(user_id, type);

-- Immutable Ledger Transfers
CREATE TABLE ledger_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(128) UNIQUE NOT NULL, -- Prevents double-spending on mobile retries
    debit_account_id UUID NOT NULL REFERENCES accounts(id),
    credit_account_id UUID NOT NULL REFERENCES accounts(id),
    amount BIGINT NOT NULL CHECK (amount > 0),    -- Integer units (cents or points, NEVER floats)
    status transaction_status NOT NULL DEFAULT 'POSTED', -- 'PENDING', 'POSTED', 'VOIDED'
    category VARCHAR(32) NOT NULL,
    -- Categories:
    --   'REWARD_MINT'     (System -> User points)
    --   'REWARD_BURN'     (User -> System points redemption)
    --   'PEER_PAYMENT'    (User -> User via Open Payments)
    --   'CARD_PAYOUT'     (Settlement)

    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transfers_debit ON ledger_transfers(debit_account_id);
CREATE INDEX idx_transfers_credit ON ledger_transfers(credit_account_id);
CREATE INDEX idx_transfers_created ON ledger_transfers(created_at DESC);


-- Reward Audit Log (Tied directly to ledger transfers)
CREATE TABLE reward_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transfer_id UUID NOT NULL REFERENCES ledger_transfers(id), -- Every reward creates a ledger entry
    points BIGINT NOT NULL,
    event_type reward_events_type NOT NULL, -- 'EARNED', 'REDEEMED', 'EXPIRED', 'ADJUSTMENT'
    metadata JSONB,                  -- e.g. {"order_id": "123", "merchant": "Store A"}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reward_events_user ON reward_events(user_id, created_at DESC);

-- Reject missing fields, numeric JSON values, overflow, and fractional scales.
CREATE FUNCTION valid_payment_amount(amount JSONB, positive BOOLEAN) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF jsonb_typeof(amount) <> 'object' OR NOT jsonb_exists_all(amount, ARRAY['value','assetCode','assetScale'])
     OR jsonb_typeof(amount->'value') <> 'string'
     OR (amount->>'value') !~ '^(0|[1-9][0-9]{0,19})$'
     OR jsonb_typeof(amount->'assetCode') <> 'string'
     OR length(amount->>'assetCode') NOT BETWEEN 1 AND 12
     OR jsonb_typeof(amount->'assetScale') <> 'number'
     OR (amount->>'assetScale') !~ '^[0-9]{1,3}$' THEN RETURN FALSE; END IF;
  RETURN (amount->>'value')::numeric BETWEEN CASE WHEN positive THEN 1 ELSE 0 END AND 18446744073709551615
     AND (amount->>'assetScale')::int BETWEEN 0 AND 255;
END $$;

CREATE TABLE transfers (
    id UUID PRIMARY KEY,
    sender_user_id UUID NOT NULL REFERENCES users(id),
    recipient_user_id UUID NOT NULL REFERENCES users(id),
    sender_wallet_id UUID NOT NULL REFERENCES wallets(id),
    recipient_wallet_id UUID NOT NULL REFERENCES wallets(id),
    sender_wallet JSONB NOT NULL,
    recipient_wallet JSONB NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    description VARCHAR(280),
    debit_amount JSONB NOT NULL CHECK (valid_payment_amount(debit_amount, true)),
    receive_amount JSONB CHECK (valid_payment_amount(receive_amount, true)),
    sent_amount JSONB CHECK (valid_payment_amount(sent_amount, false)),
    received_amount JSONB CHECK (valid_payment_amount(received_amount, false)),
    incoming_payment_url TEXT UNIQUE,
    quote_url TEXT UNIQUE,
    outgoing_payment_url TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'CREATING' CHECK (status IN (
      'CREATING', 'AWAITING_AUTHORIZATION', 'FINALIZING', 'AUTHORIZED',
      'SUBMITTING', 'PENDING', 'COMPLETED', 'FAILED', 'EXPIRED', 'UNKNOWN', 'CANCELLED'
    )),
    error_code TEXT,
    callback_fingerprint CHAR(64),
    provider_failed BOOLEAN,
    expires_at TIMESTAMPTZ NOT NULL,
    quote_expires_at TIMESTAMPTZ,
    incoming_expires_at TIMESTAMPTZ,
    last_provider_checked_at TIMESTAMPTZ,
    reconciliation_required BOOLEAN NOT NULL DEFAULT false,
    reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ DEFAULT (now() + interval '60 seconds'),
    lease_owner UUID,
    lease_until TIMESTAMPTZ,
    cleanup_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (cleanup_state IN ('PENDING','DONE')),
    cleanup_error TEXT,
    incoming_completed_at TIMESTAMPTZ,
    state_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE(sender_user_id, idempotency_key),
    CHECK (sender_user_id <> recipient_user_id),
    CONSTRAINT transfers_sent_amount_matches_debit CHECK (sent_amount IS NULL OR (
      sent_amount->>'assetCode' = debit_amount->>'assetCode'
      AND sent_amount->>'assetScale' = debit_amount->>'assetScale'
      AND (sent_amount->>'value')::numeric <= (debit_amount->>'value')::numeric)),
    CHECK (received_amount IS NULL OR (receive_amount IS NOT NULL
      AND received_amount->>'assetCode' = receive_amount->>'assetCode'
      AND received_amount->>'assetScale' = receive_amount->>'assetScale'))
);
CREATE INDEX idx_transfers_sender_history ON transfers(sender_user_id, created_at DESC, id DESC);
CREATE INDEX idx_transfers_recipient_history ON transfers(recipient_user_id, created_at DESC, id DESC);
CREATE INDEX idx_transfers_work ON transfers(next_attempt_at) WHERE next_attempt_at IS NOT NULL;

CREATE TABLE transfer_credentials (
    transfer_id UUID NOT NULL REFERENCES transfers(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('incoming','outgoing','incoming-create','quote')),
    token_enc TEXT NOT NULL,
    key_id TEXT NOT NULL,
    manage_url TEXT NOT NULL,
    access JSONB NOT NULL,
    expires_at TIMESTAMPTZ,
    rotate_after TIMESTAMPTZ,
    generation INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','ROTATING','UNAVAILABLE','REJECTED')),
    PRIMARY KEY (transfer_id, purpose)
);
