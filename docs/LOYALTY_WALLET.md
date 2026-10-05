# Loyalty wallet backend

## Scope and architecture

The Android application is maintained separately (see [Android development](ANDROID_DEVELOPMENT.md)). This change implements the backend and [mobile integration handoff](LOYALTY_MOBILE_HANDOFF.md). Android screens, camera integration, barcode generation, secure offline storage, and Compose tests are mobile deliverables, not implemented in this repository.

The existing architecture is Express 5 REST under `/api/v1`, TypeScript ESM, PostgreSQL via Knex, JWT authentication with an active-user lookup, Redis rate limits, and constructor-based dependency injection in `src/app.ts`. Existing payment, onboarding, recipient, and wallet navigation/API modules are retained. There is no Android navigation, DI, networking or design-system source in this workspace.

The existing encrypted loyalty vault (`loyalty.service.ts`, `loyalty-image.service.ts`, `loyalty.routes.ts`) is extended with a catalogue service, validation module, template schemas and operator publication service. It reuses the existing authentication, response envelope, application errors, image sanitization, encryption keyring and HMAC duplicate index. No new package dependencies are required.

```text
loyalty_programs (metadata, capabilities, verification, current version)
         |                         |
         v                         v
loyalty_card_templates      encrypted loyalty_cards owned by user
         |                         |
         +------ checkout gate ----+
                         |
               generic mobile renderer
```

## Database and deployment

Run `pnpm db:migrate` against the intended deployment database before deploying the new API. Migration `202610050003_loyalty_wallet.cjs` adds:

- `loyalty_programs.configuration` JSONB: validated metadata, number rules, capabilities, verification and rollout state. JSONB intentionally keeps related configuration together rather than introducing redundant one-to-one tables.
- `loyalty_programs.current_template_version`, `updated_at`.
- `loyalty_card_templates`: `(program_id, version)` primary key, layout JSONB, enabled flag and creation time.
- `loyalty_cards.template_version`: nullable composite foreign key to the program's template.

The existing encrypted fields, user foreign key, user/created-time index and transactionally unique duplicate fingerprints remain intact. Existing cards are unpinned (`NULL`); checkout resolves current artwork. New cards pin the current version. Changing program repins to that program's current artwork. Ordinary edits never repin. Membership data is never rewritten for a visual update. A disabled pinned template causes checkout to fail; it does not silently switch artwork. Existing customers remain able to read or delete their stored records when a program is disabled.

Fresh installations use matching definitions in `schema.sql`; the migration recognizes that baseline. Rollback is intentionally blocked because it would discard configuration and template records. Roll back application code only after assessing compatibility or use a reviewed forward migration. Back up before deployment. This task does not migrate the live application database.

## Initial catalogue and verification

Seven entries are seeded, including Other. All start `CATALOGUE_ONLY`, `UNKNOWN` barcode format, false verification flags, neutral artwork, and **no generated digital checkout**. A user's observed barcode is stored separately from the membership number; observation does not establish official support, permission or ownership.

Official programme references reviewed on 2026-10-05:

- [Shoprite / Checkers](https://www.checkers.co.za/): Xtra Savings catalogue reference.
- [Pick n Pay Smart Shopper](https://smartshopper.pnp.co.za/): catalogue reference.
- [Clicks ClubCard](https://clicks.co.za/clubcard): catalogue reference.
- [Dis-Chem Better Rewards](https://www.dischem.co.za/better-rewards): catalogue reference; use the current programme name rather than assuming the old Benefit programme.
- [SPAR](https://www.spar.co.za/): catalogue reference.
- [Shell V+](https://www.shell.co.za/motorists/loyalty-payment/vplus-rewards.html): catalogue reference.

These sources confirm catalogue references, not static barcode formats, number rules or permission to reproduce cards. No logos or protected card artwork are copied. No specific reward rates are promised. The initial 5–10 verified-program rollout requires additional evidence and scanner trials; it is not represented as complete.

Only `DIGITAL_CARD_VERIFIED` can produce `digitalCardSupported: true`. The gate additionally requires active status, static and digital capabilities, known format, all four verification flags, timestamp, evidence URLs for barcode/number/reproduction/template, and an enabled current template. `DIGITAL_CARD_BETA` remains unavailable for confident checkout. Validation also checks the stored format, payload and pinned artwork at checkout.

## Adding a programme / publishing artwork

There are no public admin routes. An operator with database credentials runs the CLI; customer JWTs cannot publish configuration. Restrict that database credential and keep publication artifacts/evidence in your reviewed operations repository. An HTTP admin console, upload service, audit trail and retailer approval process remain future work.

1. Copy `docs/loyalty/program.example.json`. Choose a stable lowercase slug (also its ID), program name, retailer, category and optional official rewards information. Categories are extensible in the schema and already cover grocery, pharmacy, beauty, fashion, fuel, convenience, home improvement, furniture, general retail, department stores and other.
2. Keep catalogue-only until evidence establishes exact symbology, number format, static reproduction permission, approved artwork and real checkout scanability. Store evidence URLs and `verifiedAt`; flags are operator attestations, not an automatic external verification service.
3. Supply rules only when established. Length checks use the exact trimmed membership string, preserving leading zeroes. The regex language is limited to an anchored character class and bounded quantifier (e.g. `^[0-9]{8,12}$`); arbitrary regular expressions are rejected to prevent ReDoS. No payload derivation is supported; require a scan or explicitly entered encoded payload.
4. Use the neutral layout or upload approved/licensed assets to your CDN using existing operational tools. Set `LOYALTY_ASSET_HOSTS` to permitted exact CDN hosts (including port if present). URLs must be HTTPS, without credentials. The CLI does not download assets. Use immutable asset URLs, supported raster formats, and maintain licensing/provenance separately. Review CDN content and redirects before publishing.
5. Publish a complete configuration and optional **new** template version:

```sh
pnpm exec tsx scripts/loyalty-admin.ts publish docs/loyalty/program.example.json
```

Templates must have strictly increasing positive versions. Published layout JSON is immutable through the publication service; metadata-only publication retains the current version. Publication is atomic and serialized per programme using a PostgreSQL transaction advisory lock. To fix artwork, publish a new version. Existing pinned cards keep their old version. Disable a broken version:

```sh
pnpm exec tsx scripts/loyalty-admin.ts disable-template sample-retailer 1
```

To disable all checkout for a programme, publish the configuration with `TEMPORARILY_DISABLED` (or `active: false`). If the current template is disabled, the catalogue support flag becomes false. Older pinned versions are checked individually. Do not delete referenced templates. No app release is needed for a new compatible program/template; new symbologies or renderer schema changes may require a mobile update.

## Security and compatibility

Card CRUD and image endpoints keep their paths and fields. Lists, create/update responses and single-card metadata stay masked; complete fields are available only in authenticated private presentation/checkout responses. Presentation remains for backwards compatibility and now explicitly returns `canGenerateBarcode: false`; new clients must use `/checkout` for rendering authorization. Previously deployed clients must adopt this gate before enabling generated checkout. A server cannot prevent an old client from rendering private values it already possesses.

Cards are always selected/modified with the JWT user's ID; caller-supplied user IDs are not accepted. All card routes, including preview, require authentication, set `Cache-Control: no-store`, and use a per-user Redis budget of 120 requests/minute, failing closed if Redis is unavailable. Response envelopes are unchanged. HTTPS is the deployment ingress responsibility; retain the existing production TLS/proxy configuration.

Membership numbers, barcode payloads, images and detected values use the existing context-bound cipher and keyring; duplicate identifiers are keyed HMACs, not plaintext or bare hashes. Log serializers omit bodies and queries; the structured logger also redacts common loyalty fields. Never log request/response bodies through reverse proxies, crash reporters or client interceptors. Nicknames/custom names are user input: render as plain text. No new analytics, push payloads or usage collection is introduced.

Key management limitation inherited from the vault: `keys:reencrypt` handles payment credentials, not loyalty ciphertext/fingerprints. Retain every key used by loyalty rows and duplicate fingerprints; do not retire a key until a dedicated loyalty re-encryption/reindex procedure has been implemented and tested. This change does not alter working payment-key maintenance.

Offline checkout bundles have a 24-hour validity ceiling. Revocation cannot reach an offline device immediately; the mobile client must obey expiry, clear disabled bundles on sync, and fail closed when uncertain. Do not cache dynamic-token programmes as static cards.

## Validation

```sh
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.loyalty-unit.config.cjs --runInBand
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.loyalty.config.cjs --runInBand
pnpm typecheck
pnpm build
```

The database suite uses Testcontainers by default. With Docker unavailable, set `TEST_DATABASE_URL` to a new, empty database named `loyalty_test_*`; setup refuses other names and populated databases. It initializes only that isolated database. Run these suites serially with other Testcontainers suites because the established database helper shares a temporary connection file.

Tests cover rules, EAN checksums, masking, template boundaries, verification gates, private HTTP contracts, rate limiting, authorization, encrypted storage, exact independent barcode payloads, previews without persistence, duplicate races, immutable versions, template/program disabling, and migration of populated legacy tables. Existing image tests use generated synthetic QR payloads, including decode detection. The mobile handoff specifies device barcode round-trip, lifecycle, offline and Compose acceptance tests still to be implemented in the Android repository.

### Implementation verification record

On 2026-10-05: production typecheck and build passed; 20 loyalty tests passed (8 unit/HTTP security, 12 PostgreSQL/vault/API integration); 95 existing regression tests passed (43 onboarding, 26 recipient, 26 payment/status/cancellation/mobile-configuration). PostgreSQL tests used a temporary local cluster because Docker was unavailable. Migration testing covered both the fresh SQL baseline and populated legacy vault upgrade. No application database migration or deployment was performed.
