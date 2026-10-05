import type { Knex } from "knex";

export interface Recipient {
  recipientUserId: string;
  displayName: string;
}

export type RecipientSearch = { kind: "name" | "email" | "phone"; value: string };

// PostgreSQL LIKE metacharacters are literal input, never directory wildcards.
const prefix = (value: string) => value.replace(/[\\%_]/g, "\\$&") + "%";

export class RecipientRepository {
  constructor(private readonly db: Knex) {}

  async search(requesterId: string, search: RecipientSearch, limit: number): Promise<Recipient[]> {
    const query = this.db("users as u").where("u.status", "ACTIVE").whereNot("u.id", requesterId)
      .whereExists(this.db("wallets as w").select(this.db.raw("1")).whereRaw("w.user_id = u.id")
        .andWhere("w.status", "LINKED").whereNotNull("w.verified_at"));

    if (search.kind === "email") {
      query.andWhereRaw("lower(u.email) = ?", [search.value]);
    } else if (search.kind === "phone") {
      query.andWhereRaw("regexp_replace(u.phone_number, '[^0-9]', '', 'g') = ?", [search.value]);
    } else {
      const pattern = prefix(search.value);
      query.andWhere(function () {
        this.whereRaw("lower(trim(u.first_name)) LIKE ?", [pattern])
          .orWhereRaw("lower(trim(u.last_name)) LIKE ?", [pattern])
          .orWhereRaw("lower(concat_ws(' ', trim(u.first_name), trim(u.last_name))) LIKE ?", [pattern])
          .orWhereRaw("lower(concat_ws(' ', trim(u.last_name), trim(u.first_name))) LIKE ?", [pattern]);
      });
    }

    return query.select("u.id as recipientUserId",
      this.db.raw("coalesce(nullif(trim(concat_ws(' ', trim(u.first_name), trim(u.last_name))), ''), 'Recipient') as \"displayName\""))
      .orderByRaw("lower(concat_ws(' ', trim(u.first_name), trim(u.last_name))) ASC")
      .orderBy("u.id", "asc").limit(limit);
  }
}
