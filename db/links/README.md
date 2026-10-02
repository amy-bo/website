# Link pages database

SQL for the link pages (amy.bo/~name, amy.bo/links), in the same D1 database as registrations.

- Every file here runs on **every** production deploy (`.github/workflows/deploy.yml`) and locally with `npm run db:migrate:local`, in name order, so each must be safe to re-run: `CREATE … IF NOT EXISTS`, and seeds guarded by `lp_seeds` so they run once and never overwrite later edits.
- A change to an existing table needs a new numbered file whose statements are themselves re-runnable (for example, add a column only when `pragma_table_info` shows it missing, via a guarded `INSERT … SELECT` into a new table), never an edit to `0001_schema.sql`.
- `0002_seed_pages.sql` holds Martin's and AMYBO's pages as moved from Linktree on 2 October 2026, with Linktree's click counts as `seed`.
