import os from "node:os";
import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import {
    PostgreSqlContainer,
    StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import knex from "knex";

const TEST_DATABASE = "wallet_bucket_test";
const TEST_USERNAME = "man_hunter";
const TEST_PASSWORD = "pgadmin123";
const PG_PORT = 5432;

const variablesDir = path.join(
    os.tmpdir(),
    "jest_testcontainers_global_setup"
);

const spawnDatabase = (): Promise<StartedPostgreSqlContainer> => {
    return new PostgreSqlContainer("postgres:18-bookworm")
        .withDatabase(TEST_DATABASE)
        .withUsername(TEST_USERNAME)
        .withPassword(TEST_PASSWORD)
        .withExposedPorts(PG_PORT)
        .withTmpFs({
            "/temp_pgdata": "rw,noexec,nosuid,size=65536k",
        })
        .start();
};

const initializeDatabase = async (container: StartedPostgreSqlContainer): Promise<void> => {
    const db = knex({
        client: "pg",
        connection: {
            host: container.getHost(),
            port: container.getMappedPort(PG_PORT),
            database: TEST_DATABASE,
            user: TEST_USERNAME,
            password: TEST_PASSWORD,
        },
    });

    try {
        const schema = await readFile(
            path.resolve("src/database/schema.sql"),
            "utf8"
        );

        await db.raw(schema);
    } finally {
        await db.destroy();
    }
};

const shareDatabaseConfig = async (container: StartedPostgreSqlContainer): Promise<void> => {
    await mkdir(variablesDir, { recursive: true });

    const config = {
        host: container.getHost(),
        port: container.getMappedPort(PG_PORT),
        database: TEST_DATABASE,
        user: TEST_USERNAME,
        password: TEST_PASSWORD,
    };

    await writeFile(
        path.join(variablesDir, "database.json"),
        JSON.stringify(config)
    );
};

export default async function globalSetup(): Promise<void> {
    const container = await spawnDatabase();

    await initializeDatabase(container);
    await shareDatabaseConfig(container);

    // Only globalTeardown should use this.
    (globalThis as any).__DATABASE_CONTAINER__ = container;
}