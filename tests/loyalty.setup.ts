import { mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import knex from "knex";
import containerSetup from "./setup";
export default async function setup() {
  if (!process.env.TEST_DATABASE_URL) return containerSetup();
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!/^loyalty_test_[a-z0-9_]+$/.test(url.pathname.slice(1))) throw new Error("Use a dedicated loyalty_test_* database");
  const config = { host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) };
  const db = knex({ client: "pg", connection: config });
  try {
    const tables = await db("information_schema.tables").where({ table_schema: "public" });
    if (tables.length) throw new Error("Loyalty test database must be empty");
    await db.raw(await readFile(path.resolve("src/database/schema.sql"), "utf8"));
    const dir = path.join(os.tmpdir(), "jest_testcontainers_global_setup");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "database.json"), JSON.stringify(config));
  } finally { await db.destroy(); }
}
