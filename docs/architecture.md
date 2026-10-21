# Architecture

## 1. Components

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
              │ parameterised SQL  │ adapter calls (public fields only)
┌─────────────▼────────────┐  ┌────▼─────────────────┐
│ PostgreSQL + PostGIS     │  │ Matching Service     │
│ Relational records       │  │ Rules + optional AI  │
│ Constraints and indexes  │  │ similarity adapter   │
└──────────────────────────┘  └──────────────────────┘
```

## 2. Layering on the server

Requests flow in one direction; each layer has one job.

```
HTTP request
  └─ middleware/auth.js        authenticate → load account → req.user
  └─ middleware/rateLimit.js   per-IP limits (strict on auth routes)
  └─ middleware/validate.js    zod schema → 422 with field-level details
  └─ middleware/upload.js      multer + magic-byte sniffing
  └─ modules/*/*.routes.js     route table: path, authorization, controller
  └─ modules/*/*.service.js    business rules, SQL, transactions
  └─ middleware/errorHandler.js  one JSON error shape, SQL error translation
```

| Directory | Responsibility |
|---|---|
| `src/config/` | `env.js` validates configuration at startup; `db.js` owns the pool, the parameterised `query()` helper and `withTransaction()`. |
| `src/middleware/` | Cross-cutting concerns: authentication, authorization, validation, uploads, rate limits, error handling, 404. |
| `src/modules/` | One folder per feature (`auth`, `items`, `matches`, `claims`, `notifications`, `admin`, `health`) with routes/controller/service/validation. |
| `src/services/` | Shared domain services: `matching.service.js`, `spatial.service.js`, `notification.service.js`, `audit.service.js`. |
| `src/integrations/ai/` | The optional provider adapter (see §5). |
| `src/utils/` | Pure helpers: HTTP errors, response envelopes, pagination, password hashing, JWT, geo maths, text similarity. |
| `src/scripts/seed.js` | Development seed that reuses the real services. |
| `tests/` | The automated suite (`node:test` + supertest). |

**Rules kept throughout**

- Only `config/db.js` talks to PostgreSQL, and only through `$n` placeholders.
- Matching logic never imports Express; HTTP never contains scoring maths.
- A service receives a transaction `client` or creates its own; it never assumes
  which.

## 3. Client structure

```
client/src/
├── api/client.js       fetch wrapper, ApiError, token storage, asset URLs
├── api/endpoints.js    one function per documented endpoint
├── context/            AuthContext (session restore via GET /auth/me)
├── hooks/useAsyncData  loading / error / abort handling for every page
├── components/         Navbar, guards, ItemCard, MatchCard, ClaimCard,
│                       ItemFilters, Pagination, Badges, Feedback
├── pages/              one page per route (see README for the list)
└── styles/index.css    design tokens + responsive rules, one file
```

The two API modules are the only place URLs are written, so the client cannot
drift from the documented contract.

## 4. Request lifecycle examples

**Report a found item** (`POST /api/v1/items`)

1. `authenticate` verifies the JWT and loads the account (a deactivated account is
   rejected immediately).
2. `validate` coerces and checks the body; latitude/longitude must be supplied
   together or not at all.
3. The service opens a transaction and calls `matching.recalculateForItem()`
   **with the same client**, so the report, its private hint, its audit record and
   its first candidate matches commit together.
4. The matching engine shortlists candidates with an indexed SQL query, scores
   them in JavaScript, and upserts each pair.
5. New pairs create notifications for both reporters. Match reasons never contain
   private data.

**Approve a claim** (`PATCH /api/v1/admin/claims/:claimId`)

1. `authenticate` → `requireAdmin` (server-side role check).
2. `validate` requires `decision` and, for a rejection, a `reviewReason`.
3. The service locks the claim `FOR UPDATE`, rejects an already-decided claim with
   409, and refuses self-review with 403 (the database enforces the same rule).
4. In one transaction it sets the claim, marks the item `returned`, rejects the
   competing pending claims, resolves the related matches, notifies every affected
   user and writes the audit record.

## 5. Matching engine and AI boundary

The engine is deterministic and lives in `server/src/services/matching.service.js`.
Candidates are selected by SQL (type, status, time window, PostGIS radius), then
scored in JavaScript:

```
overall = Σ(weight_i × score_i) / Σ(weight_i)      over AVAILABLE components
```

- `attribute_score` = category 40 %, text 30 %, colour 15 %, brand 15 %
  (sub-components with missing data are dropped and the rest re-normalised)
- `time_score` = linear decay to 0 at the `MATCH_MAX_DAYS` window edge
- `spatial_score` = linear decay to 0 at `MATCH_RADIUS_METERS`
- `ai_score` = only when a provider is configured **and returns a number**

The AI provider is isolated behind `src/integrations/ai/`:

```
integrations/ai/
├── index.js              resolves the configured provider (AiProvider contract)
├── disabled.provider.js  the default; returns score: null (a real implementation)
└── openai.provider.js    factory + OpenAI /embeddings client, timeouts, fallback
```

A provider must never throw: `scoreTextPair()` resolves to `score: null` with a
reason, which makes the engine drop the AI component and re-normalise the weights.
The application is therefore fully functional with no AI configured, and an
unreachable provider degrades rather than fails.

Only public item attributes (title, description) are sent to a provider. Private
verification hints and claim evidence are never passed to it.

## 6. Security boundaries

| Boundary | Control |
|---|---|
| Browser → API | CORS allow-list, helmet headers, body size limits, per-IP rate limits |
| API → database | Parameterised SQL only, least-privilege-friendly role, constraints and triggers |
| API → AI provider | Public fields only, timeout, no-throw fallback, credentials from environment |
| Uploads → filesystem | Server-generated names, MIME allow-list, magic-byte verification, stored outside the source tree, served inert |
| Responses → client | Private data excluded structurally (views) and by mapping; no stack traces or SQL |

Details and the deliberate trade-offs are in [`security.md`](./security.md).

## 7. Configuration and environments

One `.env` at the repository root configures everything (see `.env.example`).
`config/env.js` validates it with zod at startup and refuses to boot with a
placeholder `JWT_SECRET` or example database password when `NODE_ENV=production`.

`NODE_ENV=test` switches the connection to `TEST_DATABASE_URL` and disables rate
limiting, so the suite never touches development data.

## 8. Documented deviations from the suggested structure

`PROJECT_SPEC.md` §11 is a recommendation. The differences and why:

| Suggested | Implemented | Reason |
|---|---|---|
| `server/src/modules/{auth,users,items,matches,claims,admin}` | `auth`, `items`, `matches`, `claims`, `notifications`, `admin`, `health` | `users` has no standalone resource beyond `/auth/me` and `/users/me/items`, which live in their natural modules; `notifications` and `health` are specified endpoints and deserve a folder. |
| `database/seeds/` containing SQL only | SQL for categories, `server/src/scripts/seed.js` for demo data | Demo users need bcrypt hashes and demo matches must be produced by the *real* matching service; hand-written fixtures would drift from the implementation. |
| `docs/api-reference.md` or OpenAPI | `docs/api-reference.md` | Written reference kept in step with the code; an OpenAPI file would be a second source of truth to maintain. |

Everything else (frontend/backend/database split, `services/`, `integrations/ai/`,
`utils/`, `database/migrations/`, `docs/`) matches the suggestion.
