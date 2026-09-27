import { describe, expect, jest, it, beforeAll, afterAll } from "@jest/globals";
import { authLoginSchema, authRegisterSchema } from "./auth.validator";

describe("Auth Register Schema", () => {
  it("should validate the register input data and return a validated input", async () => {
    const testUser = {
      first_name: "Test",
      last_name: "Test",
      email: "Test@test.com",
      password: "12345678",
      phone_number: "1234567890"
    }

    const parsedInput = authRegisterSchema.parse(testUser);

    expect(parsedInput).toMatchObject(testUser);
  });

  describe("Auth Login Schema", () => {
    it("should accept valid login credentials with an eight-character password", () => {
      const credentials = {
        email: "test@example.com",
        password: "12345678"
      };

      expect(authLoginSchema.parse(credentials)).toEqual(credentials);
    });

    it.each([
      { email: "invalid-email", password: "12345678", field: "email", message: "Invalid email address format" },
      { email: "test@example.com", password: "1234567", field: "password", message: "Password must be 8 characters or more" }
    ])("should reject invalid $field", ({ email, password, field, message }) => {
      const result = authLoginSchema.safeParse({ email, password });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(expect.arrayContaining([
          expect.objectContaining({ path: [field], message })
        ]));
      }
    });

    it.each([
      { input: { password: "12345678" }, field: "email" },
      { input: { email: "test@example.com" }, field: "password" }
    ])("should reject a missing $field", ({ input, field }) => {
      const result = authLoginSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(expect.arrayContaining([
          expect.objectContaining({ path: [field] })
        ]));
      }
    });
  });
});
