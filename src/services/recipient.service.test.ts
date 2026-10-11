import { describe, expect, it, jest } from "@jest/globals";
import type { RecipientRepository } from "@/repositories/recipient.repository";
import { RecipientService } from "./recipient.service";

describe("Recipient search classification", () => {
  it.each([
    ["Sipho   Dlamini", "name", "sipho dlamini"],
    ["SIPHO@Example.com", "email", "sipho@example.com"],
    ["+27 (82) 123-4567", "phone", "27821234567"],
    ["0821234567", "phone", "0821234567"],
    ["O'Neil", "name", "o'neil"],
  ])("classifies %s without guessing contact information", async (q, kind, value) => {
    const search = jest.fn<RecipientRepository["search"]>().mockResolvedValue([]);
    await new RecipientService({ search, recent: jest.fn<RecipientRepository["recent"]>() }).search("sender", { q, limit: 10 });
    expect(search).toHaveBeenCalledWith("sender", { kind, value }, 10);
  });

  it.each(["sipho@", "sipho@example", "123", "1234567890123456", "x".repeat(101)])(
    "rejects incomplete contacts or oversized names: %s", async (q) => {
      const search = jest.fn<RecipientRepository["search"]>().mockResolvedValue([]);
      await expect(new RecipientService({ search, recent: jest.fn<RecipientRepository["recent"]>() }).search("sender", { q, limit: 10 })).rejects.toMatchObject({ statusCode: 400 });
      expect(search).not.toHaveBeenCalled();
    });
});

describe("Recent recipients", () => {
  it("queries history only for the authenticated user with the requested limit", async () => {
    const recipients = [{ recipientUserId: "recipient", displayName: "Sipho" }];
    const recent = jest.fn<RecipientRepository["recent"]>().mockResolvedValue(recipients);
    const search = jest.fn<RecipientRepository["search"]>();
    expect(await new RecipientService({ search, recent }).recent("sender", { limit: 5 })).toEqual(recipients);
    expect(recent).toHaveBeenCalledWith("sender", 5);
    expect(search).not.toHaveBeenCalled();
  });
});
