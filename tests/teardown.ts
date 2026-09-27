import { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";

const variablesDir = path.join(
    os.tmpdir(),
    "jest_testcontainers_global_setup"
);

const globalTeardown = async (): Promise<void> => {
    const container = (globalThis as any)
        .__DATABASE_CONTAINER__ as StartedPostgreSqlContainer | undefined;

    if (container) {
        await container.stop();
    }

    await rm(variablesDir, {
        recursive: true,
        force: true,
    });
}

export default globalTeardown;