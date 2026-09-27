/**
 * @file index.ts (repositories)
 * @description Data Access Layer (Repository Pattern).
 *
 * Best Practices:
 * 1. Encapsulate all direct database queries (SELECT, INSERT, UPDATE, DELETE) inside repositories.
 * 2. Keep services agnostic of specific query details, database vendors, or ORM specifics.
 * 3. Provide semantic method names (e.g. `findById`, `createReward`, `updateBalance`).
 * 4. Handle database-level transactions across multiple repository calls at this layer or via a unit-of-work helper.
 */

import { createUserRepository } from "./user.repository";
import { Knex } from "knex";

// export const userRepository = createUserRepository(knexClient);

export const createRepositories = (db: Knex) => ({
    users: createUserRepository(db),
});