import { readFile } from "node:fs/promises";
import db from "../src/config/database";
import { LoyaltyAdminService } from "../src/services/loyalty-admin.service";
const admin = new LoyaltyAdminService(db, (process.env.LOYALTY_ASSET_HOSTS ?? "").split(",").map(s => s.trim()).filter(Boolean));
try {
  const [command, argument, version] = process.argv.slice(2);
  if (command === "publish" && argument && !version) await admin.publish(JSON.parse(await readFile(argument, "utf8")));
  else if (command === "disable-template" && argument && version) await admin.disableTemplate(argument, Number(version));
  else throw new Error("Usage: pnpm exec tsx scripts/loyalty-admin.ts publish FILE | disable-template PROGRAM VERSION");
  console.log("Loyalty configuration updated");
} catch {
  // Never print raw SQL errors, input files, payloads, or credentials.
  console.error("Loyalty update failed. Check configuration, version, asset hosts, and database access.");
  process.exitCode = 1;
} finally { await db.destroy(); }
