import dotenv from "dotenv";
import * as fs from "fs";

const envString = (name: string, defaultValue?: string): string => {
  const envValue = process.env[name];

  if (envValue) return envValue;
  if (defaultValue) return defaultValue;

  throw new Error(`Environment variable ${name} must be set.`);
};

function envStringArray(name: string, value: string[]): string[] {
  const envValue = process.env[name];
  return envValue == null
    ? value
    : envValue
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

function envInt(name: string, value: number): number {
  const envValue = process.env[name];
  return envValue == null ? value : parseInt(envValue);
}

function envFloat(name: string, value: number): number {
  const envValue = process.env[name];
  return envValue == null ? value : +envValue;
}

function envBool(name: string, value: boolean): boolean {
  const envValue = process.env[name];
  return envValue == null ? value : envValue === "true";
}

export type IAppConfig = typeof Config;

dotenv.config({
  path: process.env.ENV_FILE || ".env",
});

export const Config = {
  port: envInt("PORT", 9000),
  env: envString("NODE_ENV", "development"),
  clientUrl: envString("CORS_ORIGIN"),
  baseUrl: envString("HOST"),
  ngrokAuthToken: envString("NGROK_AUTHTOKEN"),
  ngrokDomain: envString("NGROK_DOMAIN"),
  databaseUrl:
    process.env.NODE_ENV === "test"
      ? `${process.env.DATABASE_URL}_${process.env.JEST_WORKER_ID}`
      : envString("DATABASE_URL"),
  logLevel: envString("LOG_LEVEL", "debug"),
  redisUrl: envString('REDIS_URL', 'redis://127.0.0.1:6379'),
  keyId: envString('KEY_ID'),
};
