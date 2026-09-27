import { describe, expect, jest, it, beforeAll, afterAll } from "@jest/globals";
import { createUser as createTestUser } from "@/database/seeds/factories/user.factory";
import { Knex } from "knex";
import { createUserRepository } from "./user.repository";
import { createTestDatabase } from "../../tests/database";

describe("User Repository", () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await db("users").del();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("should create and return a new user", async () => {
    const userRepository = createUserRepository(db);
    const testUser = createTestUser();


    const dbUser = await userRepository.save(testUser);
    expect(dbUser).toMatchObject({
      email: testUser.email,
      phone_number: testUser.phone_number,
      password_hash: testUser.password_hash,
      first_name: testUser.first_name,
      last_name: testUser.last_name,
    });
  });

  it("should find user by email", async () => {
    const userRepository = createUserRepository(db);
    const testUser = createTestUser()

    await userRepository.save(testUser);
    const user = await userRepository.findByEmail(testUser.email);

    expect(user).toBeDefined();
    expect(user.email).toBe(testUser.email);
  });

  it("should find user by id", async () => {
    const userRepository = createUserRepository(db);
    const testUser = createTestUser();
    const userId = testUser.id as string;

    await userRepository.save(testUser);
    const dbUser = await userRepository.findById(userId);

    expect(dbUser.email).toEqual(testUser.email);
  });

});
