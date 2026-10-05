# Android loyalty wallet integration handoff

Backend implementation date: 2026-10-05. Owner of remaining implementation: Android developer. Android source is not in this repository. Reuse the application's existing networking, DI, navigation, Compose design system and authenticated session rather than creating replacements. Backend architecture, migration and operator instructions: [LOYALTY_WALLET.md](LOYALTY_WALLET.md).

## Release scope

Backend catalogue, configuration validation, encrypted CRUD, masked wallet responses, authenticated checkout gating, template versioning and operator CLI are implemented. The mobile developer must implement wallet, add/select/manual/scan/preview/detail/checkout screens, one generic renderer, barcode generation, secure offline caching and mobile tests.

The real catalogue intentionally has **zero verified checkout programs**. Users can store membership information and observed barcode data. Display “Membership storage only” for catalogue-only entries. Do not present a generated barcode as ready to scan until documented program verification and physical scanner acceptance tests are complete. Retailer-owned apps may support digital cards without authorizing this application's reproduction.

## REST contract

Base URL follows the existing app configuration; paths below include `/api/v1`. Dates serialize as ISO-8601. Do not log bodies, card values, image bytes or auth headers. Additive unknown response fields must be ignored for forward compatibility. Unknown enum values fail closed for checkout.

Successful JSON: `{ "success": true, "data": ... }`. Failure: `{ "success": false, "error": { "message": "...", "statusCode": 422, "details": ... } }`. Delete returns empty 204. All card routes require `Authorization: Bearer <app JWT>`, return `Cache-Control: no-store`, and share 120 requests/minute per user. There is no caller-supplied user ID. The backend derives ownership from the token. The public catalogue does not require authentication.

| Method and path | Request / result |
| --- | --- |
| GET `/api/v1/loyalty-programs` | Array of active program objects; optional `q`, `retailer`, `category`, `rewardType`, `digitalCardSupported=true\|false`. No pagination currently. |
| GET `/api/v1/loyalty-programs/{programId}` | Program, including verification and current support indicator; can include an inactive programme referenced by an existing card. |
| GET `/api/v1/loyalty-programs/{programId}/template` | Current enabled template; optional positive integer `version` fetches a specific enabled version. |
| POST `/api/v1/loyalty-cards/preview` | JSON CardInput, same shape as create. Validates without saving and returns program, template, masked numbers, `canGenerateBarcode`, effective `barcodeFormat`. Does not echo private inputs. Image-only preview is not supported. |
| GET `/api/v1/loyalty-cards` | Masked CardSummary array, newest first. |
| POST `/api/v1/loyalty-cards` | JSON CardInput, or multipart `card` JSON plus optional `image` PNG/JPEG; returns masked CardSummary, 201. |
| GET `/api/v1/loyalty-cards/{id}` | Masked CardSummary. |
| PATCH `/api/v1/loyalty-cards/{id}` | Partial CardInput; returns masked CardSummary. `null` clears nullable fields; at least one number, barcode or existing image must remain. |
| DELETE `/api/v1/loyalty-cards/{id}` | Deletes card/image/duplicate fingerprints, 204. |
| GET `/api/v1/loyalty-cards/{id}/checkout` | Verified static checkout bundle with full private values, program and pinned/current template; fails if unsafe or unavailable. |
| GET `/api/v1/loyalty-cards/{id}/presentation` | Legacy/private details: summary plus full membershipNumber, barcodePayload, imageUrl, `digitalCardSupported`, `canGenerateBarcode: false`. **Not authorization to render a barcode.** |
| GET `/api/v1/loyalty-cards/{id}/image` | Authenticated JPEG bytes, not a public URL. |
| PUT `/api/v1/loyalty-cards/{id}/image` | Multipart `image`; validates/sanitizes/replaces image. |

Server responses and create/update metadata never contain `userId`. Cache records must nevertheless be scoped to the authenticated account on-device.

### Program fields

`id` and `slug` are the same stable slug. `name`, `retailerName`, `category`, `requiresCustomName`, `active`, `barcodeFormat`, `capabilities`, `verification`, `status`, `currentTemplateVersion: Int?`, `digitalCardSupported: Boolean` are present. Optional: `description`, `logoUrl`, `cardNumberRules`, `rewardType`, `rewards`, `officialUrl`.

`capabilities` has `digitalCard`, `staticBarcode`, `manualEntry`, `barcodeScanning`, `rewardsInformation`. These are configured capabilities; **the effective support flag is `digitalCardSupported`**. Verification has `barcodeFormatVerified`, `numberFormatVerified`, `digitalReproductionAllowed`, `templateVerified`; optional `barcodeSource`, `numberSource`, `permissionSource`, `templateSource`, `verifiedAt`. Catalogue statuses: `CATALOGUE_ONLY`, `DIGITAL_CARD_BETA`, `DIGITAL_CARD_VERIFIED`, `TEMPORARILY_DISABLED`.

Categories: `GROCERY`, `PHARMACY`, `HEALTH_AND_BEAUTY`, `FASHION`, `FUEL`, `CONVENIENCE`, `HOME_IMPROVEMENT`, `FURNITURE`, `GENERAL_RETAIL`, `DEPARTMENT_STORES`, `OTHER`. Map these to readable translated labels; combine groups such as pharmacy/beauty or home if desired, retaining exact API values for filters. Use text/icons alongside colour for support status.

`cardNumberRules` optionally has `minLength`, `maxLength`, `regex`. Rules apply to the exact trimmed membership string, not to the barcode payload. Do not remove leading zeroes or parse values as integers. Absence of verified rules means the backend only applies general storage validation, not proof that the number is issued or recognized by a retailer.

`rewards` has `explanation`, optional `earn`, `redeem`. Display supplied reviewed text and official link without extrapolating savings, account balances or redemption eligibility. No retailer balances or registration integration exists.

### CardInput and independent identifiers

Use existing API naming, not the proposed `cardNumber`/`barcodeValue` names:

```json
{
  "programId": "clicks-clubcard",
  "membershipNumber": "001122334455",
  "barcodePayload": "SYNTHETIC-PAYLOAD-001",
  "barcodeFormat": "CODE_128",
  "nickname": "My card"
}
```

This is synthetic data, not a verified Clicks payload. The example is accepted as storage only and cannot be used for generated checkout. `barcodePayload` and `barcodeFormat` must be supplied together, or both omitted. Membership number and payload **must remain separate**. Payload whitespace is preserved exactly; do not trim it. `programId` is required for create. `customProgramName` is required only for `other` and prohibited for all other programs. Nickname max 80 chars, custom name max 100, membership number 3–64 chars (letters/digits/space/hyphen, with at least one digit), stored payload max 256 chars, no control characters. Payload fields use strings; unsupported/unverified storage format values are never implicit permission for checkout.

Digital renderer formats: `CODE_128`, `EAN_13`, `EAN_8`, `QR_CODE`, `PDF_417`; program `UNKNOWN` means no generation. The existing vault also accepts observed `CODE_39`, `UPC_A`, `UPC_E`, `ITF`, `DATA_MATRIX`, `AZTEC`, `CODABAR` for storage compatibility. Do not map them to another symbology. A scan conflicting with a verified program format is rejected with 422. EAN requires exact digit count and valid checksum; CODE_128 checkout supports printable ASCII. Future payload protocols need explicit backend/library support.

No client `templateVersion`, userId, verification, or support flags may be sent in CardInput. The server selects the current version at save. The client must show the preview from the submitted data, then wait for explicit Save before POST. The preview endpoint does not reserve duplicates; handle 409 at save.

### CardSummary and checkout

CardSummary fields: `id`, `programId`, `programName`, `customProgramName: String?`, `nickname: String?`, `membershipNumberMasked: String?`, `barcodePayloadMasked: String?`, `barcodeFormat: String?`, `hasImage`, `imageDetection: String?` (`barcode` or `number`), `templateVersion: Int?`, `createdAt`, `updatedAt`.

Wallet tiles must show the returned mask; do not fetch checkout/details merely to populate wallet tiles. A compact real barcode on a wallet tile exposes the full payload even when its label is masked: use a neutral placeholder there, and generate the real barcode only in an explicitly opened verified preview/checkout view.

Checkout extends summary with `program`, `template`, `canGenerateBarcode: true`, `membershipNumber: String?`, `barcodePayload: String`, `effectiveTemplateVersion`, `checkedAt`, `offlineValidUntil`. `barcodeFormat` matches `program.barcodeFormat`. There is no checkout imageUrl because generated checkout uses the explicit verified payload. A stored image or detected number is never automatically turned into a payload.

New cards pin a template. Old cards with null version resolve current artwork. Cache by `(programId, effectiveTemplateVersion)`; do not substitute a different version if pinned artwork is disabled. Existing saved membership data does not change with artwork.

## Android implementation sequence

### 1. Models, networking and repository

Map DTOs explicitly into domain models; a separate full-private CheckoutCard prevents accidentally exposing secrets through a wallet summary. Use the existing Retrofit/Ktor configuration, authenticated session handling and DI. Wrap responses in the existing Result/error abstraction. Suggested repository operations: list/search programs, get program/template, list cards, validate preview, save/update/delete card, get private details, get verified checkout. Keep private models out of generated `toString` logs.

Use MVVM/StateFlow and coroutine cancellation. Debounce search; cancel stale requests. Catalogue-only information remains browseable offline from cache. Disable save until preview validation succeeds for the current input; invalidate preview on any edit. Never silently queue a save after its user confirmation expires.

### 2. Wallet and add flow

Add `My Cards` to the existing navigation. Wallet states: loading, empty (clear Add action), cards, recoverable network error. Bold app typography, thick borders, hard edges and offset shadows belong to app chrome. Card interiors use approved assets or neutral design. Use wallet summaries plus cached program/template metadata without generating real barcodes in the overview. Track `lastUsedAt` locally per account; do not send checkout behaviour to the backend or analytics.

Flow: Wallet → choose/search program → manual number or physical-card scan → explicit confirmation → validate/preview → explicit Save → wallet. Show “Membership storage only” where checkout is unsupported. Number-only saved cards are valid; do not invent a barcode payload from the number. Where the encoded payload is unknown, instruct the user to scan the physical barcode when checkout support becomes available.

Manual entry: validate configured rules for quick feedback, then use backend preview as the authoritative decision. If a separate payload entry is offered, label it clearly; membership-only entry cannot produce checkout. Support Other with its required custom name. Retain input after transient network failures without logging it. On 409 duplicate, offer to return to wallet; do not create another copy.

### 3. One generic renderer

Implement `DigitalLoyaltyCard(program, template, card, modifier)` with background, optional logo/artwork, programme text, barcode container, barcode bitmap and optional readable membership number. A rendering mode should distinguish masked wallet from confirmed preview and verified checkout. No program-specific Compose card classes.

Template object has `id`, `programId`, `version`, `aspectRatio`, `background`, optional `logo`, `barcode`, optional `attribution`. Background is `solid` with one hex colour, `gradient` with 2–4 colours, or `asset` with HTTPS assetUrl. `logo` has assetUrl, x, y, width **and height** (normalized, not pixels). Barcode has x/y/width/height, `backgroundColor: #FFFFFF`, `foregroundColor: #000000`, `showNumber`. Coordinates are fractions of the card bounds; both x+width and y+height must fit within 1. The server validates these constraints. Reserve barcode quiet zones within its white container.

Use `.fillMaxWidth().aspectRatio(template.aspectRatio)` (default physical-card ratio 85.60/53.98). For card width W and height H: left=xW, top=yH, width=widthW, height=heightH. Keep app border/shadow outside the card. Logo/asset failure falls back to neutral programme/retailer text; template/gate failure disables generation. Render text as plain text and allow reasonable typography scaling; never overlay a full number on barcode bars. Artwork does not confer checkout authorization.

Use ZXing or the application's reliable existing library with exact symbology mapping and format-specific encoding hints. Render off the main thread, use sufficient native resolution, retain library quiet zones, preserve aspect ratio, integer module sizing and a white background. QR/PDF417 require appropriate 2D dimensions; never force them into a stretched 1D rectangle. Fit the generated symbol inside its white region without cropping. If a payload cannot be encoded reliably at the target size, show an error and physical-card fallback. No textures/alpha/gradients in barcode regions. Do not decode or transmit downloaded logos as card data.

### 4. Camera scanning and checkout lifecycle

Use the app's existing camera permission pattern and an on-device barcode scanner. Restrict formats to supported observations; preserve raw text and mapped format separately from a visible membership number. A scan shows payload/format to the user for confirmation; it does not save automatically. Do not assume detected payload equals the human-readable membership number. For a verified format conflict, stop and let the user select the correct program/rescan. Unknown/unverified formats may be stored, with a clear no-checkout label.

Handle denied permission, permanently denied permission (settings action), no camera, unrecognized barcode, cancellation and library failure. Camera detection should not upload live frames. The existing image upload endpoint is optional legacy storage; it sanitizes and checks images but is not a scan/confirm protocol, and uploads may contain private artwork/identifiers.

On card tap, refresh `/checkout` when online. Generate only when the bundle is safe and its template is available. Checkout displays programme name, large black-on-white barcode, optional readable membership number and clear Back action. Put details/actions outside the symbol. Enable `FLAG_KEEP_SCREEN_ON` only while checkout is foregrounded. Temporarily set **window** `screenBrightness`, recording/restoring its previous value; never write global system brightness. Use lifecycle-aware cleanup for back, app background, process/activity recreation, disposal and exceptions. Hide barcode outside foreground. Consider `FLAG_SECURE` for private screens and protect recents previews. Restore previous window flags rather than disrupting another feature's settings.

### 5. Secure cache and offline policy

Reuse established secure local storage, or add an account-scoped encrypted store whose key is protected by Android Keystore. Cache catalogue metadata, referenced immutable templates, approved assets, masked summaries and explicitly acquired private checkout bundles. Never place private payloads or auth tokens in plaintext SharedPreferences, ordinary image caches, HTTP disk caches or backups. Clear drafts, private caches and usage metadata on logout/account switch; account A's cards must never appear for account B. Handle Keystore loss/invalidation by discarding private cache and re-authenticating.

Permit offline static checkout only for a previously fetched bundle where `canGenerateBarcode` is true, `program.digitalCardSupported` is true, rollout is verified, format and template match, required local resources exist, and current time is before `offlineValidUntil`. Use trusted server time plus elapsed realtime to resist clock rollback; after a reboot or ambiguous clock state, require refresh if expiry cannot be established. The 24-hour ceiling is a product/backend policy, not permanent permission. Display an honest offline indicator outside the barcode. If the backend returns disabled/unavailable or ownership/auth failure, invalidate the private bundle rather than falling back to it. Immediate revocation cannot be guaranteed on an offline phone.

Offline metadata browsing and membership-details storage are distinct from offline scannable checkout. Never claim dynamic-token support. Do not sync local checkout history. Initially keep writes online; offline save/update/delete queues need explicit UX, conflict handling and idempotency work and are outside the current API.

## Errors and accessible states

| Condition | Mobile handling |
| --- | --- |
| 400 / 415 | Correct malformed input/content type; show a simple input message. Do not expose raw developer errors. |
| 401 | Existing auth-expiry flow; hide private data and clear/invalidate bundles as session policy requires. |
| 403 | Account inaccessible; do not display cached checkout. |
| 404 | Card/program removed or wrong owner; return to wallet and refresh. |
| 409 duplicate on save | “This card is already in your wallet.” |
| 409 checkout/template/program unavailable | “Use your physical card or the retailer's app.” Disable barcode and invalidate cached bundle. |
| 422 membership/format/payload | “Check the number or scan your physical card again.” Keep editable draft. |
| 429 | Respect `Retry-After`; offer retry when elapsed. |
| 5xx / no network | Retry action; preserve draft. Use only an eligible unexpired offline checkout bundle. |

Use meaningful loading, empty and error content for every screen. TalkBack should announce programme name, support label and checkout readiness. Do not read complete identifiers in wallet tiles. On checkout, offer an explicit accessible number/details action when needed; avoid noisy barcode graphics in the semantics tree. Minimum 48dp touch targets, strong contrast, font-scale testing, predictable focus and clear labelled back/delete actions are required. Delete requires intentional user confirmation in the UI. Never indicate support only by colour.

## Acceptance and test checklist

Use synthetic payloads only. Backend tests use a synthetic verified program; never enable a real retailer by copying its verification flags. Provision a synthetic test program in an isolated development database for the Android flow, then remove it before release.

- Unit tests: DTO parsing and unknown enums, exact payload preservation/leading zeroes, membership rules, symbology mapping, EAN checksum, masking, template parsing and normalized coordinates, repository error mapping, StateFlow/ViewModel transitions, account-scoped encrypted cache, expiry/clock rollback/reboot handling.
- Barcode tests: encode/decode round-trip for CODE_128, EAN_13, EAN_8, QR_CODE, PDF_417 using synthetic payloads; verify dimensions/quiet zones and failures. Decode rendered images and test several physical checkout scanners before approving real programmes.
- Compose tests: program search/category/support filters; manual entry; scan confirmation/cancel/conflict; preview and explicit save; loading/empty/error wallet; switch cards; private checkout; back/brightness/wake cleanup; duplicate/auth/network/template errors; deletion.
- Security tests: no secrets in logs/crash analytics; user/account switch; logout; screenshot/recents policy; decrypted cache inaccessible without account keys; removed/disabled card does not fall back to stale online cache.
- Accessibility/device tests: TalkBack, large fonts, small/large screens, portrait/landscape, camera unavailable/permission denied, asset failure, low brightness and offline mode.
- End-to-end release acceptance: select a genuinely verified program → scan/confirm independent payload and number → validate preview → save → masked wallet → checkout → successful physical scanner decode; add a second programme by configuration/template without a custom Android card screen.

Full end-to-end real-retailer checkout is a release gate pending the mobile implementation and program verification. This backend does not assert retailer acceptance merely because a barcode can be encoded.
