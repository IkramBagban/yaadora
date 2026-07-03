import { defineConfig } from "drizzle-kit";

// Bun auto-loads `.env` — do NOT add dotenv.
export default defineConfig({
  schema: "./schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
