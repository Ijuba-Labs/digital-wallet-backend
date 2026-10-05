import { describe, expect, it } from "@jest/globals";
import { createOnboardingConfig, getOnboardingReturnUrl } from "./onboarding";

describe("Onboarding destinations", () => {
  it("supports API-only onboarding and refuses unconfigured clients", () => {
    const config = createOnboardingConfig({ apiPublicUrl: "https://api.example.com" });
    expect(getOnboardingReturnUrl(config, "api")).toBeNull();
    expect(() => getOnboardingReturnUrl(config, "web")).toThrow("not configured");
    expect(getOnboardingReturnUrl(config, "mobile")).toBeNull();
  });

  it("permits local HTTP for development API/web destinations", () => {
    const config = createOnboardingConfig({
      apiPublicUrl: "http://localhost:9001", webReturnUrl: "http://localhost:3000/onboarding/return",
      allowLocalHttp: true,
    });
    expect(config.apiPublicUrl).toBe("http://localhost:9001");
    expect(config.returnUrls.web).toBe("http://localhost:3000/onboarding/return");
  });

  it.each([
    "http://app.example.com/return", "https://user:password@app.example.com/return",
    "https://app.example.com/return?next=evil", "https://app.example.com/return#fragment",
    "javascript:alert(1)", "https://localhost/return",
  ])("rejects unsafe production return destination %p", (webReturnUrl) => {
    expect(() => createOnboardingConfig({ apiPublicUrl: "https://api.example.com", webReturnUrl })).toThrow();
  });

  it("requires HTTPS app links for mobile even in development", () => {
    for (const mobileReturnUrl of ["wallet://onboarding", "http://localhost:3000/return"]) {
      expect(() => createOnboardingConfig({
        apiPublicUrl: "http://localhost:9001", allowLocalHttp: true, mobileReturnUrl,
      })).toThrow();
    }
  });

  it("rejects a production loopback API or API URL with a path", () => {
    expect(() => createOnboardingConfig({ apiPublicUrl: "http://localhost:9001" })).toThrow();
    expect(() => createOnboardingConfig({ apiPublicUrl: "https://api.example.com/v1" })).toThrow();
  });

  it("supports development mobile callbacks through ADB port forwarding", () => {
    const config = createOnboardingConfig({ apiPublicUrl: "http://localhost:9001", allowLocalHttp: true });
    expect(getOnboardingReturnUrl(config, "mobile")).toBeNull();
    expect(getOnboardingReturnUrl(config, "api")).toBeNull();
  });
});
