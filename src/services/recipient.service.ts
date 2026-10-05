import { z } from "zod";
import type { RecipientRepository, RecipientSearch } from "@/repositories/recipient.repository";
import type { RecipientSearchInput } from "@/validators/recipient.validator";
import { AppError } from "@/utils/appError";

export class RecipientService {
  constructor(private readonly repository: Pick<RecipientRepository, "search">) {}

  async search(userId: string, input: RecipientSearchInput) {
    const value = input.q.replace(/\s+/g, " ");
    let search: RecipientSearch;
    if (value.includes("@")) {
      if (!z.email().safeParse(value).success) throw new AppError("Enter the complete recipient email address", 400);
      search = { kind: "email", value: value.toLowerCase() };
    } else if (/^[+()0-9 -]+$/.test(value)) {
      const digits = value.replace(/[^0-9]/g, "");
      if (digits.length < 7 || digits.length > 15) throw new AppError("Enter the complete recipient phone number", 400);
      search = { kind: "phone", value: digits };
    } else {
      if (value.length > 100) throw new AppError("Recipient name query is too long", 400);
      search = { kind: "name", value: value.toLowerCase() };
    }
    return this.repository.search(userId, search, input.limit);
  }
}
