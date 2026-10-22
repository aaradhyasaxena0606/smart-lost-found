# Smart Lost & Found

**An AI-assisted campus item recovery system using spatial database indexing and relational data management.**

A campus-focused web application that centralises lost-property reports. Users report
lost and found items, search and filter them, receive ranked candidate matches based
on item attributes, time and geographic proximity, and claim items they recognise.
Administrators moderate reports and review claims.

Built as an academic DBMS project: PostgreSQL 17 with PostGIS 3.6 is the system of
record, and the schema deliberately exercises relational modelling, normalisation,
keys and constraints, joins, aggregates, transactions, B-tree/GiST/GIN indexing,
spatial queries, `EXPLAIN ANALYZE` and an audit trail.

---

## Table of contents

1. [Feature summary](#1-feature-summary)
2. [Roles](#2-roles)
3. [Architecture and technology stack](#3-architecture-and-technology-stack)
4. [Prerequisites](#4-prerequisites)
5. [PostgreSQL and PostGIS setup](#5-postgresql-and-postgis-setup)
6. [Environment configuration](#6-environment-configuration)
7. [Installation](#7-installation)
8. [Database migrations and seed data](#8-database-migrations-and-seed-data)
9. [Running the application](#9-running-the-application)
10. [Testing, linting and building](#10-testing-linting-and-building)
11. [Frontend pages](#11-frontend-pages)
12. [API reference](#12-api-reference)
13. [Database design, ER diagram and DBMS concepts](#13-database-design-er-diagram-and-dbms-concepts)
14. [Matching algorithm and scoring](#14-matching-algorithm-and-scoring)
15. [Optional AI provider and fallback behaviour](#15-optional-ai-provider-and-fallback-behaviour)
16. [Security and privacy](#16-security-and-privacy)
17. [Backup and recovery](#17-backup-and-recovery)
18. [Deployment notes](#18-deployment-notes)
19. [Repository structure](#19-repository-structure)
20. [Known limitations](#20-known-limitations)
21. [Future enhancements](#21-future-enhancements)
22. [Verification status](#22-verification-status)

---

## 1. Feature summary

| Area | Implemented |
|---|---|
| Accounts | Registration, login, JWT sessions, profile with statistics, password change, deactivation |
| Roles | `user` and `admin`, enforced server-side; no endpoint can grant the admin role |
| Reports | Create, edit, soft delete, validated status lifecycle for both lost and found items |
| Attributes | Category, title, description, colour, brand, event date/time, location name and coordinates |
| Images | Optional JPEG/PNG/WebP upload, ≤ 5 MB (configurable), MIME **and** magic-byte verified, generated filenames |
| Private details | An access-restricted ownership verification hint, structurally excluded from public responses |
| Search | Keyword (indexed `ILIKE` + trigram similarity), category, colour, brand, status, type, date window, radius, sorting, pagination |
| Spatial | PostGIS `geography(Point,4326)` with a GiST index; radius search in metres |
| Matching | Deterministic, explainable, configurable scoring across attributes, time and distance; persisted with per-component scores and reasons |
| AI (optional) | Provider adapter; disabled by default; timeout and graceful fallback; only public text is transmitted |
| Claims | Submission, withdrawal, administrator approve/reject with a recorded reason, competing-claim handling, atomic status updates |
| Notifications | In-app notifications for matches, claim events, returns and moderation, with an unread badge |
| Moderation | Administrator report queue, approve/reject/close with a reason, full lifecycle validation |
| Audit | Append-only audit trail of 16 action types with safe metadata, filterable and paginated |
| Admin tools | Database-backed statistics, account listing, audit browser |
| Quality | Versioned migrations with checksum drift detection, 169 automated tests, ESLint, idempotent seed, `EXPLAIN ANALYZE` walkthrough |

Screenshots of the running application were captured during verification; see
[§22](#22-verification-status).

## 2. Roles

**Student / user**

- register and sign in;
- create, edit, close and delete their own reports;
- browse and search all public-safe reports;
- view ranked candidate matches for their own reports and dismiss suggestions;
- submit claims for eligible found items and withdraw a pending claim;
- view their own claims and notifications.

**Administrator**

- everything a user can do, plus:
- the report moderation queue (approve, reject with a reason, close);
- the claim review queue, including the finder's private verification detail needed
  to judge ownership;
- approve or reject claims (never their own — enforced by the API and by a database
  `CHECK` constraint);
- database-backed statistics and the audit log;
- account listing.

**System**

- validates every request and enforces authorization on the server;
- generates and persists candidate matches;
- performs multi-step status changes inside transactions with row locking;
- creates notifications and audit records for key events.

## 3. Architecture and technology stack

```text
┌─────────────────────────────────────────────┐
│                React + Vite UI              │
│ Reports • Search • Matches • Claims • Admin │
└──────────────────────┬──────────────────────┘
                       │ HTTPS / JSON REST (Authorization: Bearer <JWT>)
┌──────────────────────▼──────────────────────┐
│             Node.js + Express API            │
│ Routes • Validation • Auth/RBAC • Services   │
│ Error handling • Notifications • Audit       │
└─────────────┬────────────────────┬──────────┘
              │ parameterised SQL  │ public fields only
┌─────────────▼────────────┐  ┌────▼─────────────────┐
│ PostgreSQL + PostGIS     │  │ Matching Service     │
│ Relational records       │  │ Rules + optional AI  │
│ Constraints and indexes  │  │ similarity adapter   │
└──────────────────────────┘  └──────────────────────┘
```

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React 18 + Vite 6 (JavaScript, JSX) | UI, client routing, form validation |
| Styling | Plain responsive CSS, one file with design tokens | Accessible, consistent presentation |
| Backend | Node.js 22 + Express 4 (ES modules) | REST API, business logic, authorization |
| Database | PostgreSQL 17 | Relational system of record |
| Spatial | PostGIS 3.6 | Geographic types, distance queries, GiST index |
| Text search | `pg_trgm` | Trigram similarity + GIN index for keyword search |
| Driver | `pg` 8 | Connection pooling, parameterised queries |
| Validation | `zod` | Server-side request validation |
| Auth | `jsonwebtoken` + `bcryptjs` | JWT sessions, bcrypt password hashing |
| Security | `helmet`, `cors`, `express-rate-limit` | Headers, CORS allow-list, rate limits |
| Uploads | `multer` + magic-byte sniffing | Validated, inert image storage |
| Testing | `node:test` + `supertest` | Unit and API tests against the real database |
| Logging | `morgan` | Request logs without bodies or tokens |

Full detail: [`docs/architecture.md`](./docs/architecture.md).

## 4. Prerequisites

Verified versions (this is the configuration the project was built and tested with):

| Requirement | Verified version | Notes |
|---|---|---|
| Node.js | **22.19.0** | 20.11 or newer is required (`node:test`, `--import`, `fetch`) |
| npm | **10.9.3** | npm workspaces are used |
| PostgreSQL | **17.6** | 13 or newer works; 14+ recommended |
| PostGIS | **3.6.2** | Must be installed into the PostgreSQL instance |
| `pg_trgm` | bundled with PostgreSQL | Created by migration 001; ships with PostgreSQL core |
| OS | Windows 10/11 (primary), Linux/macOS expected to work | See [§20](#20-known-limitations) |

No Docker is required. An optional `docker-compose.yml` is provided for developers
who prefer containers.

## 5. PostgreSQL and PostGIS setup

### 5.1 Confirm the server is running

```powershell
Get-Service -Name "*postgres*"          # Windows
# or: sudo systemctl status postgresql  # Linux
```

The default port is `5432`.

### 5.2 Install PostGIS

PostGIS is a separate package; enabling the extension fails until it is installed on
the server. The extension files appear in the PostgreSQL `share/extension` directory.

**Windows (EnterpriseDB build)**

1. Start **StackBuilder** (installed with PostgreSQL) or download the bundle for your
   PostgreSQL major version from <https://download.osgeo.org/postgis/windows/>.
   For PostgreSQL 17 the file is
   `postgis-bundle-pg17-3.6.2x64.zip` or `postgis-bundle-pg17x64-setup-3.6.2-1.exe`.
2. Install it into `C:\Program Files\PostgreSQL\17` (the installer does this; the zip
   must be copied into `bin`, `lib`, `share`, `gdal-data` and `utils`).
   Files are copied with administrator rights. An existing PostgreSQL DLL that is in
   use is kept rather than replaced.
3. No service restart is needed for an add-only copy; restart if the installer asks.

**Linux (Debian/Ubuntu)**

```bash
sudo apt install postgresql-17-postgis-3
```

**Verify:**

```bash
psql -U postgres -c "SELECT name FROM pg_available_extensions WHERE name IN ('postgis','pg_trgm');"
```

Both names must be listed.

### 5.3 Create the databases and a connection

The project uses two databases: one for development and one that the test suite
truncates between files.

```bash
# from the repository root, after .env is configured:
npm run db:create
```

That command creates the databases named in `DATABASE_URL` and `TEST_DATABASE_URL`
by connecting to the `postgres` maintenance database. Manually, it is:

```sql
CREATE DATABASE smart_lost_found;
CREATE DATABASE smart_lost_found_test;
```

`CREATE EXTENSION postgis` requires a superuser the first time, so the example
configuration uses the `postgres` superuser. For production, create a
least-privilege application role and enable PostGIS once as a superuser (see
[§16](#16-security-and-privacy)).

### 5.4 Psql client

`psql` ships with PostgreSQL and is usually at
`C:\Program Files\PostgreSQL\17\bin\psql.exe` on Windows. Add that directory to `PATH`
to use it directly.

## 6. Environment configuration

Copy the example file and edit it:

```bash
cp .env.example .env          # Windows: Copy-Item .env.example .env
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | – | `development` | `development` \| `test` \| `production` |
| `PORT` | – | `4000` | API port |
| `CLIENT_ORIGIN` | – | `http://localhost:5173` | CORS allow-list, comma-separated |
| `DATABASE_URL` | **yes** | – | PostgreSQL connection string for the API |
| `TEST_DATABASE_URL` | for tests | – | Separate database used only by the suite |
| `JWT_SECRET` | **yes** | – | Signing secret (≥ 16 chars; ≥ 32 in production) |
| `JWT_EXPIRES_IN` | – | `1d` | Token lifetime |
| `UPLOAD_DIR` | – | `uploads` | Upload directory, relative to the repository root |
| `MAX_UPLOAD_MB` | – | `5` | Per-file upload limit |
| `MATCH_RADIUS_METERS` | – | `1500` | Spatial component radius and candidate filter |
| `MATCH_MAX_DAYS` | – | `30` | Time window either side of a report's event time |
| `MATCH_MIN_SCORE` | – | `40` | Minimum overall score persisted as a suggestion |
| `MATCH_CANDIDATE_LIMIT` | – | `200` | Maximum candidate pairs examined per report |
| `MATCH_WEIGHT_*` | – | `0.35/0.20/0.25/0.20` | attribute, time, spatial, ai weights |
| `AI_PROVIDER` | – | `disabled` | `disabled` \| `openai` |
| `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `AI_TIMEOUT_MS` | if AI enabled | – | Provider configuration |
| `RATE_LIMIT_*` | – | production 10/300 | Auth and API limits per window |
| `TRUST_PROXY` | – | `false` | Set to `true` only behind a reverse proxy |
| `LOG_REQUESTS` | – | `true` | Request logging |

**Important:** a password containing `@`, `:`, `/` or spaces **must be
percent-encoded** inside `DATABASE_URL`. For example a password `P@ss word` becomes
`P%40ss%20word`:

```env
DATABASE_URL=postgresql://postgres:P%40ss%20word@localhost:5432/smart_lost_found
```

Generate a strong secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Configuration is validated at startup. The server refuses to start in production
with a placeholder `JWT_SECRET` or the example database password.

The client reads its own optional configuration from `client/.env`
(see `client/.env.example`). It defaults to a relative `/api/v1` path, which works
with the Vite dev proxy and behind a reverse proxy.

## 7. Installation

```bash
# 1. Install dependencies for the root, server and client (npm workspaces)
npm install

# 2. Configure the environment
cp .env.example .env      # then edit DATABASE_URL, TEST_DATABASE_URL and JWT_SECRET

# 3. Create the databases
npm run db:create

# 4. Apply the schema
npm run db:migrate

# 5. Load categories and fictional demo data
npm run db:seed

# 6. Start the API and the client together
npm run dev
```

Then open <http://localhost:5173>.

### Demo accounts

Created by `npm run db:seed`. All data is fictional. Password for every account:
**`Password123`**

| Email | Role |
|---|---|
| `admin@campus.test` | administrator |
| `ada@campus.test` | student |
| `alan@campus.test` | student |
| `grace@campus.test` | student |
| `linus@campus.test` | student |

The seed also creates 8 reports around a fictional campus location with private
verification hints, generates 14 candidate matches **using the real matching
service**, and submits one pending claim so the administrator queue is not empty.

## 8. Database migrations and seed data

| Command | Purpose |
|---|---|
| `npm run db:create` | Create the dev and test databases if missing |
| `npm run db:migrate` | Apply pending migrations (each in its own transaction) |
| `npm run db:status` | Show applied and pending migrations, and orphaned records |
| `npm run db:seed` | Load categories and fictional demo data (idempotent) |
| `npm run db:setup` | `db:create` + `db:migrate` + `db:seed` |
| `npm run db:reset` | **Drop `schema public` and re-apply every migration** (refuses when `NODE_ENV=production`) |
| `npm run db:rollback` | Alias of `db:reset`; migrations are forward-only, so there are no down files |
| `npm run db:explain` | `EXPLAIN ANALYZE` walkthrough on 100 000 synthetic rows, **rolled back** |
| `npm run api:smoke` | 69 live HTTP checks against a running server |
| `npm run admin:create -- --email=… --name="…"` | Create the first administrator on a hosted database (no demo data) |
| `npm run test:setup` | Apply migrations to the **test** database |
| `npm run test:reset` | Reset the test database schema and re-apply |

All commands accept `--env=test` to target the test database.

### Migrations

`database/migrations/` is the only source of schema truth:

| File | Contents |
|---|---|
| `001_init_extensions.sql` | `postgis`, `pgcrypto`, `pg_trgm` |
| `002_helpers.sql` | `fn_set_updated_at()` |
| `003_users.sql` | Accounts, email normalisation, role check |
| `004_categories.sql` | Category lookup |
| `005_items.sql` | Lost/found reports, spatial column, status-transition trigger |
| `006_item_images.sql` | Image metadata with MIME/size checks |
| `007_item_private_details.sql` | 1:0..1 access-restricted verification hint |
| `008_matches.sql` | Candidate pairs, score bounds, report-type trigger |
| `009_claims.sql` | Claims, self-review and review-consistency checks |
| `010_notifications.sql` | In-app notifications |
| `011_audit_logs.sql` | Append-only audit trail |
| `012_indexes.sql` | B-tree, GiST, GIN and partial indexes |
| `013_views_and_functions.sql` | `v_public_items`, `v_pending_claims`, `v_item_match_stats`, `fn_items_within_radius`, `fn_search_items` |
| `014_search_index_tuning.sql` | Replaces the un-indexable `similarity()` filter with index-supported `%`/`ILIKE` |

`schema_migrations` records a version, filename, SHA-256 checksum and duration for
each applied migration. **Editing an applied migration is refused**, so schema
changes are always new files — `014` is a worked example of that discipline.

`server/src/scripts/seed.js` runs the SQL files in `database/seeds/` first
(the canonical category list, upserted) and then creates demo data. It skips demo
reports when any already exist, so re-running is safe.

## 9. Running the application

```bash
npm run dev          # API on :4000 and Vite dev server on :5173 together
npm run dev:server   # API only (node --watch)
npm run dev:client   # client only
npm start            # API without watch, for a deployment
npm run build        # production client bundle in client/dist
npm run preview      # serve the built client locally
```

The Vite dev server proxies `/api` and `/uploads` to `http://localhost:4000`, so the
browser sees a single origin. Set `VITE_DEV_API_TARGET` to point the proxy elsewhere.

Check the API:

```bash
curl http://localhost:4000/api/v1/health
curl "http://localhost:4000/api/v1/health?db=1"     # includes the database check
```

## 10. Testing, linting and building

```bash
npm run test              # 169 tests, Node's test runner + supertest
npm run test:coverage     # same with a coverage report
npm run lint              # ESLint over server, client, database and tests
npm run lint:fix
npm run format            # Prettier
npm run build             # production client build
```

Before the first test run (and after adding a migration):

```bash
npm run db:create
npm run test:setup
```

The suite runs against the **real** PostgreSQL/PostGIS test database: real
constraints, real triggers, real GiST index. Only the external AI network boundary is
injected. Test files run with `--test-concurrency=1` and truncate tables between
files, so `TEST_DATABASE_URL` must never point at a database holding real data.

Additional verification helpers:

```bash
npm run db:explain                              # query-plan walkthrough (rolled back)
npm run api:smoke                               # 69 live HTTP checks against a running server
psql -U postgres -d smart_lost_found -f database/scripts/sanity-check.sql   # constraint/trigger demo
```

`database/scripts/sanity-check.sql` prints 14 `ERROR:` lines on purpose: each one is
a constraint or trigger correctly refusing invalid data. It runs in a transaction
that is rolled back, so it is safe against any database.

See [`docs/test-plan.md`](./docs/test-plan.md) for the full traceability of every
acceptance criterion to the test that proves it, and for what is **not** automated.

## 11. Frontend pages

| Route | Page | Access |
|---|---|---|
| `/items` | Browse and search reports with filters, sorting, pagination | public |
| `/items/:itemId` | Report details, images, candidate matches, claim form, owner controls | public (extra fields for the owner/admin) |
| `/login`, `/register` | Sign in / create an account | public |
| `/report/lost` | Report a lost item (with optional photo) | authenticated |
| `/report/found` | Report a found item (with private verification detail) | authenticated |
| `/dashboard` | Counters, my reports, best matches, my claims, notifications, system status | authenticated |
| `/my-items` | All my reports, including deleted ones on request | authenticated |
| `/matches` | Ranked candidate matches with score breakdowns and dismissal | authenticated |
| `/claims` | My claims, with withdrawal | authenticated |
| `/notifications` | In-app notifications, unread filter, mark read | authenticated |
| `/admin` | Administrator dashboard with real database counters | admin |
| `/admin/items` | Report moderation with a recorded reason | admin |
| `/admin/claims` | Claim review queue; approve/reject with a reason | admin |
| `/admin/audit` | Filterable audit log | admin |
| `/admin/users` | Account listing | admin |

UI behaviour: responsive layouts (desktop and mobile), field-level validation with
server error messages, loading/empty/success/error states everywhere, confirmation
before destructive actions, keyboard-accessible controls with visible focus, a skip
link, `fieldset`/`legend` grouping and `aria-*` attributes. Private verification data
and claim evidence are never rendered because the API never sends them.

## 12. API reference

Complete reference with request/response examples, error codes and the tests that
cover each route: [`docs/api-reference.md`](./docs/api-reference.md).

Base path `/api/v1`. Highlights:

```
POST   /auth/register              POST   /auth/login          GET   /auth/me
GET    /items                      GET    /items/:itemId       POST  /items
PATCH  /items/:itemId              PATCH  /items/:itemId/status
DELETE /items/:itemId              POST   /items/:itemId/images
GET    /users/me/items             GET    /categories
GET    /matches                    GET    /items/:itemId/matches
POST   /matches/:matchId/dismiss   POST   /matches/recalculate
POST   /items/:itemId/claims       GET    /claims/me          POST /claims/:claimId/withdraw
GET    /admin/claims               PATCH  /admin/claims/:claimId
GET    /notifications              PATCH  /notifications/:notificationId/read
GET    /admin/items                PATCH  /admin/items/:itemId/moderation
GET    /admin/audit-logs           GET    /admin/stats       GET  /admin/users
GET    /health
```

Every response uses a consistent envelope:

```json
{ "data": …, "meta": { "page": 1, "limit": 20, "total": 42 } }
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ … ] } }
```

## 13. Database design, ER diagram and DBMS concepts

- **ER diagram:** [`docs/er-diagram.mmd`](./docs/er-diagram.mmd) (Mermaid) — entities,
  keys, constraints and cardinalities, matching the implemented SQL.
- **Full design notes:** [`docs/database-design.md`](./docs/database-design.md) —
  tables, 3NF reasoning and justified denormalisation, deletion behaviour, every
  `CHECK`, the three triggers, views and functions, the index inventory, measured
  query plans, transactions and concurrency, and the spatial design.

### DBMS concepts implemented (spec §20)

| Concept | Where |
|---|---|
| Relational modelling and **normalisation (3NF)** | 9 tables; category and reporter referenced rather than repeated; two documented denormalisations |
| **Primary keys** | `*_id` identity columns on every table |
| **Foreign keys** with intentional deletion rules | `RESTRICT` for reports/claims, `CASCADE` for dependent data, `SET NULL` for audit actors |
| **Unique constraints** | normalized `users.email`, `categories.name`, `item_private_details.item_id`, `item_images.storage_key`, `matches(lost_item_id, found_item_id)`, plus the partial unique index that makes duplicate active claims impossible |
| **`NOT NULL`, `CHECK`, defaults** | Length bounds, enumerations, score ranges, `(status IN ('approved','rejected')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)`, `reviewed_by <> claimant_id` |
| Referential integrity | Enforced by the database, demonstrated by `database/scripts/sanity-check.sql` |
| **One-to-many / one-to-one / many-to-many** | user→items; items→images; item→private-details (1:0..1); items↔items through `matches` (many-to-many self-referencing association) |
| **Joins** | Inner (public view, claim and match reads), self (matching engine), `LEFT JOIN` (audit actors, optional hints), `CROSS JOIN` with a CTE |
| **Subqueries and aggregates** | Correlated counters in profile/admin statistics; `COUNT`/`MAX`/`COUNT(*) FILTER (WHERE …)` in `v_item_match_stats` |
| **Window functions** | `COUNT(*) OVER ()` in `fn_search_items` returns the page and the total in one round trip |
| **Sorting, filtering, pagination** | `fn_search_items` with bounded `LIMIT`/`OFFSET` |
| **Transactions, rollback, ACID** | Report creation, report update, claim submission, claim decision, withdrawal and moderation each run in one transaction; `withTransaction()` in `config/db.js` |
| **Concurrency and duplicate-request handling** | `SELECT … FOR UPDATE` row locks plus the partial unique index; tested with two racing writers |
| **B-tree indexes** | Type, status, category, event time, reporter, claimant, reviewer, plus partial indexes for open reports, pending claims and unread notifications |
| **GiST index** | `items_location_gist_idx` on the spatial column |
| **GIN indexes** | Trigram indexes on title/description; JSONB index on `match_reasons` |
| **Partial / covering indexes** | `WHERE deleted_at IS NULL`, `WHERE status = 'pending'`, `WHERE is_read = FALSE`, ranked-match covering index |
| **PostGIS spatial types, distance and radius queries** | `geography(Point,4326)`, `ST_DWithin`, `ST_Distance`, KNN `<->` ordering; all in metres |
| **Query planning and optimisation with `EXPLAIN ANALYZE`** | `npm run db:explain`; produced a real optimisation (migration 014) and documents where a sequential scan is the correct choice |
| **Views, functions, triggers with a documented purpose** | 3 views, 5 functions, 8 triggers |
| **Audit logging and data lifecycle** | Append-only `audit_logs`; soft deletion via `items.deleted_at` so claim and audit history survives |
| **Secure parameterised database access** | Every query uses `$n` placeholders; dynamic SQL assembles structure from a fixed column set only |

## 14. Matching algorithm and scoring

Candidate selection is done in SQL with index support, scoring in JavaScript.

**1. Candidate selection** (`findCandidates()`):

- opposite `report_type` only (lost ↔ found);
- both reports still `open` or `matched`;
- soft-deleted reports excluded;
- `event_time` within `MATCH_MAX_DAYS` either side (default 30);
- when both reports have coordinates, `ST_DWithin` limits candidates to
  `MATCH_RADIUS_METERS` (default 1500), using the GiST index;
- bound by `MATCH_CANDIDATE_LIMIT` (default 200).

**2. Component scores, each 0–100**

| Component | Rule |
|---|---|
| `attribute_score` | Weighted mean of: category (40 %) — 100 if equal else 0; title/description text (30 %) — blended trigram (60 %) and token Jaccard (40 %) similarity; colour (15 %) — 100 exact, 60 same colour group (grey≈silver), 50 substring, else 0; brand (15 %) — 100 exact, 70 substring. Sub-components with missing data on either side are **dropped and the remaining sub-weights re-normalised**, so a report without a colour is not penalised. |
| `time_score` | `100 × (1 − hours apart / maxHours)`, clamped. 100 at the same time, 0 at the window edge. |
| `spatial_score` | `100 × (1 − distanceMeters / radiusMeters)`, clamped. `null` when either report has no location. |
| `ai_score` | Only when a provider is configured **and returns a number**. Never fabricated. |

**3. Overall score**

```
overall = Σ(weight_i × score_i) / Σ(weight_i)      over AVAILABLE components
defaults: attribute 0.35 · time 0.20 · spatial 0.25 · ai 0.20
```

Unavailable components are removed and the remaining weights re-normalised, so the
absence of AI or of coordinates does not deflate a score. The weights actually used
are stored inside `match_reasons` for transparency.

**4. Persistence**

- Upsert on the unique `(lost_item_id, found_item_id)` pair, so concurrent
  recalculations cannot create duplicates.
- `match_status` is never downgraded: a dismissed/claimed/resolved match keeps its
  state across recalculations.
- Only pairs scoring at least `MATCH_MIN_SCORE` (default 40) are stored; a previously
  *suggested* match that drops below the threshold is removed, while human-reviewed
  statuses are never deleted.
- New pairs create notifications for both reporters; each reporter is notified once.
- Every reason set ends with a `score_notice` stating that a score ranks candidates
  and does not prove ownership.

**5. Recalculation** happens automatically when a report is created or edited, and
can be requested with `POST /api/v1/matches/recalculate` (own reports, a single
report, or the whole database for administrators).

**Documented bounds and caveats:** scores are 0–100 and deterministic for the same
inputs and configuration. They are starting weights, not validated probabilities.
AI similarity is advisory and never decides ownership — every claim is reviewed by a
human administrator.

## 15. Optional AI provider and fallback behaviour

The application is fully functional with `AI_PROVIDER=disabled` (the default). Match
scores then use the deterministic components only, and every stored match records an
`ai_disabled` reason.

To enable semantic text similarity:

```env
AI_PROVIDER=openai
AI_API_KEY=sk-…
AI_MODEL=text-embedding-3-small
AI_TIMEOUT_MS=5000
AI_BASE_URL=https://api.openai.com/v1
```

The adapter posts to the documented `/embeddings` endpoint, compares the two
embeddings by cosine similarity and contributes the result as the AI component.
Failures (missing key, HTTP error, timeout, malformed response) **never throw**: they
resolve to `score: null`, the AI component is dropped, weights are re-normalised and
matching continues.

Only **public** item text (title and description) is transmitted. Private verification
hints and claim evidence are never sent.

Setup, cost and privacy notes, the exact request shape, and how to add another
provider: [`docs/ai-provider.md`](./docs/ai-provider.md).

## 16. Security and privacy

Summary (full detail in [`docs/security.md`](./docs/security.md)):

- Passwords hashed with **bcrypt** (cost 12); a database `CHECK` prevents a
  short/plaintext hash from ever being stored.
- **JWT** sessions in the `Authorization` header — never in a URL. The account is
  re-loaded on every request, so deactivation takes effect immediately.
- **Authorization on the server** for every protected route: role checks, ownership
  checks, participant checks, and a database constraint preventing an administrator
  from reviewing their own claim.
- **Parameterised SQL everywhere**; no query concatenates user input.
- **All input validated** with zod: emails, enumerations, dates, coordinates, radius,
  text lengths, pagination bounds.
- **Uploads treated as untrusted**: MIME allow-list, magic-byte verification, size
  limit, generated filenames, stored outside the source tree, served inert.
- **Never returned:** password hashes, `claims.private_evidence`, tokens, secrets,
  connection strings, stack traces or SQL.
- **Access-restricted:** `items.verification_hint` — returned only to the report's
  owner and to administrators (in the claim queue and the admin report detail).
- Public reads go through `v_public_items`, which cannot return private details,
  making that leak a structural impossibility rather than a coding convention.
- CORS allow-list (never `*`), helmet security headers, 100 kB body limit, strict
  rate limits on authentication endpoints.
- **Audit trail** of 16 action types with allow-listed, non-secret metadata.
- **AI never decides ownership** and receives only public text.

Documented trade-offs and residual risks, including `localStorage` token storage and
the absence of refresh-token revocation, are listed in
[`docs/security.md`](./docs/security.md) §12.

**Production hardening:** enable PostGIS once as a superuser, then run the application
as a dedicated least-privilege role that owns the application tables but is not a
superuser; serve over HTTPS behind a reverse proxy with `TRUST_PROXY=true`; store
secrets in a secret manager; move uploads to object storage.

## 17. Backup and recovery

The database is the only stateful component (uploads are a separate, replaceable
directory).

**Back up**

```bash
# Plain SQL (portable, human-readable)
pg_dump -U postgres -Fp -f backups/smart_lost_found_$(date +%F).sql smart_lost_found

# Custom format (compressed, restorable selectively with pg_restore)
pg_dump -U postgres -Fc -f backups/smart_lost_found_$(date +%F).dump smart_lost_found
```

Include the PostGIS schema: `pg_dump` writes `CREATE EXTENSION postgis`, and restoring
into a database that already has PostGIS is safe. Use
`utils/postgis_restore.pl` (shipped with PostGIS) only if you need to restore into a
database without PostGIS installed.

**Back up uploads separately**

```bash
tar -czf backups/uploads_$(date +%F).tar.gz uploads/
```

**Recover**

```bash
createdb -U postgres smart_lost_found          # or: npm run db:create
psql -U postgres -d smart_lost_found -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -U postgres -d smart_lost_found -f backups/smart_lost_found_YYYY-MM-DD.sql
# or: pg_restore -U postgres -d smart_lost_found --clean --if-exists backups/….dump
tar -xzf backups/uploads_YYYY-MM-DD.tar.gz
```

After a restore, confirm the state:

```bash
npm run db:status      # migrations recorded and complete
npm run test           # optional: the suite runs against TEST_DATABASE_URL
```

**Practice and cadence**

- Take a backup before every migration or seed reset (`npm run db:reset` is
  destructive to schema, not to data, but a backup removes all doubt).
- Keep daily backups and test a restore at least once — an untested backup is an
  assumption.
- `backups/` is git-ignored because a dump contains personal data. Never commit one.

**Point-in-time recovery** (production): enable WAL archiving
(`wal_level = replica`, `archive_mode = on`, `archive_command = …`) so you can restore
to a moment before an incident, not just to the last nightly dump.

## 18. Deployment notes

A full free-tier deployment guide covering Supabase, Render and Vercel — including
the Supabase `extensions`-schema requirement and the image-storage limitation — is
in [`docs/deployment.md`](./docs/deployment.md).

1. Build the client: `npm run build` → static assets in `client/dist`.
2. Run the API with `NODE_ENV=production npm start` (no watch mode).
3. Serve `client/dist` as static files and reverse-proxy `/api` and `/uploads` to the
   API. A single-origin deployment means no CORS configuration is needed.
4. Set `CLIENT_ORIGIN` to the real origin, `TRUST_PROXY=true` behind the proxy, and
   enable HTTPS. Run migrations as a release step: `npm run db:migrate`.
5. Do not run `db:seed` in production — it creates demo accounts with a known password.
6. Object storage for uploads and a shared rate-limit store are required for
   multi-instance deployments (see [§20](#20-known-limitations)).

## 19. Repository structure

```text
smart-lost-found/
├── README.md                     this file
├── PROJECT_SPEC.md               authoritative requirements
├── OPENCODE_INSTRUCTIONS.md      implementation workflow
├── .env.example                   configuration template (no real secrets)
├── .gitignore
├── eslint.config.js  .prettierrc.json  .editorconfig
├── docker-compose.yml             optional PostgreSQL + PostGIS container
├── package.json                   npm workspaces + all scripts
├── docs/
│   ├── architecture.md            components, layering, request lifecycle
│   ├── database-design.md         schema, normalisation, indexes, transactions
│   ├── er-diagram.mmd             Mermaid ER diagram
│   ├── api-reference.md           every endpoint with examples
│   ├── ai-provider.md             optional AI setup and fallback
│   ├── security.md                controls, trade-offs, residual risks
│   └── test-plan.md               criteria → tests, results, gaps
├── database/
│   ├── migrations/                001…014, the only schema source of truth
│   ├── seeds/001_categories.sql   canonical category list
│   └── scripts/
│       ├── lib/env.js             shared config loading for DB scripts
│       ├── migrate.js             migration runner (transactions + checksums)
│       ├── create-databases.js    create the dev/test databases
│       ├── seed.js (server/src/scripts/seed.js)  demo data via real services
│       ├── explain.js             EXPLAIN ANALYZE walkthrough (rolled back)
│       ├── sanity-check.sql       constraint/trigger/spatial demonstration
│       └── smoke-api.js           69 live HTTP checks
├── server/
│   ├── src/
│   │   ├── config/                env validation, pool, withTransaction()
│   │   ├── middleware/            auth, validation, uploads, rate limit, errors
│   │   ├── modules/               auth, items, matches, claims, notifications, admin, health
│   │   ├── services/              matching, spatial, notifications, audit
│   │   ├── integrations/ai/       provider adapter (disabled + openai)
│   │   ├── utils/                 errors, envelopes, pagination, password, jwt, geo, text
│   │   ├── scripts/seed.js        development seed
│   │   ├── app.js  server.js      Express assembly and bootstrap
│   │   └── routes/index.js        versioned /api/v1 router
│   └── tests/                     6 suites, 169 tests
├── client/
│   ├── index.html  vite.config.js
│   └── src/
│       ├── api/                   fetch client + endpoint wrappers
│       ├── context/               AuthContext
│       ├── hooks/                 useAsyncData
│       ├── components/            Navbar, guards, cards, filters, pagination, feedback
│       ├── pages/                 15 pages
│       └── styles/index.css
└── uploads/                       git-ignored, created at runtime
```

## 20. Known limitations

These are real and are stated rather than hidden:

1. **No email verification, password reset or multi-factor authentication.**
   Permitted by `PROJECT_SPEC.md` §4.2; required before real-world use.
2. **No refresh tokens or server-side token revocation.** Logout is client-side; a
   stolen unexpired token remains valid until it expires.
3. **Claim private evidence is never returned by any endpoint.** Administrators judge
   ownership from the claim message plus the finder's verification hint. This is the
   conservative reading of spec §16 and is documented in `docs/security.md` §3.
4. **Uploads are stored on the local filesystem** and are not virus-scanned. The
   `storage_key` indirection isolates a move to object storage.
5. **Rate limiting is per IP and in-process**; multiple instances need a shared store.
6. **No automated browser (end-to-end) test suite.** The UI was verified manually with
   browser automation against the live API; there is no committed Playwright suite, so
   the client has no regression net.
7. **No load testing.** Concurrency was tested for correctness, not throughput.
8. **No geographic map view.** Coordinates are entered and displayed as numbers;
   coordinates are documented as `latitude, longitude` in decimal degrees (WGS84).
   A campus map is listed under future scope.
9. **Matching has no semantic embeddings unless a provider is configured**, and no
   image similarity is implemented — image matching is explicitly out of scope for
   the initial version.
10. **No multi-campus tenancy.** One deployment serves one campus location.
11. **Only Windows was exercised end-to-end.** The code uses `path.join`/`path.resolve`
    throughout, but Linux and macOS were not run.
12. **`spatial_ref_sys`** is a PostGIS-owned table and appears in `information_schema`
    listings; it is not part of the application schema.

## 21. Future enhancements

From `PROJECT_SPEC.md` §21 and the design work above:

- real image embeddings for visual matching;
- semantic text embeddings enabled by default with an embedding cache;
- campus map integration with a map picker for report locations;
- email/SMS notification delivery;
- QR-based item handover confirmation;
- multi-campus support (a `campus_id` on reports, with per-campus roles);
- administrative analytics (recovery rate, median time to return, category hotspots);
- advanced duplicate-report detection using the existing trigram indexes;
- deployment to managed PostgreSQL/PostGIS with object storage;
- refresh-token rotation and `HttpOnly` cookie sessions;
- a Playwright end-to-end suite and an automated accessibility audit.

## 22. Verification status

Verified on this machine (Node 22.19.0, npm 10.9.3, PostgreSQL 17.6, PostGIS 3.6.2,
Windows 11).

| Check | Command | Result |
|---|---|---|
| Migrations from an empty schema | `npm run db:migrate -- --reset` | **14/14 applied**, PostGIS 3.6.2 enabled |
| Seed | `npm run db:seed` | 5 users, 8 reports, **14 matches generated by the real engine**, 1 claim, 1 notification |
| Seed idempotency | `npm run db:seed` again | demo reports skipped, categories upserted, no duplicates |
| Automated tests | `npm run test --workspace server` | **169 tests, 169 pass, 0 fail, 0 skipped** |
| Lint | `npx eslint .` | **0 problems** |
| Client build | `npm run build --workspace client` | success (60 modules; ~245 kB JS, ~18 kB CSS pre-gzip) |
| Query planning | `npm run db:explain` | **7 of 7 index expectations met**; the `similarity()` counter-example correctly shows a sequential scan |
| Constraint and trigger demo | `psql -f database/scripts/sanity-check.sql` | every expected failure raised, every expected success passed, rolled back |
| Live API smoke | `node database/scripts/smoke-api.js` | **69 checks passed, 0 failed** |
| Spatial behaviour | `tests/spatial.test.js` | 26 m point inside a 500 m radius, excluded at 5 m; distances in metres; GiST index confirmed usable |
| Claim concurrency | `tests/claims.test.js` | two racing submissions → one `201` + one `409`; two racing decisions → one `200` + one `409` |
| Transaction atomicity | `tests/claims.test.js` | a refused self-review leaves no item, claim, notification or audit change |
| UI against the real API | browser automation | browse/search, item detail, login, dashboard (2 reports, 1 claim, 8 matches, PostGIS 3.6.2 reported), claim queue showing the verification hint while withholding private evidence, and a claim approval that set the item to `returned` with `closed_at` |

Not verified here: Linux/macOS execution, load behaviour, and a live call to an
external AI provider (the adapter's success, error and timeout paths are covered by
injected-fetch tests instead). See `docs/test-plan.md` §7.

**Documentation** required by `PROJECT_SPEC.md` §19 is in [`docs/`](./docs):
architecture, database design, ER diagram, API reference, test plan, security, and AI
provider setup.
