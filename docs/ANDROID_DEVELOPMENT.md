# Android wallet linking

The API listens on `PORT`, but the wallet provider redirects the Android browser
to `API_PUBLIC_URL`. That URL must reach the backend from the emulator or phone.
The Android API base URL is an origin without `/api/v1`; the IjubaPay client adds
the endpoint paths itself. Android code is maintained separately.

## Current emulator setup

The native backend uses port 9000. The existing IjubaPay development bridge
forwards `127.0.0.1:9002` to `[::1]:9000`, and the app uses
`http://127.0.0.1:9002`. Keep that bridge running. The host's IPv4 port 9000 is
also used by another service, so target the bridge when forwarding emulator
requests. Set the backend `.env` to:

```dotenv
API_PUBLIC_URL=http://localhost:9002
ONBOARDING_MOBILE_RETURN_URL=
```

Expose the bridge on the emulator and support older callbacks on port 9001:

```sh
adb -s emulator-5554 reverse tcp:9002 tcp:9002
adb -s emulator-5554 reverse tcp:9001 tcp:9002
```

Restart `pnpm dev` after changing `.env`. The public URL uses 9002 while the
server continues listening on 9000. These ADB mappings do not require ngrok and
must be recreated after the emulator or ADB server restarts. With the Docker
development stack instead, the API is published on host port 9001: use
`API_PUBLIC_URL=http://localhost:9001` and `adb reverse tcp:9001 tcp:9001`.

## Tunnel option

For a device without ADB forwarding, use your ngrok HTTPS origin. For the current
native setup, tunnel the existing bridge with `ngrok http 9002`. For the Docker
stack, use `ngrok http 9001`. Then, from `backend/`:

```sh
pnpm mobile:configure https://YOUR-DOMAIN.ngrok-free.app
```

This updates only `API_PUBLIC_URL` in `.env`. Restart `pnpm dev`, or recreate the
Docker API with `pnpm localenv:compose up -d --no-deps --force-recreate wallet-api`.
Docker container environment variables require recreation; restarting alone
does not reload them. Set the Android API base URL to the same HTTPS origin.
The current Android project accepts `-PapiBaseUrl=https://YOUR-DOMAIN.ngrok-free.app`.
Keep ngrok running during authorization.

The [ngrok free plan](https://ngrok.com/docs/pricing-limits/free-plan-limits)
supports HTTPS. Its browser warning can appear on the first visit: choose Visit
Site to continue. API requests can send `ngrok-skip-browser-warning: 1`; the
backend cannot suppress a warning shown before traffic reaches it. The existing
`pnpm tunnel:start` command manages local wallet-provider services and is not the
API tunnel described here.

## Client contract

1. With the app's bearer token, POST `/api/v1/onboarding/start` with
   `{ "walletAddressUrl": "https://your-wallet-address", "clientId": "api" }`.
   `mobile` is also supported without an App Link return URL. Persist `sessionId`
   and use one `Idempotency-Key` per linking attempt.
2. POST `/api/v1/onboarding/:sessionId/consent` with that bearer token, then open
   `data.redirectUrl` in the system browser.
3. Approval redirects to the backend callback. It validates the provider proof
   and persists wallet ownership. If the provider needs more time, the browser
   displays a processing page and retries automatically.
4. When the browser says the wallet is connected, return to the app. On resume,
   GET `/api/v1/onboarding/:sessionId/status` with the bearer token. Poll while
   pending, bounded by `expiresAt`. On `COMPLETED`, refresh GET `/api/v1/wallet`.
   A browser navigation alone is not evidence of a successful link.
5. To abandon a pending attempt, DELETE `/api/v1/onboarding/:sessionId` with the
   owner's bearer token. It returns 204, clears its interaction proof, and frees
   the user's active slot. It cannot cancel an authorization being finalized or
   remove an already linked wallet; those return 409. Cancellation is recorded
   as `FAILED` without introducing a new status for existing clients.

A pending grant retains the callback URL originally sent to the provider. After
changing public origins, cancel the previous pending session and start a new
attempt with a new idempotency key, or wait for expiry. The port 9001 forwarding
above makes older local callback URLs reachable while the emulator is running.

An automatic return directly into Android requires a configured HTTPS Android
App Link and app/domain association. Without that setup, the backend shows a
completion page and the app resumes with its saved session. See the
[Android App Links documentation](https://developer.android.com/training/app-links)
and [ADB reverse documentation](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server).
