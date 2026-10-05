# Digital Wallet Backend

[![Backend CI](https://github.com/Ijuba-Labs/digital-wallet-backend/actions/workflows/backend.yml/badge.svg)](https://github.com/Ijuba-Labs/digital-wallet-backend/actions/workflows/backend.yml)
[![Coverage Status](https://coveralls.io/repos/github/n-sipho/digital-wallet-backend/badge.svg?branch=main)](https://coveralls.io/github/n-sipho/digital-wallet-backend?branch=main)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Source secret scan](https://github.com/Ijuba-Labs/digital-wallet-backend/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/Ijuba-Labs/digital-wallet-backend/actions/workflows/secret-scan.yml)

An open source backend for digital wallets, built with TypeScript and Express. It provides account registration and login, wallet linking, and peer-to-peer transfers through Open Payments.

## Quick start

You will need Node.js 24, pnpm 9.15.4, Docker with Docker Compose Watch support, and an Open Payments test wallet with a registered signing key. Bruno or Postman can be used to try the API.

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/Ijuba-Labs/digital-wallet-backend.git
   cd digital-wallet-backend
   pnpm install:local
   cp .env.example .env
   ```

2. Edit `.env`. Set `CLIENT_WALLET_ADDRESS_TEST_NET`, `KEY_ID_TEST_NET`, and `OPEN_PAYMENTS_PRIVATE_KEY_HOST_PATH` to your test wallet, registered key ID, and the absolute path of its private key. Generate a separate value for each of `JWT_SECRET` and `GRANT_ENCRYPTION_KEY` with:

   ```bash
   node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
   ```

   The remaining defaults are ready for local Docker development. Keep private keys in the ignored `secrets/` directory.

3. Start the backend:

   ```bash
   pnpm localenv:dev
   ```

   This starts the API, payment worker, PostgreSQL, and Redis, applies database migrations, and reloads source changes. Keep the command running. The API is available at **http://localhost:9001**.

4. Check that the API is running:

   ```bash
   curl http://localhost:9001/health
   ```

Stop services with `pnpm localenv:compose down`. For setup without Docker and configuration details, see the [developer guide](docs/DEVELOPER_GUIDE.md).

## Try the API with Bruno or Postman

Create a collection with a `baseUrl` environment variable set to `http://localhost:9001`. Send JSON requests with `Content-Type: application/json`.

1. Register a local test account using `POST {{baseUrl}}/api/v1/auth/register`:

   ```json
   {
     "first_name": "Alice",
     "last_name": "Tester",
     "email": "alice@example.com",
     "password": "local-test-password",
     "phone_number": "0712345678"
   }
   ```

2. Save the response's `data.accessToken` as an `accessToken` environment variable. To log in again, send `POST {{baseUrl}}/api/v1/auth/login`:

   ```json
   {
     "email": "alice@example.com",
     "password": "local-test-password"
   }
   ```

3. Use Bearer authentication with `{{accessToken}}` for protected requests:

   | Method | Path | What to try |
   | --- | --- | --- |
   | GET | `/health` | Check the API; no authentication needed |
   | GET | `/api/v1/wallet` | List your linked wallets; initially empty |
   | POST | `/api/v1/onboarding/start` | Start linking a test wallet |
   | GET | `/api/v1/transfers` | View your transfer history |
   | GET | `/api/v1/recipients/search?q=Sipho` | Find a recipient by name or complete email/phone |

To try wallet linking, send `{"walletAddressUrl":"https://your-provider.example/alice","clientId":"api"}` to the onboarding endpoint, using your actual test wallet URL. Save `data.sessionId`, then send `POST /api/v1/onboarding/:sessionId/consent` with your bearer token. Open `data.redirectUrl` in a browser and check `GET /api/v1/onboarding/:sessionId/status` afterward.

See the developer guide for the full [onboarding flow](docs/DEVELOPER_GUIDE.md#onboarding-for-api-web-and-mobile-clients) and [transfer examples](docs/DEVELOPER_GUIDE.md#p2p-transfers-with-open-payments). Transfers require two registered users with linked wallets.

## Run tests

Install dependencies and keep Docker running. Jest uses Testcontainers to create a temporary PostgreSQL database and supplies its own test environment values.

```bash
pnpm test
pnpm test:coverage
```

Coverage reports are written to `coverage/`. To check TypeScript and build the backend:

```bash
pnpm typecheck
pnpm build
```

<!-- ## Contributing

See the [developer guide](docs/DEVELOPER_GUIDE.md) for architecture, infrastructure configuration, migrations, encryption, and payment integration details. Run the tests and build checks before submitting a pull request.

## License

Released under the [MIT License](LICENSE). You may use, modify, and distribute this backend free of charge, including commercially. Include the copyright and license notice in copies or substantial portions of the backend.

For project credits, you can use: “Uses Digital Wallet Backend by [n-sipho](https://github.com/n-sipho/digital-wallet-backend).” Public credit is appreciated; the MIT requirement is to retain the copyright and license notice. -->


## Private checkout identity delegation

The private checkout service is deployed independently and is not a dependency of this public backend. Shared MIT-licensed payment utilities live in `packages/open-payments-primitives`. `GET /api/v1/identity` returns the authenticated customer ID; `GET /internal/users/:id/wallets` requires a separate `CHECKOUT_IDENTITY_SERVICE_KEY` of at least 32 characters and exposes only verified linked wallets for an active customer. Configure that key in both services without sharing JWT secrets or database credentials. Public installs and CI require no private-repository token.

The shared utilities are published as [`@ijuba-labs/payment-primitives`](https://github.com/Ijuba-Labs/digital-wallet-backend/pkgs/npm/payment-primitives). Use `pnpm install:local` while developing: it builds and links the folder using an ignored development lockfile. Production and CI use the pinned registry version in the committed manifest and lockfile. See [package installation and releases](docs/PAYMENT_PACKAGE.md).

For the combined wallet API and merchant checkout development stack, check out `open-rewards-core` as a sibling and run its `./scripts/dev-up.sh`. See `../open-rewards-core/docs/docker-development.md` for isolated Docker services, test users, browser linking and Bruno.

For Android wallet linking, local emulator forwarding, and ngrok setup, see
[Android development](docs/ANDROID_DEVELOPMENT.md).

# Loyalty card vault

See [docs/LOYALTY_CARDS.md](docs/LOYALTY_CARDS.md) for the API contract and local OCR asset requirements.

## Digital loyalty wallet

See [backend architecture and adding programs](docs/LOYALTY_WALLET.md) and the [Android integration handoff](docs/LOYALTY_MOBILE_HANDOFF.md). Run `pnpm db:migrate` before deploying this API. Real programs remain catalogue-only until verified; customer card storage remains available.
