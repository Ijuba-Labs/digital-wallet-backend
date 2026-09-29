import { describe, expect, it } from "@jest/globals";
import { verifyInteractionHash } from "./grant-interaction";

// Published Open Payments/GNAP interaction-hash example.
const interaction = {
  clientNonce: "VJLO6A4CATR0KRO",
  finishNonce: "MBDOFXG4Y5CVJCX821LH",
  grantRequestUrl: "https://server.example.com/tx",
};
const ref = "4IFWWIKYB2PQ6U56NL1";
const hash = "x-gguKWTj8rQf7d7i3w3UhzvuJ5bpOlKyAlVpLxBffY";

describe("Grant interaction hash verification", () => {
  it("accepts the published digest in Base64URL and standard Base64", () => {
    expect(verifyInteractionHash(interaction, ref, hash)).toBe(true);
    expect(verifyInteractionHash(interaction, ref, Buffer.from(hash, "base64url").toString("base64"))).toBe(true);
  });

  it.each(["", "not-a-hash", `${hash}\n`, `${hash}==`, "A".repeat(43)])(
    "rejects invalid or incorrect hash %p", (value) => {
      expect(verifyInteractionHash(interaction, ref, value)).toBe(false);
    },
  );

  it("binds the proof to both nonces, the reference, and original grant URI", () => {
    for (const key of Object.keys(interaction)) {
      expect(verifyInteractionHash({ ...interaction, [key]: "different" }, ref, hash)).toBe(false);
    }
    expect(verifyInteractionHash(interaction, "another-reference", hash)).toBe(false);
    expect(verifyInteractionHash(interaction, `${ref}\ninjected`, hash)).toBe(false);
  });
});
