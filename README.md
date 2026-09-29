# Digital Wallet Backend

[![Backend CI](https://github.com/n-sipho/digital-wallet-backend/actions/workflows/backend.yml/badge.svg)](https://github.com/n-sipho/digital-wallet-backend/actions/workflows/backend.yml) [![Coverage Status](https://coveralls.io/repos/github/n-sipho/digital-wallet-backend/badge.svg?branch=main)](https://coveralls.io/github/n-sipho/digital-wallet-backend?branch=main)
<!--
==============================================================================
README.md Documentation
Best Practice:
- Provide clear onboarding instructions, architecture decisions, and scripts.
- Document environment variables and setup steps for team members.
==============================================================================
-->

## Architecture Overview
This backend follows a layered modular architecture:
- **Routes**: Handle routing, URL mapping, and apply relevant middleware.
- **Controllers**: Handle HTTP request validation, status codes, and delegate to services.
- **Services**: Contain pure business logic and orchestrate domain rules.
- **Repositories / Models**: Manage database access, queries, and data persistence.
- **Middlewares**: Process cross-cutting concerns (auth, logging, rate limiting, error handling).

## Getting Started
1. Install dependencies: `pnpm install`
2. Copy environment file: `cp .env.example .env`
3. Run in development mode: `pnpm dev`
4. Apply the baseline migration: `pnpm db:migrate`
5. Start the API and worker: `pnpm dev` and `pnpm worker:dev`

## Docker development

Set `OPEN_PAYMENTS_PRIVATE_KEY_HOST_PATH` in `.env` to the **absolute host path**
of your registered Open Payments private key. Compose mounts it read-only for
the API and worker at `/run/secrets/open_payments_private_key` and sets
`PRIVATE_KEY_PATH_TEST_NET` inside those containers. Keep
`CLIENT_WALLET_ADDRESS_TEST_NET` and `KEY_ID_TEST_NET` configured in `.env`.
The key file is excluded from the Docker image. For example:

```dotenv
OPEN_PAYMENTS_PRIVATE_KEY_HOST_PATH=/absolute/path/to/private-key.key
```

Start the API, recovery worker, database, and Redis with Watch enabled:

```bash
pnpm localenv:dev
```

After changing the mount, recreate the API and worker containers. You can
check readability without printing the key:

```bash
pnpm localenv:compose up -d --force-recreate wallet-api payment-worker
pnpm localenv:compose exec wallet-api node -e 'try { const fs=require("node:fs"); fs.accessSync(process.env.PRIVATE_KEY_PATH_TEST_NET, fs.constants.R_OK); console.log("key readable") } catch { console.log("key missing or unreadable") }'
```

Keep this command running while editing. The API is available at
`http://localhost:9001`, with a health endpoint at `/health`.

Compose syncs changes under `src/`, to `tsconfig.json`, and to `.env`, then
restarts the API to load them. Initial sync updates files when Watch starts.
Changes to `package.json`, `pnpm-lock.yaml`, or `Dockerfile.dev` rebuild the API
image. The startup command also builds the image to include changes made while
Watch was stopped.

The API briefly disconnects during a restart; wait for the new server startup
message before retrying a request. `tsx watch` remains active inside the container
to support recovery after source errors, while Compose explicitly triggers the
restart after syncing. Plain `up -d` does not enable Watch.

After editing Compose configuration (including port mappings), stop this command
and run it again so Compose applies the new configuration. Changing a database
schema still requires the appropriate migration.

## Grant storage and encryption

Pending onboarding and transfer interactions are encrypted in Redis. PostgreSQL
stores verified wallet ownership, transfer facts, and the encrypted scoped
tokens needed while a transfer is unresolved. Onboarding does not retain a
spending token. Development can set `GRANT_ENCRYPTION_KEY` to 64 hexadecimal
characters generated with:

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

Production requires `ENCRYPTION_KEYRING_FILE` pointing to a mounted JSON file:

```json
{
  "activeKeyId": "k1",
  "keys": { "k1": "64 hexadecimal characters" }
}
```

Give the API and worker the same keyring. To rotate, add `k2`, make it active,
deploy both processes, run `pnpm keys:reencrypt`, then run
`pnpm keys:reencrypt --check-retirement k1` before removing `k1`. Never remove a
key while encrypted records still reference it. Set
`OPEN_PAYMENTS_ALLOWED_ORIGINS` to the exact HTTPS wallet and authorization
origins your deployment trusts. Also restrict provider egress at the network
layer.

The baseline Knex migration creates the schema for a fresh database. Run
`pnpm db:migrate` before starting the API and worker. The SQL files under
`src/database/migrations/` are historical and are not part of the fresh-install
migration path.

Create grants through authenticated onboarding (`/api/v1/onboarding/start`,
then `/:sessionId/consent`). The legacy `POST /api/v1/wallet/request/grant`
and `GET /api/v1/wallet/finalize/grant` routes are disabled. Wallet verification
and the onboarding callback remain public.

## Linked wallets

Call `GET /api/v1/wallet` with `Authorization: Bearer <access-token>` to list
the signed-in user's wallets that have completed consent. Pending wallet links
are excluded. The response uses `{ "success": true, "data": { "wallets": [] } }`,
with an empty array when the user has no linked wallets.

Each wallet includes `id`, `walletAddressUrl`, `publicName`, `assetCode`,
`assetScale`, `status`, `isDefault`, `verifiedAt`, `createdAt`, and `updatedAt`.
Default wallets appear first, followed by newest-created wallets. Previously
linked wallets remain visible with their stored status. The provider ownership
proof is not a reusable spending grant. Credentials are never included, and responses disable caching. Ownership
comes exclusively from the bearer token, using the same authentication as
onboarding.

## P2P transfers with Open Payments

The P2P API follows the [fixed-debit remittance flow](https://openpayments.dev/guides/onetime-remittance-fixed-debit/):
create a recipient incoming payment, create a sender quote, request approval for
that amount and recipient, verify the callback, then submit an outgoing payment.
Each transfer requires its own authorization. Onboarding grants are not reused
for spending, and provider payments do not change the internal rewards ledger.

Use `API_PUBLIC_URL`, the configured encryption keyring, Redis, and Open Payments
client settings (`CLIENT_WALLET_ADDRESS_TEST_NET`, `PRIVATE_KEY_PATH_TEST_NET`,
`KEY_ID_TEST_NET`). The API public origin must be reachable by the sender's browser.
Both users need active accounts and active linked wallets with completed consent.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/v1/transfers` | Prepare a transfer and return its authorization URL |
| GET | `/api/v1/transfers/callback` | Public provider callback, verified using the GNAP hash |
| GET | `/api/v1/transfers/:id` | Read and refresh a transfer's provider status |
| GET | `/api/v1/transfers?limit=20&offset=0` | Read persisted sent and received history |

All endpoints except the callback require `Authorization: Bearer <access-token>`.
Only the sender and recipient can read a transfer; only the sender receives its
authorization URL. History is ordered newest first and supports limits from
1–100, with a `pagination.hasMore` flag. History is a stored snapshot; use the
individual status endpoint to refresh a payment.

Start a transfer with a unique `Idempotency-Key` header (a UUID is recommended):

```http
POST /api/v1/transfers
Authorization: Bearer <access-token>
Idempotency-Key: 11841f52-7ca4-4ac4-b51c-1c3dcf87a89b
Content-Type: application/json

{
  "recipientUserId": "<recipient-user-uuid>",
  "senderWalletId": "<your-linked-wallet-uuid>",
  "amount": "2500",
  "description": "Lunch"
}
```

`senderWalletId` and `description` are optional. The sender comes from the access
token; the recipient comes from `recipientUserId`. Wallet URLs are resolved on
the server. Without an explicit sender wallet, and for the recipient, selection
prefers the default verified active wallet, then the newest verified active
wallet. Transfers to yourself or the same wallet address are rejected.

`amount` is a positive integer **string in the sender wallet's minor units**,
up to the Open Payments unsigned 64-bit limit. With asset scale 2, `"2500"`
means 25.00. Currency and scale come from the wallet. `receiveAmount` in the
response comes from the provider's quote and can use a different currency.

Responses use `{ "success": true, "data": { ... } }`. Creation returns 201 with
`transferId`, `status: "AWAITING_AUTHORIZATION"`, `authorizationUrl`,
`debitAmount`, `receiveAmount`, and `expiresAt`. Open `authorizationUrl` in the
system browser. The provider returns to
`API_PUBLIC_URL/api/v1/transfers/callback?transfer_id=...` with its proof. The
callback displays an API completion page; the client should poll the authenticated
status endpoint. A 202 callback with `Retry-After` means authorization is still
processing; refresh that callback after the indicated delay. Landing on the
callback page is not proof of a successful transfer.

Retry the same creation request with the **same key** after a network failure.
An identical retry returns the existing transfer with 200; a different payload
using that sender's key returns 409. Keys remain reserved, including for failed
or expired transfers. Preparation errors after reservation include
`error.details.transferId`. Do not use a new key to retry an uncertain payment.

Transfers progress through `CREATING`, `AWAITING_AUTHORIZATION`, `FINALIZING`,
`AUTHORIZED`, `SUBMITTING`, and `PENDING`, then `COMPLETED` or `FAILED`.
Authorization sessions expire after at most 15 minutes, shortened to the quote
or incoming-payment expiry. The worker expires unused sessions and marks
interrupted preparation or authorization as failed. An interrupted outgoing
submission becomes `UNKNOWN`.

`UNKNOWN` means the provider may have accepted the instruction. Status reads
and the worker attempt to find the existing payment by its URL or by its quote
and transfer metadata; they never resubmit it. If it cannot be found, provider
reconciliation is required before starting another payment. PostgreSQL state
transitions prevent concurrent callbacks from sending twice. Run one or more
`pnpm worker` processes in production; PostgreSQL leases divide the work.

An outgoing resource being created does not itself mean delivery is complete.
The API marks completion when an authenticated read of the recipient incoming
payment shows the quoted receive amount delivered. `sentAmount` alone is not
completion evidence because fees can make it differ from the debit. If receipt
cannot be confirmed, status stays `PENDING`. Failed payments retain
`sentAmount`, which may be nonzero. Provider status-read failures return the
last known state with `statusRefreshAvailable: false`; expired status tokens
are rotated when possible. An unrecoverable token leaves the payment unresolved
for provider reconciliation.

Continuation credentials and callback nonces are encrypted in Redis under
`payment:session:<transferId>`. Finalized outgoing tokens are encrypted in
PostgreSQL for polling and reconciliation, then revoked and removed on terminal
payment results. The scoped incoming token is retained until delivery is
confirmed so the API can read and close the incoming payment. API responses
never contain these credentials. Exclude callback query strings from proxy logs.

## Onboarding for API, web, and mobile clients

Set `API_PUBLIC_URL` to the origin that the user's browser can reach:

```dotenv
API_PUBLIC_URL=http://localhost:9001
ONBOARDING_WEB_RETURN_URL=
ONBOARDING_MOBILE_RETURN_URL=
```

This is separate from the container's listening port and the legacy `HOST`
setting. Production requires a public HTTPS origin. A physical phone cannot
reach your Mac through `localhost`; use your public HTTPS tunnel/API origin.
Restart the API after changing configuration.

With no client configured, onboarding works now and ends on an API-hosted
completion page. `FRONTEND_URL` is optional and no longer controls onboarding.
Start a fresh session after deploying this change: older sessions do not have
the nonce and destination information needed to verify callbacks.

1. Authenticate with the API and keep the access token in the client.
2. `POST /api/v1/onboarding/start` with `Authorization: Bearer <access-token>`:

   ```json
   { "walletAddressUrl": "https://wallet.example/alice", "clientId": "api" }
   ```

   `clientId` defaults to `api`; the response's `data` contains `sessionId`,
   `status`, `clientId`, and `expiresAt`. Save `sessionId` in the client.
3. `POST /api/v1/onboarding/:sessionId/consent` with the same bearer token.
   Open `data.redirectUrl` in the browser for wallet authorization. Native
   clients should use the system browser/authentication session, not an
   embedded WebView.
4. The provider returns the browser to
   `API_PUBLIC_URL/api/v1/onboarding/callback`. The backend validates the hash
   against the session's fresh client nonce, provider nonce, interaction
   reference, and original grant request URI before continuing the grant.
5. Check `GET /api/v1/onboarding/:sessionId/status` with the bearer token.
   Only the session owner can read it. Treat `data.status === "COMPLETED"`
   as completion; landing on a return page alone is not proof of success.

For web and mobile clients, register exact destinations on the server when
those clients are ready:

```dotenv
ONBOARDING_WEB_RETURN_URL=https://app.example.com/onboarding/return
ONBOARDING_MOBILE_RETURN_URL=https://links.example.com/onboarding/return
```

Then start with `clientId: "web"` or `clientId: "mobile"`. An unconfigured
client receives 400. Start requests cannot supply arbitrary return URLs, and
callback parameters cannot change the destination. The destination is saved
with the session; removing/changing it in server configuration makes existing
sessions fall back to the API page. Local HTTP is allowed only for API/web
development URLs on loopback hosts.

Successful callbacks redirect to the saved destination with **only**
`?session_id=...`. No access tokens, continuation credentials, or interaction
proofs are forwarded. The returning client should match this ID to its saved
session and fetch authenticated status. Mobile clients must configure their
HTTPS domain as an iOS Universal Link / Android App Link, including the domain
association files and app configuration. Provide a web fallback at that URL
for users without the app. These native/domain steps happen in the client
projects; this API does not serve those association files.

Sessions move through `WALLET_RESOLVED`, `CONSENT_REQUESTING`, `CONSENT_PENDING`,
`FINALIZING`, and `COMPLETED`, or `FAILED`. Poll while work is in progress and
stop at a terminal result or `expiresAt`. The existing `SESSION_TTL_MS`
environment setting is measured in **minutes**, despite its name (default 15).
An expired session can return 410, or 404 after Redis removes it. Start a new
flow after expiry or failure.

Concurrent callbacks cannot continue the same grant twice. An identical valid
retry returns the completed/in-progress result; a competing state transition
may return 409, so check authenticated status. API-only callbacks return 202
while finalizing and 200 once complete. Invalid callbacks show a generic API
error page and never redirect. If PostgreSQL committed the final grant but
Redis completion failed, callback/status retries recover the durable result.
An interrupted provider call with no committed result is not automatically
replayed; an unresolved session expires and can then be restarted.

Onboarding responses disable caching and referrer forwarding. The HTTP
request logger omits query strings; configure reverse-proxy/access logs to avoid
recording callback query strings too. Configure `CORS_ORIGIN` for your web
client separately; a registered return destination does not grant CORS access.
