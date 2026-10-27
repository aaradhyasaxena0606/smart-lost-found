# Deployment Guide (free tier)

This application needs three things that a static host cannot provide on its own:

1. **PostgreSQL with PostGIS** — Vercel does not offer a database at all.
2. **A long-running Node process** for the Express API (or a serverless adapter).
3. **Durable storage for uploaded images**, if you keep the photo feature.

The recommended free combination is:

```
Vercel   -> client/dist          static frontend (no sleep, global CDN)
Render   -> Express API          free web service (sleeps when idle)
Supabase -> PostgreSQL + PostGIS free database
```

Only the frontend is on Vercel. The API and database live elsewhere, which is why
this path requires **no application code changes** — the client already reads
`VITE_API_URL` and `VITE_API_ORIGIN`.

An all-Vercel variant is described in §6; it requires code changes because Vercel
functions have a read-only filesystem.

---

## 1. Supabase: create the database

1. Create a project at <https://supabase.com> and save the database password.
2. **Enable PostGIS before running migrations.** Dashboard → *Database* →
   *Extensions* → search `postgis` → enable. When asked for a schema, accept the
   default `extensions` schema.

   This order matters. Supabase installs extensions into `extensions`, not
   `public`. If PostGIS is not already enabled, our migration would install it
   into `public` instead, which works but differs from Supabase's own convention
   (and leaves `spatial_ref_sys` writable by the `anon` role).

3. `pg_trgm` and `pgcrypto` are also required. Both are available on Supabase and
   are enabled by migration `001`; if your project restricts extension creation,
   enable them the same way from the dashboard first.

### Connection strings

Project Settings → *Database* → *Connection string*:

| Purpose | Mode | Port | Notes |
|---|---|---|---|
| Migrations, admin scripts | **Session pooler** | `5432` | Simpler, supports everything |
| Running API on Render/serverless | **Transaction pooler** | `6543` | Best for many short-lived connections |

Supabase pooler usernames look like `postgres.<project-ref>`, not `postgres`.
Always append `?sslmode=require`.

```env
# migrations (session pooler)
DATABASE_URL=postgresql://postgres.abcdefghijklm:YOUR-PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require

# the API (transaction pooler)
DATABASE_URL=postgresql://postgres.abcdefghijklm:YOUR-PASSWORD@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require
```

URL-encode the password if it contains `@`, `:`, `/`, `+` or spaces.

### Point the app at the `extensions` schema

Because PostGIS lives outside `public`, the `geography` type and functions such as
`ST_DWithin` must be on the search path. Set:

```env
PG_SEARCH_PATH=public, extensions
```

`public` must come first so that **your** tables are created in and resolved from
`public`. The value is sent as a connection startup parameter, never interpolated
into SQL.

`PGPOOL_MAX` controls the pool ceiling. Supabase's free plan allows relatively few
direct connections, so use `5` on a small deployment:

```env
PGPOOL_MAX=5
```

### Apply the schema

Do this from your machine, not from the host:

```bash
# In .env, with DATABASE_URL pointing at the session pooler:
npm run db:migrate
npm run admin:create -- --email=you@example.com --name="Your Name"
```

Two commands are **dangerous or invalid on Supabase** and must be avoided:

| Command | Why not |
|---|---|
| `npm run db:create` | Tries `CREATE DATABASE`, which Supabase does not permit. The project already has a `postgres` database. |
| `npm run db:reset` | Drops `schema public` cascade. On a managed platform that also removes role grants and can break the project. Only ever use it on a local throwaway database. |
| `npm run db:seed` | Creates demo students and an administrator whose password is published in this repository. Use `admin:create` instead. |

Verify the result:

```bash
npm run db:status          # 14 migrations applied
psql "$DATABASE_URL" -c "SELECT postgis_full_version();"
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE indexname = 'items_location_gist_idx';"
```

---

## 2. Render: run the API

The repository includes `render.yaml`, so the fastest path is a **Blueprint**:

1. <https://render.com> → *New* → *Blueprint* → select the repository. Render reads
   `render.yaml` and creates the web service with the correct build/start commands,
   health check and non-secret environment variables.
2. Enter the two values it prompts for: `DATABASE_URL` (Supabase transaction
   pooler) and `CLIENT_ORIGIN` (your Vercel URL).

Manual alternative:

1. <https://render.com> → *New* → *Web Service* → connect
   `aaradhyasaxena0606/smart-lost-found`.
2. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Health check path:** `/api/v1/health`
   - **Instance type:** Free
3. Environment variables:

```env
NODE_ENV=production
DATABASE_URL=<supabase transaction pooler, port 6543, ?sslmode=require>
PG_SEARCH_PATH=public, extensions
PGPOOL_MAX=5
JWT_SECRET=<48 random bytes, hex>
CLIENT_ORIGIN=https://your-app.vercel.app
AI_PROVIDER=disabled
UPLOAD_DIR=/tmp/uploads
```

Generate the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`NODE_ENV=production` makes `config/env.js` refuse to start with a placeholder
secret or the example database password, so a misconfigured deploy fails visibly
rather than running insecurely.

### Free-plan behaviour to expect

- The service **sleeps after 15 minutes** without traffic and takes about a minute
  to wake. The first request after idle may time out in the browser; the UI shows
  its error state and "Try again" works.
- **750 instance-hours per calendar month** per workspace. A single always-on
  service uses about 744 hours in a 31-day month, so keep it to one service.
- **The filesystem is ephemeral.** `UPLOAD_DIR=/tmp/uploads` keeps uploads working
  for the life of the instance, but they are lost on redeploy or restart. See §5.

---

## 3. Vercel: host the frontend

1. <https://vercel.com> → *Add New* → *Project* → import the repository.
2. **Root Directory:** `client`
3. Framework preset: **Vite** · Build: `npm run build` · Output: `dist`

   The repository already contains `client/vercel.json`, which pins exactly
   these values and adds the SPA fallback rewrite. Without that rewrite, sharing a
   deep link such as `/items/5` would return Vercel's 404 instead of the app.

4. Environment variables (these are inlined at **build** time, so redeploy after
   changing them):

```env
VITE_API_URL=https://your-api.onrender.com/api/v1
VITE_API_ORIGIN=https://your-api.onrender.com
```

`VITE_API_URL` must include `/api/v1`. `VITE_API_ORIGIN` is used to build absolute
URLs for uploaded images.

5. Set `CLIENT_ORIGIN` on Render to the Vercel URL and redeploy the API.

### Vercel Hobby limits that matter here

| Limit | Value |
|---|---|
| Function maximum duration | 300 s |
| Memory | 2 GB / 1 vCPU |
| Fast data transfer | 100 GB/month |
| Function invocations | 1 M/month |
| Active CPU | 4 CPU-hours/month |
| **Filesystem** | **read-only except `/tmp` (500 MB)** |
| Permitted use | **non-commercial, personal projects only** |

The client is static, so only the bandwidth and invocations limits apply. The
filesystem limitation matters only if you also host the API on Vercel (§6).

---

## 4. Verify the deployment

Run through this list; each step exercises a different layer.

| Check | Expected |
|---|---|
| `GET https://your-api.onrender.com/api/v1/health?db=1` | `status: ok`, `checks.database.status: ok`, a PostGIS version |
| Sign in with the account created by `admin:create` | Redirects to the dashboard |
| Report a lost item **with coordinates** | `201`, and `matchSummary.matchCount` > 0 |
| `GET /api/v1/items?latitude=…&longitude=…&radiusMeters=1500&sort=distance` | Rows with `distanceMeters`, nearest first |
| Search by keyword | Filters correctly (proves the `pg_trgm` indexes exist) |
| Submit a claim from a second account, then approve it as admin | Item becomes `returned`; both users get notifications |
| `/admin/audit-logs` | Records for the actions above |
| `GET /api/v1/health` (no `?db=1`) | No connection string or credentials in the body |

---

## 5. Image uploads: the one unresolved free-tier issue

There is a real limit here, stated plainly:

| Host | Uploads work? | Durable? |
|---|---|---|
| Local development | Yes | Yes (`uploads/` on disk) |
| Render Free | Yes, to `/tmp/uploads` | **No** — lost on redeploy/restart |
| Vercel | **No** — read-only filesystem | — |

Three options:

1. **Accept it for a demo.** Photos work until the service restarts. Document it.
2. **Use Supabase Storage** (free allowance, and you already have a Supabase
   project). Requires replacing multer disk storage with an upload to a bucket and
   storing the object path in `item_images.storage_key`. The schema already
   supports this: `storage_key` is opaque, and the API returns
   `/uploads/<key>`, so only the storage layer and URL builder change.
3. **Disable the photo field** in the UI and drop the upload route.

Option 2 is the clean fix and is isolated to
`server/src/middleware/upload.js` plus the image URL mapping.

---

## 6. All-Vercel variant (requires code changes)

Possible, but the API must be adapted:

| Change | Why |
|---|---|
| Add `api/index.js` exporting the Express app, plus `vercel.json` rewrites | Vercel functions are per-file handlers, not a long-running server |
| Replace disk upload storage with object storage | The function filesystem is read-only except `/tmp`, and `/tmp` does not persist |
| `PGPOOL_MAX=1` and the transaction pooler URL | Each function instance is a separate process; a pool of 10 exhausts the database |
| Replace in-process rate limiting with a shared store | `express-rate-limit`'s memory store is per-instance and ineffective |
| Guard `fs.mkdirSync(UPLOAD_DIR)` | It runs at module load and throws `EROFS` on a read-only filesystem |

Also note that Hobby is restricted to non-commercial personal use.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `type "geography" does not exist` | PostGIS is in `extensions` but not on the search path | Set `PG_SEARCH_PATH=public, extensions` (and enable PostGIS) |
| `function st_dwithin(...) does not exist` | Same as above | Same |
| `remaining connection slots are reserved` | Pool too large, or direct connections instead of the pooler | Use the transaction pooler (port 6543) and `PGPOOL_MAX=5` |
| `prepared statement "s1" does not exist` | Transaction pooler does not support named prepared statements | This codebase does not use them; a future change must avoid them |
| Browser CORS error | `CLIENT_ORIGIN` does not match the Vercel URL exactly | Set it without a trailing slash and redeploy |
| 502/504 on the first visit | Free Render instance is waking | Wait ~60 s and retry |
| Login returns 500 right after deploy | API still booting, or `JWT_SECRET` unset | Check Render logs; the server refuses to start in production without a real secret |
| Images 404 after a redeploy | Ephemeral filesystem | See §5 |
| `permission denied to create database` | You ran `db:create` against Supabase | Use `db:migrate` only |
| `must be owner of extension postgis` | Extension owned by Supabase's admin role | Do not try to alter/move it; rely on `PG_SEARCH_PATH` |

---

## 8. Alternatives

| Option | Trade-off |
|---|---|
| **Oracle Cloud Always Free VM** | The only genuinely free option where nothing sleeps and uploads persist. Install PostgreSQL + PostGIS, run the API under `pm2`, serve the client behind Caddy for automatic TLS. Most setup work. |
| **Neon instead of Supabase** | Equivalent for this app (PostGIS 3.5.7 on PG17 / 3.6.4 on PG18, 1 GB free). It also needs `PG_SEARCH_PATH` only if PostGIS is not in `public`. |
| **Cloudflare Tunnel + local machine** | Fastest for a one-hour demo or viva: `cloudflared tunnel --url http://localhost:4000`. No hosting, but only while your machine is on. |
| **Railway / Koyeb** | Trial credit or auto-sleep with different limits; the same environment variables apply. |

---

## 9. Security checklist before sharing the URL

- [ ] `JWT_SECRET` is at least 32 random bytes and unique to this deployment.
- [ ] `NODE_ENV=production` (enables the startup secret checks).
- [ ] `CLIENT_ORIGIN` lists only your real frontend origin.
- [ ] Demo seed data is **not** present (`db:seed` was not run); the only admin was
      created with `admin:create`.
- [ ] `AI_PROVIDER=disabled` unless you have deliberately configured a key.
- [ ] `.env` is not committed (it is git-ignored) and no secret is in the client
      bundle — only `VITE_*` variables are exposed, and none are secret.
- [ ] You have checked the provider's free-tier terms (Vercel Hobby is
      non-commercial; Supabase free projects pause when idle).
