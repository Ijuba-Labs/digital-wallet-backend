import containerTeardown from "./teardown";
export default async function teardown() {
  if (!process.env.TEST_DATABASE_URL) await containerTeardown();
}
