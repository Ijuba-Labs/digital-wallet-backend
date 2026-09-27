import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Knex } from "knex";
import { createTestDatabase } from "../../../../../tests/database";
// import { app } from "@/app";
import { createUserRepository } from "@/repositories/user.repository";
import { number } from "zod";
import { env } from "@/config/env";
import { createApp } from "@/app";

const { JWT_SECRET } = env;

const registration = {
  "first_name": "Sibusiso",
  "last_name": "Nkomo",
  "email": "nkomo@gmail.com",
  "password": "123456789",
  "phone_number": "0123456789"
};

describe("Auth API", () => {
  let db: Knex;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createApp(db);
  });

  afterEach(async () => {
    await db("users").del();
  });

  afterAll(async () => {
    await db.destroy();
  });

  // let testDatabase: Awaited<ReturnType<typeof startTestDatabase>>;
  // let app: Application;
  // let appDb: typeof import("@/config/database").default;
  // let userRepository: typeof import("@/repositories").userRepository;

  // beforeAll(async () => {
  //   testDatabase = await startTestDatabase();

  //   Object.assign(process.env, {
  //     NODE_ENV: "test",
  //     FRONTEND_URL: "http://localhost:3000",
  //     DATABASE_URL: testDatabase.container.getConnectionUri(),
  //     JWT_SECRET: jwtSecret,
  //     CORS_ORIGIN: "http://localhost:3000",
  //     MOCK_USERS_COUNT: "1",
  //     SEED_USERS: "1",
  //     TEST_DB_NAME: testDatabase.container.getDatabase(),
  //     DB_USER: testDatabase.container.getUsername(),
  //     DB_PASSWORD: testDatabase.container.getPassword(),
  //     DB_HOST: testDatabase.container.getHost(),
  //     DB_TEST_PORT: String(testDatabase.container.getPort()),
  //     ACCESS_TOKEN_EXPIRES_IN: "1d",
  //   });

  //   ({ app } = await import("@/app"));
  //   ({ default: appDb } = await import("@/config/database"));
  //   ({ userRepository } = await import("@/repositories"));
  // });

  // beforeEach(async () => {
  //   await testDatabase.db("users").del();
  // });

  // afterAll(async () => {
  //   await appDb?.destroy();
  //   await testDatabase?.stop();
  // });

  it("registers a user, hashes the password, and returns a token without credentials", async () => {
    const userRepository = createUserRepository(db);
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send(registration)
      .expect(201);

    const storedUser = await userRepository.findByEmail(registration.email);

    // expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        user: {
          id: storedUser.id,
          first_name: registration.first_name,
          last_name: registration.last_name,
          phone_number: registration.phone_number,
          email: registration.email,
        },
        accessToken: expect.any(String),
        expiresIn: expect.any(Number),
        expiresAt: expect.any(Number)
      },
    });
    expect(storedUser.password_hash).toEqual(expect.any(String));
    expect(storedUser.password_hash).not.toBe(registration.password);
    expect(await bcrypt.compare(registration.password, storedUser.password_hash!)).toBe(true);
    expect(storedUser).not.toHaveProperty("password");
    expect(response.body.data.user).not.toHaveProperty("password_hash");
    expect(response.body.data.user).not.toHaveProperty("password");
    expect(jwt.verify(response.body.data.accessToken, JWT_SECRET)).toMatchObject({
      id: storedUser.id,
      email: registration.email,
    });
  });

  // it("rejects a duplicate email", async () => {
  //   await request(app).post("/api/v1/auth/register").send(registration).expect(200);

  //   const response = await request(app).post("/api/v1/auth/register").send(registration);

  //   expect(response.status).toBe(400);
  //   expect(response.body.error.message).toBe("A user with this email already exists.");
  // });

  // it("rejects invalid registration input before saving", async () => {
  //   const response = await request(app)
  //     .post("/api/v1/auth/register")
  //     .send({ ...registration, email: "invalid-email" });

  //   expect(response.status).toBe(400);
  //   expect(response.body.error.details.email).toEqual(expect.arrayContaining(["Invalid email address format"]));
  //   expect(await testDatabase.db("users").count("*").first()).toMatchObject({ count: "0" });
  // });

  // it("logs in a registered user and returns a valid token", async () => {
  //   await request(app).post("/api/v1/auth/register").send(registration).expect(200);
  //   const storedUser = await userRepository.findByEmail(registration.email);

  //   const response = await request(app).post("/api/v1/auth/login").send({
  //     email: registration.email,
  //     password: registration.password,
  //   });

  //   expect(response.status).toBe(200);
  //   expect(response.body).toMatchObject({ success: true, data: { token: expect.any(String) } });
  //   expect(jwt.verify(response.body.data.token, jwtSecret)).toMatchObject({
  //     id: storedUser.id,
  //     email: registration.email,
  //   });
  //   expect(response.body.data).not.toHaveProperty("password_hash");
  // });

  // it("rejects an incorrect password", async () => {
  //   await request(app).post("/api/v1/auth/register").send(registration).expect(200);

  //   const response = await request(app).post("/api/v1/auth/login").send({
  //     email: registration.email,
  //     password: "wrong-password",
  //   });

  //   expect(response.status).toBe(401);
  //   expect(response.body.error.message).toBe("Incorrect email or password");
  // });

  // it("rejects login for an unknown account", async () => {
  //   const response = await request(app).post("/api/v1/auth/login").send({
  //     email: registration.email,
  //     password: registration.password,
  //   });

  //   expect(response.status).toBe(404);
  //   expect(response.body.error.message).toBe("User account not found");
  // });

  // it("rejects invalid login input before looking up a user", async () => {
  //   const response = await request(app).post("/api/v1/auth/login").send({
  //     email: "invalid-email",
  //     password: "short",
  //   });

  //   expect(response.status).toBe(400);
  //   expect(response.body.error.details).toMatchObject({
  //     email: ["Invalid email address format"],
  //     password: ["Password must be 8 characters or more"],
  //   });
  //   expect(await testDatabase.db("users").count("*").first()).toMatchObject({ count: "0" });
  // });
});
