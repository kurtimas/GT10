import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "../shared/db/schema.ts",
  out: "../shared/db/migrations",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString,
  },
});
