import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import knex, { Knex } from "knex";
import { TestDatabaseConfig } from "./types";


const variablesDir = path.join(
    os.tmpdir(),
    "jest_testcontainers_global_setup"
);

const getDatabaseConfig = async (): Promise<TestDatabaseConfig> => {
    const content = await readFile(
        path.join(variablesDir, "database.json"),
        "utf8"
    );

    return JSON.parse(content) as TestDatabaseConfig;
};

export const createTestDatabase = async (): Promise<Knex> => {
    const config = await getDatabaseConfig();

    return knex({
        client: "postgresql",
        connection: config,
    });
};