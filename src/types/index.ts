/**
 * @file index.ts (types)
 * @description Shared TypeScript types, interfaces, and declaration merging.
 *
 * Best Practices:
 * 1. Define global application types, custom Request extensions (e.g. `req.user`), and utility types.
 * 2. Keep shared interfaces here so multiple modules can import without circular dependencies.
 * 3. Use explicit naming conventions for Request / Response DTOs (e.g. `CreateRewardDTO`, `UserResponseDTO`).
 */

import Redis from "ioredis";
import { Knex } from "knex";


export type AppDependencies = {
    db: Knex;
    redis?: Redis;
};