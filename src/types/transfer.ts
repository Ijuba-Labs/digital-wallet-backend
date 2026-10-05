import type { AccessToken, OutgoingPayment, PendingGrant } from "@interledger/open-payments";
import type { GrantInteraction } from "@/utils/grant-interaction";

export type PaymentAmount = OutgoingPayment["debitAmount"];
export type TransferStatus = "CREATING" | "AWAITING_AUTHORIZATION" | "FINALIZING" | "AUTHORIZED" |
  "SUBMITTING" | "PENDING" | "COMPLETED" | "FAILED" | "EXPIRED" | "UNKNOWN" | "CANCELLED";
export interface WalletSnapshot { id: string; assetCode: string; assetScale: number; authServer: string; resourceServer: string }
export interface CreateTransferInput { recipientUserId: string; senderWalletId?: string; amount: string; description?: string }
export interface TransferWallet { id: string; walletAddressUrl: string; assetCode: string; assetScale: number }

/** Internal records must never be serialized directly in HTTP responses. */
export interface TransferRecord {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  sender_wallet_id: string;
  recipient_wallet_id: string;
  sender_wallet: WalletSnapshot;
  recipient_wallet: WalletSnapshot;
  request_hash: string;
  idempotency_key: string;
  description: string | null;
  debit_amount: PaymentAmount;
  receive_amount: PaymentAmount | null;
  sent_amount: PaymentAmount | null;
  received_amount: PaymentAmount | null;
  incoming_payment_url: string | null;
  quote_url: string | null;
  outgoing_payment_url: string | null;
  status: TransferStatus;
  error_code: string | null;
  callback_fingerprint: string | null;
  provider_failed: boolean | null;
  expires_at: Date;
  quote_expires_at: Date | null;
  incoming_expires_at: Date | null;
  last_provider_checked_at: Date | null;
  reconciliation_required: boolean;
  reconciliation_attempts: number;
  next_attempt_at: Date | null;
  lease_owner: string | null;
  lease_until: Date | null;
  cleanup_state: "PENDING" | "DONE";
  cleanup_error: string | null;
  incoming_completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  state_changed_at: Date;
  completed_at: Date | null;
}
export type NewTransfer = Pick<TransferRecord, "id" | "sender_user_id" | "recipient_user_id" | "sender_wallet_id" |
  "recipient_wallet_id" | "sender_wallet" | "recipient_wallet" | "request_hash" | "idempotency_key" |
  "description" | "debit_amount" | "expires_at">;
export type TransferUpdates = Partial<Omit<TransferRecord, keyof NewTransfer | "lease_owner" | "lease_until" | "created_at">> & { expires_at?: Date };
export type CredentialPurpose = "incoming" | "outgoing" | "incoming-create" | "quote";
export interface TransferCredential {
  transfer_id: string;
  purpose: CredentialPurpose;
  token_enc: string;
  key_id: string;
  manage_url: string;
  access: AccessToken["access_token"]["access"];
  expires_at: Date | null;
  rotate_after: Date | null;
  generation: number;
  state: "READY" | "ROTATING" | "UNAVAILABLE" | "REJECTED";
}
export interface PaymentSession extends GrantInteraction {
  cancelNonce?: string;
  transferId: string;
  pendingGrant: PendingGrant;
  continueAfter: number;
  expiresAt: number;
  interactionSent?: boolean;
}
export interface TransferRepositoryInterface {
  cancel(id: string, senderUserId: string, reason?: "USER_CANCELLED" | "AUTHORIZATION_DECLINED"): Promise<TransferRecord | undefined>;
  findWallet(userId: string, walletId?: string): Promise<TransferWallet | undefined>;
  findById(id: string): Promise<TransferRecord | undefined>;
  findByIdempotencyKey(userId: string, key: string): Promise<TransferRecord | undefined>;
  reserve(input: NewTransfer): Promise<{ transfer: TransferRecord; created: boolean }>;
  claim(id: string, owner: string): Promise<TransferRecord | undefined>;
  claimDue(owner: string): Promise<TransferRecord | undefined>;
  renew(id: string, owner: string): Promise<boolean>;
  release(id: string, owner: string): Promise<void>;
  transition(id: string, owner: string, expected: TransferStatus[], updates: TransferUpdates): Promise<TransferRecord | undefined>;
  credential(id: string, purpose: CredentialPurpose): Promise<TransferCredential | undefined>;
  saveCredential(id: string, owner: string, credential: TransferCredential, expectedGeneration?: number): Promise<void>;
  clearCredential(id: string, owner: string, purpose: CredentialPurpose): Promise<void>;
  list(userId: string, limit: number, offset: number): Promise<TransferRecord[]>;
}
export interface PaymentSessionRepositoryInterface {
  save(session: PaymentSession): Promise<void>;
  findById(transferId: string): Promise<PaymentSession | null>;
  delete(transferId: string): Promise<void>;
}
