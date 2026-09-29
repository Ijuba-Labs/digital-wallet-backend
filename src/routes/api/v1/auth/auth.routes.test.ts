import {
  afterEach,
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Knex } from "knex";
import { createTestDatabase } from "../../../../../tests/database";
import { createUserRepository } from "@/repositories/user.repository";
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
    app = createApp({ db });
  });

  afterEach(async () => {
    await db("users").where({ email: registration.email }).del();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("registers a user, hashes the password, and returns a token without credentials", async () => {
    const userRepository = createUserRepository(db);
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send(registration)
      .expect(201);

    const storedUser = await userRepository.findByEmail(registration.email);

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

  describe("POST /api/v1/auth/login", () => {
    const credentials = {
      email: registration.email,
      password: registration.password,
    };

    it("returns the user and a valid access token for correct credentials", async () => {
      await request(app)
        .post("/api/v1/auth/register")
        .send(registration)
        .expect(201);

      const storedUser = await createUserRepository(db).findByEmail(registration.email);
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send(credentials)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          user: { id: storedUser.id, email: registration.email },
          accessToken: expect.any(String),
          expiresIn: expect.any(Number),
          expiresAt: expect.any(Number),
        },
      });
      expect(response.body.data.user).not.toHaveProperty("password");
      expect(response.body.data.user).not.toHaveProperty("password_hash");
      expect(response.body.data.expiresIn).toBeGreaterThan(0);

      const claims = jwt.verify(response.body.data.accessToken, JWT_SECRET);
      expect(claims).toMatchObject({
        id: storedUser.id,
        email: registration.email,
        exp: response.body.data.expiresAt,
      });
    });

    it("rejects an incorrect password", async () => {
      await request(app)
        .post("/api/v1/auth/register")
        .send(registration)
        .expect(201);

      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({ ...credentials, password: "wrong-password" })
        .expect(401);

      expect(response.body).toMatchObject({
        success: false,
        error: { statusCode: 401, message: "Incorrect email or password" },
      });
      expect(response.body).not.toHaveProperty("data");
    });

    it("rejects an account that does not exist", async () => {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send(credentials)
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: { statusCode: 404, message: "User account not found" },
      });
    });

    it("rejects malformed credentials", async () => {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "not-an-email", password: "short" })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          statusCode: 400,
          details: {
            email: ["Invalid email address format"],
            password: ["Password must be 8 characters or more"],
          },
        },
      });
    });
  });

});
