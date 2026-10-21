# Test Plan and Results

## 1. How to run

```bash
npm run db:create        # create the dev and test databases (once)
npm run test:setup       # apply migrations to the TEST database (once, or after new migrations)
npm run test             # run the whole suite
npm run test:coverage    # same, with Node's coverage report

npm run lint             # ESLint over server, client, database and tests
npm run build            # production build of the React client
```

Requirements: a running PostgreSQL with PostGIS, and a `TEST_DATABASE_URL` in
`.env` that points at a **separate** database. The runner truncates tables between
test files, so it must never point at real data.

## 2. Harness

| Aspect | Choice |
|---|---|
| Runner | Node's built-in `node:test` (no extra framework) |
| HTTP | `supertest` against the real Express app — no network socket, no mocks |
| Database | The real PostgreSQL/PostGIS test database: real constraints, real triggers, real GiST index |
| Isolation | `--test-concurrency=1` and `TRUNCATE … RESTART IDENTITY CASCADE` before each file; the canonical category seed is reloaded |
| Environment | `NODE_ENV=test` is forced by `tests/helpers/load-test-env.js`, which the npm script also preloads with `--import`, so ordering cannot put the suite on the development database |
| Factories | `createUserViaApi`, `createUserDirect`, `createItemViaApi`, `getCategoryId`, `itemPayload` |

Because the suite runs against the real database, it exercises the schema itself:
`CHECK` constraints, foreign keys, the unique index that prevents duplicate claims,
and the triggers that guard status transitions and match orientation.

**Nothing is mocked except the external AI network boundary**, which is injected
through the provider factory so the fallback path can be tested without contacting a
third party.

## 3. Results

Last recorded run:

```
# tests  169
# suites  32
# pass   169
# fail     0
# skipped  0
```

| Test file | Tests | Covers |
|---|---|---|
| `tests/auth.test.js` | 21 | Registration, login, token validity/expiry/forgery, deactivated accounts, role enforcement, password change |
| `tests/items.test.js` | 48 | Report creation/update/status lifecycle, validation, search filters, sorting, pagination, soft delete, image uploads |
| `tests/spatial.test.js` | 11 | PostGIS installation, column type/SRID, GiST index existence and usability, metres, radius boundaries, missing coordinates |
| `tests/matching.test.js` | 34 | Candidate generation, same-type exclusion, duplicate prevention, score bounds and formula, recalculation, visibility, text helpers, AI adapter |
| `tests/claims.test.js` | 26 | Claim rules, duplicates, concurrency, withdrawal, review, competing claims, self-review prohibition, rollback, notifications, audit |
| `tests/admin.test.js` | 29 | Moderation queue and actions, audit filters, statistics, accounts, health, error envelopes |

Companion verification (also run, see §6):

```
npm run lint   -> 0 problems
npm run build  -> success (client bundle produced)
npm run db:explain -> 7 of 7 index expectations met
node database/scripts/smoke-api.js -> 69 passed, 0 failed (against a live server)
psql -f database/scripts/sanity-check.sql -> all expected failures raised, all expected successes passed
```

## 4. Acceptance criteria traceability

Every criterion in `PROJECT_SPEC.md` §18 and `OPENCODE_INSTRUCTIONS.md` §8, mapped
to the test that proves it.

### Authentication and authorization

| Criterion | Status | Evidence |
|---|---|---|
| Registration succeeds for valid input | Pass | `auth.test.js` "creates an account and returns a usable token" |
| Duplicate normalized email is rejected | Pass | `auth.test.js` "rejects a duplicate email differing only by case (normalized)" (`409`) |
| Invalid credentials are rejected | Pass | `auth.test.js` "rejects a wrong password with 401"; identical message for an unknown email |
| Passwords are stored as hashes | Pass | `auth.test.js` "stores the password only as a bcrypt hash" (asserts `$2` prefix and that the plaintext is absent) |
| Protected endpoints reject missing / invalid / expired tokens | Pass | `auth.test.js` "Protected endpoints" suite (missing, malformed, wrong-secret, expired, deleted account) |
| Normal users cannot access admin endpoints | Pass | `auth.test.js` "a normal user cannot reach administrator endpoints" (all five) |
| Normal users cannot modify others' reports | Pass | `items.test.js` update/delete/status/upload authorization cases |

### Reports and search

| Criterion | Status | Evidence |
|---|---|---|
| Valid reports can be created and updated per permissions | Pass | `items.test.js` create, owner update, admin update, forbidden update |
| Invalid fields are rejected | Pass | `items.test.js` short title/description, unknown type, unknown category, future date |
| Invalid coordinates are rejected | Pass | `items.test.js` latitude 120, longitude 400, latitude without longitude, radius without coordinates |
| Search filters work | Pass | `items.test.js` type, category, colour (case-insensitive), keyword, date window |
| Sorting works | Pass | `items.test.js` event-time sort; spatial sort asserted ascending in `spatial.test.js` |
| Pagination works | Pass | `items.test.js` page/limit, no overlap between pages, `limit` bounded at 100 |
| Private verification data never appears in public responses | Pass | `items.test.js` anonymous and other-user detail, listing; `matching.test.js` match reasons; `admin.test.js` claim queue |
| Upload type and size restrictions are enforced | Pass | `items.test.js` `.exe` rejected, spoofed PNG rejected, oversize `413`, generated filename |

### Spatial database

| Criterion | Status | Evidence |
|---|---|---|
| Migrations enable PostGIS | Pass | `spatial.test.js` asserts `postgis` (3.x) and `pg_trgm` are installed by migration 001 |
| Coordinates are stored in the chosen type, order documented | Pass | `spatial.test.js` `geography_columns` → `Point`, SRID 4326, dim 2; round-trip axis test; documented in `database-design.md` §7 |
| A spatial index exists and is documented | Pass | `spatial.test.js` asserts `items_location_gist_idx` is `USING gist`; usability proven with `EXPLAIN` under `enable_seqscan=off` |
| Radius queries include inside points and exclude outside points | Pass | `spatial.test.js` 26 m point inside a 500 m radius, excluded at 5 m; `distanceMeters` verified against an independent great-circle calculation |
| Boundary behaviour documented | Pass | `spatial.test.js` asserts inclusion at distance + 1 cm and exclusion at distance − 1 m; the sub-millimetre caveat is documented |
| Distances use appropriate units | Pass | `spatial.test.js` asserts 0.009° of latitude measures ≈1000 m |

### Matching

| Criterion | Status | Evidence |
|---|---|---|
| Compatible lost/found reports produce a candidate match | Pass | `matching.test.js` "a compatible lost/found pair produces a candidate match"; also observed in the live smoke run |
| Same-type pairs are excluded | Pass | `matching.test.js` "two reports of the same type never match each other"; plus the DB trigger test |
| Duplicate pairs are prevented | Pass | `matching.test.js` "recalculating twice does not create duplicate pairs" (asserts no pair has >1 row) |
| Scores stay within documented bounds | Pass | `matching.test.js` "all component and overall scores stay within 0-100" |
| The overall score follows the documented formula | Pass | `matching.test.js` weighted-mean tests, including re-normalisation with missing colour/brand and with no location |
| Matching works when AI is not configured | Pass | `matching.test.js` default provider is `disabled`; `ai_disabled` reason recorded; a failing provider still yields candidates |
| Match reasons do not expose private evidence | Pass | `matching.test.js` asserts the stored reasons contain neither hint |
| Report changes trigger or request recalculation | Pass | `matching.test.js` "updating a report recalculates its matches"; `POST /matches/recalculate` cases; a dismissed match is not resurrected |

### Claims and audit

| Criterion | Status | Evidence |
|---|---|---|
| Valid claims can be submitted | Pass | `claims.test.js` "submits a claim and moves the item to claimed" |
| Invalid or unauthorized claims are rejected | Pass | `claims.test.js` lost-item `400`, own-report `409`, short message `422`, unauthenticated `401` |
| Duplicate claims are rejected | Pass | `claims.test.js` duplicate `409`; **two simultaneous submissions return exactly one `201` and one `409`** |
| Only authorized administrators can approve/reject | Pass | `claims.test.js` non-admin `403`; `auth.test.js` admin route enforcement |
| An administrator cannot approve their own claim | Pass | `claims.test.js` `403` from the service **and** rejection of a direct `UPDATE` by `claims_no_self_review_chk` |
| Claim review and item status changes are atomic | Pass | `claims.test.js` approve → item `returned` + `closed_at`; two administrators racing produce exactly one decision |
| A failed review leaves no partial state | Pass | `claims.test.js` asserts the claim, the item, the notification count and the audit count are all unchanged after a `403` |
| Required notifications are created | Pass | `claims.test.js` claimant and finder notification assertions; `admin.test.js` moderation notification |
| Required audit records are created | Pass | `claims.test.js` reviewer recorded; `admin.test.js` moderation metadata; `auth.test.js` registration/login |
| Competing claims are handled | Pass | `claims.test.js` one approval rejects the rival with a reason |

### Delivery

| Criterion | Status | Evidence |
|---|---|---|
| Main pages use real API responses | Pass | Verified in a browser against the running API: browse, item detail, login, dashboard (2 reports / 1 claim / 8 matches / PostGIS 3.6.2), claim queue showing the verification hint and withholding private evidence, claim approval through the UI |
| Forms show validation errors and loading/empty/success/error states | Pass | Implemented in `components/Feedback.jsx` (`Loading`, `EmptyState`, `ErrorMessage`, `SuccessMessage`) and used by every page; field errors render from the API's `details` |
| A clean setup can be run from the README | Pass | The documented sequence was executed on this machine from an empty schema: `db:create` → `db:migrate` → `db:seed` → `dev` → `npm run test` |
| Migrations and seeds are repeatable or safely idempotent | Pass | `--reset` re-applies all 14 migrations cleanly; the checksum guard refuses edited migrations; the seed reports "already exist; demo reports were not created" on a second run |
| Tests and build commands are run and reported accurately | Pass | See §3 and §6 |

## 5. Concurrency and integrity tests

These are the cases that cannot be checked by reading code:

| Scenario | Method | Expected and observed |
|---|---|---|
| Same user submits the same claim twice simultaneously | `Promise.all` of two identical `POST /items/:id/claims` | exactly one `201` and one `409`; exactly one active row, enforced by `claims_active_unique_idx` |
| Two administrators decide the same claim simultaneously | `Promise.all` of an approve and a reject | exactly one `200` and one `409`; exactly one decision recorded |
| Recalculation runs twice | `recalculateForItem` twice | `created: 0` on the second pass; no pair has more than one row |
| Failed approval | Self-review attempt by the admin | claim still `pending`, item still `claimed`, no notification, no audit row |
| Illegal status transition | `open → returned` | `409` with `details.allowed`; the same is refused by the database trigger |

## 6. Commands run and their output

| Command | Result |
|---|---|
| `npm run db:create` | dev and test databases created (or reported as existing) |
| `npm run db:migrate -- --reset` | 14 migrations applied from an empty schema, PostGIS 3.6.2 restored |
| `npm run db:seed` | 5 users, 8 reports, 14 matches, 1 claim, 1 notification |
| `npm run db:seed` (second run) | reports skipped as already present (idempotent) |
| `node database/scripts/migrate.js --env=test --reset` | 14 migrations applied to the test database |
| `npm run test --workspace server` | **169 tests, 169 pass, 0 fail, 0 skipped** |
| `npx eslint .` | **0 problems** |
| `npm run build --workspace client` | success (60 modules, ~245 kB JS / ~18 kB CSS before gzip) |
| `npm run db:explain` | **7 of 7 index expectations met**; the `similarity()` counter-example correctly shows a sequential scan |
| `node database/scripts/smoke-api.js` | **69 checks passed, 0 failed** against the live API |
| `psql -f database/scripts/sanity-check.sql` | every expected failure raised and every expected success passed; transaction rolled back |

## 7. What is not covered by automation

Stated plainly so nothing is over-claimed:

1. **No end-to-end browser test suite.** The UI was verified manually with browser
   automation against the live API (and screenshots taken), but there is no
   committed Playwright/Cypress suite. Coverage of the client is therefore
   behavioural, not regression-proof.
2. **No visual-regression or accessibility-audit tooling** in CI. Accessibility was
   implemented deliberately (labels, `aria-*`, focus styles, skip link, native
   `dialog`, `fieldset`/`legend`) and checked by inspection, not by an automated
   axe run.
3. **The optional OpenAI provider is not tested against the real service.** Its
   success, HTTP-error and timeout paths are tested through the injected `fetchImpl`;
   no live API call is made, and none is required for the suite to pass.
4. **No load or soak testing.** Concurrency is tested for correctness (two racing
   writers), not for throughput.
5. **No test asserts exact query plans.** Plans depend on data volume and
   statistics; `explain.js` reports what the planner chose rather than asserting it.
6. **Windows-specific paths** were used for this run; the code uses `path.join` and
   `path.resolve` throughout, but the suite has not been executed on Linux or macOS.
