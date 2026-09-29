-- Apply once to an existing database. New databases use schema.sql instead.
BEGIN;

ALTER TABLE wallet_grants
    ADD COLUMN transaction_id TEXT UNIQUE,
    ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING', 'ACTIVE')),
    ADD COLUMN pending_grant_enc TEXT,
    ALTER COLUMN access_token_enc DROP NOT NULL;

ALTER TABLE wallet_grants ADD CONSTRAINT wallet_grants_state_check CHECK (
    (status = 'PENDING' AND transaction_id IS NOT NULL AND pending_grant_enc IS NOT NULL AND access_token_enc IS NULL)
    OR (status = 'ACTIVE' AND access_token_enc IS NOT NULL AND pending_grant_enc IS NULL)
);

COMMIT;
