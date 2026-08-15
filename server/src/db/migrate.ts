import dotenv from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

// Same cwd caveat as server/src/config/env.ts — this script is invoked via
// `npm run migrate --workspace server`, which sets cwd to /server, not the
// repo root where .env actually lives.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// Plain, dependency-light migration runner. Applies every *.sql file in
// /db/migrations (repo root) in filename order, tracked in a
// schema_migrations table, each file wrapped in its own transaction.
//
// Run with: npm run migrate --workspace server
// Requires DATABASE_URL (direct Postgres connection string) in .env.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../db/migrations");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL in .env — cannot run migrations.");
    process.exit(1);
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log(`No .sql files found in ${MIGRATIONS_DIR}`);
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const { rows: applied } = await client.query<{ filename: string }>(
      "select filename from schema_migrations"
    );
    const appliedSet = new Set(applied.map((r) => r.filename));

    const pending = files.filter((f) => !appliedSet.has(f));
    if (pending.length === 0) {
      console.log(`Up to date — ${files.length} migration(s) already applied.`);
      return;
    }

    for (const file of pending) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`Applying ${file}...`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        console.log(`  ok`);
      } catch (err) {
        await client.query("rollback");
        console.error(`  failed: ${(err as Error).message}`);
        throw err;
      }
    }

    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
