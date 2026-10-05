# Loyalty card vault API

All endpoints are under `/api/v1`. The program catalogue is public; every card endpoint requires the existing bearer access token. Card details are user supplied. The API does not contact a retailer or verify ownership.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/loyalty-programs` | List programs and whether a custom name is required |
| POST | `/loyalty-cards` | Create from JSON or multipart `card` JSON plus optional `image` |
| GET | `/loyalty-cards` | List masked cards |
| GET | `/loyalty-cards/:id` | Get masked metadata |
| GET | `/loyalty-cards/:id/presentation` | Get entered number and barcode, and an image URL |
| GET | `/loyalty-cards/:id/image` | Retrieve the stored image |
| PATCH | `/loyalty-cards/:id` | Update entered details and nickname with JSON |
| PUT | `/loyalty-cards/:id/image` | Replace an image with multipart `image` |
| DELETE | `/loyalty-cards/:id` | Remove a card |

For JSON creation, send `programId` and at least one of `membershipNumber` or `barcodePayload`. A barcode payload requires an explicit `barcodeFormat`; the backend never infers a format for a number. `other` requires `customProgramName`. For multipart creation, send a JSON `card` field and an optional PNG or JPEG `image` file. An image alone is accepted if a barcode or plausible membership number is detected. Files are limited to 5 MB and 100–6000 pixels wide by 80–6000 pixels high. A rejected image returns 422; invalid files return 400; unavailable recognition returns 503. A clearer crop can be retried, or the card can be created with entered details alone.

List and detail responses expose masked values. The presentation route returns only the owner's entered values, and the image route returns the owner's normalized JPEG. All card responses have `Cache-Control: no-store`.

At deployment, include `assets/tesseract/eng.traineddata.gz` with the application. The source is the [Tesseract.js English data package](https://www.npmjs.com/package/@tesseract.js-data/eng), version 1.0.0, `4.0.0_best_int`; its SHA-256 is `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91`. `LOYALTY_OCR_ASSET_DIR` can point to another local directory containing that exact file. No recognition assets are fetched during requests.
