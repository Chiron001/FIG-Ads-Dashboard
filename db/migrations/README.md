# Migrations

Plain numbered `.sql` files, applied in filename order by
`server/src/db/migrate.ts`. No ORM — this is small and stable enough that a
tracked `schema_migrations` table + a ~60-line runner is simpler than
pulling in a migration framework.

## Run

```bash
cp .env.example .env   # fill in DATABASE_URL (direct Postgres connection
                        # string from Supabase → Project Settings → Database)
npm run migrate --workspace server
```

Safe to re-run — already-applied files are skipped via `schema_migrations`.

## Files

- `0001_init.sql` — `fact_ad_performance` (canonical schema, §3 of the
  spec) and `sync_log`. No `dim_fx_rate` — confirmed all ad accounts
  (Google/Meta/Amazon) bill in INR, so the FX layer is skipped entirely.
  Revisit this file's header comment if that ever changes.

## Adding a migration

Create `NNNN_description.sql` with the next number, additive only (this
runner has no `down` migrations — write a new forward migration to undo
something instead).
