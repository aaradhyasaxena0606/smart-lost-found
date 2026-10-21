# Database Design

PostgreSQL 17 with PostGIS 3.6 is the system of record. Everything the application
knows about accounts, reports, matches, claims, notifications and audits lives in
one relational schema, created and evolved only by the migrations in
`database/migrations/`.

- **Canonical schema:** `database/migrations/001` … `014`
- **Entity/relationship diagram:** [`er-diagram.mmd`](./er-diagram.mmd)
- **Live schema dump:** run `npm run db:status` for applied migrations

---

## 1. Tables and their purpose

| Table | Purpose | Rows created by |
|---|---|---|
| `users` | Accounts. Students and administrators share one table, distinguished by `role`. | registration API |
| `categories` | Category lookup so item categories are not repeated as free text. | seed |
| `items` | Both **lost** and **found** reports, discriminated by `report_type`. | report API |
| `item_images` | Optional photos for a report. | image upload API |
| `item_private_details` | Access-restricted ownership verification hint, at most one per report. | report API |
| `matches` | Candidate lost/found pairs with explainable component scores. | matching engine |
| `claims` | Ownership claims for found items and their administrative review. | claim API |
| `notifications` | In-app notifications for workflow events. | notification service |
| `audit_logs` | Append-only audit trail. | audit service |
| `schema_migrations` | Migration bookkeeping (version + SHA-256 checksum). | migration runner |

### Why lost and found share `items`

A lost report and a found report have identical attributes; only the meaning
differs. Keeping one table means:

- the matching engine is a self-join on `report_type <> report_type`, which needs
  no union of two near-identical tables;
- constraints, indexes and audit rules are written once;
- the discriminated union is enforced in the database by
  `items_report_type_chk` (`CHECK (report_type IN ('lost','found'))`).

---

## 2. Normalization

The schema is in **third normal form**; two deliberate, documented deviations
exist.

### 3NF reasoning

- Every table has a single-column surrogate primary key, so there are no partial
  dependencies.
- Non-key attributes depend on the key, the whole key and nothing but the key:
  - `items.category_id` references `categories` rather than repeating the
    category **name**, which removes a transitive dependency
    (`item → category_id → category name`). A category rename therefore cannot
    create an inconsistency.
  - `items.reporter_id` references `users` rather than repeating the reporter's
    name and email.
  - `claims.item_id` and `claims.claimant_id` are references, not copies.
- `item_private_details` is split out of `items` for two reasons: it is a
  **1:0..1** relationship, and it must be impossible to return it accidentally.
  Splitting it makes the leak a *structural* impossibility rather than a coding
  convention: the public read path goes through `v_public_items`, which does not
  join that table at all.

### Justified denormalization

1. **`matches.attribute_score`, `time_score`, `spatial_score`, `ai_score`,
   `overall_score`** are stored although they are derived from the two items.
   They are a deliberate materialization: the match score must be stable and
   auditable at the moment it was shown to a user, and recomputing it on every
   read would be both slow and non-reproducible. `matches.match_reasons` records
   the inputs (category, colour, brand, hours apart, metres apart, weights used),
   so the stored score can always be explained and re-derived.
2. **`items.location_name` alongside `items.location`** keeps the human label
   ("Main Library, Level 2") that users typed, separate from the machine
   coordinates. They are independent facts, not duplicates, so this is not a
   redundancy at all — but it is documented here because both describe "where".

Everything else derives from its base tables.

---

## 3. Constraints and referential integrity

### Keys

- Primary key on every table (`*_id`).
- Unique: `users.email` (normalized), `categories.name`,
  `item_private_details.item_id` (enforces 1:0..1), `item_images.storage_key`,
  `matches (lost_item_id, found_item_id)` (prevents duplicate candidate pairs).

### Foreign keys and deletion behaviour

Deletion behaviour is chosen per relationship rather than defaulted:

| Relationship | Rule | Why |
|---|---|---|
| `items.reporter_id → users` | `ON DELETE RESTRICT` | A person's reports must be resolved, not silently orphaned. |
| `items.category_id → categories` | `ON DELETE RESTRICT` | Categories are reference data. |
| `item_images.item_id → items` | `ON DELETE CASCADE` | An image has no meaning without its report. |
| `item_private_details.item_id → items` | `ON DELETE CASCADE` | Same. |
| `matches.*_item_id → items` | `ON DELETE CASCADE` | A match is derived data. |
| `claims.item_id → items` | `ON DELETE RESTRICT` | Claim history must survive. |
| `claims.claimant_id → users` | `ON DELETE RESTRICT` | Same. |
| `claims.reviewed_by → users` | `ON DELETE SET NULL` | Keep the decision, lose the actor link. |
| `notifications.user_id → users` | `ON DELETE CASCADE` | Personal inbox. |
| `audit_logs.actor_user_id → users` | `ON DELETE SET NULL` | The audit record must outlive the account. |

**Reports are never hard-deleted by the application.** `items.deleted_at` is a
soft-delete marker; every public query excludes those rows, while claim history
and audit history stay intact. `DELETE /api/v1/items/:itemId` sets the marker.

### `CHECK` constraints worth calling out

| Constraint | Rule |
|---|---|
| `users_email_normalized_chk` | `email = lower(email)` — the database itself refuses `Ada@Campus.test` when `ada@campus.test` exists. |
| `users_password_hash_len_chk` | `char_length(password_hash) >= 20` — a guard against ever storing a plaintext or truncated password. |
| `items_title_len_chk`, `items_description_len_chk` | Length bounds mirror the API validation. |
| `items_status_chk` | The lifecycle vocabulary. |
| `items_closed_at_chk` | `closed_at IS NULL OR closed_at >= created_at`. |
| `matches_*_score_chk` | Every component and the overall score are `0..100`. |
| `matches_reasons_array_chk` | `jsonb_typeof(match_reasons) = 'array'`. |
| `claims_no_self_review_chk` | `reviewed_by IS NULL OR reviewed_by <> claimant_id` — **an administrator cannot review their own claim.** |
| `claims_review_consistency_chk` | `(status IN ('approved','rejected')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)` — a decided claim always has a reviewer and a timestamp; a pending one never does. |
| `claims_reject_reason_chk` | A rejected claim always records a reason. |
| `item_images_mime_chk`, `item_images_size_chk` | Only raster image types, at most 10 MB. |

### Status values: `CHECK` rather than enum

Both are legitimate; this project uses `CHECK` constraints with `VARCHAR` and
documents the choice:

- adding a value is an ordinary migration and does not need `ALTER TYPE`;
- the constraint reads like the requirement;
- PostgreSQL enums give marginally better storage but make reordering and removal
  awkward, and `CHECK` is portable.

Three status vocabularies exist:

- item: `open`, `matched`, `claimed`, `returned`, `closed`, `rejected`
- match: `suggested`, `dismissed`, `claimed`, `resolved`
- claim: `pending`, `approved`, `rejected`, `withdrawn`

### Triggers (three, each with a documented purpose)

| Trigger | Purpose |
|---|---|
| `trg_*_set_updated_at` | Maintains `updated_at` on `UPDATE` so manual SQL and future clients stay consistent. |
| `trg_items_validate_status_transition` | Rejects an illegal `items.status` transition (`fn_validate_item_status_transition`). The backend validates the same matrix for friendly errors; the trigger makes the rule impossible to bypass from raw SQL or seeds. |
| `trg_matches_validate_report_types` | Guarantees a match always pairs one `lost` report with one `found` report (`fn_validate_match_report_types`), which a plain foreign key cannot express. |

Legal item transitions:

```
open     -> matched | claimed | closed | rejected
matched  -> claimed | returned | closed | rejected
claimed  -> returned | closed | open
returned -> closed
closed   -> open
rejected -> open | closed
```

---

## 4. Views and functions

| Object | Purpose | Private data? |
|---|---|---|
| `v_public_items` | The single public projection of a report: joins reporter and category, exposes coordinates as plain `latitude`/`longitude`, and **structurally cannot** return `item_private_details`. | Excluded by construction |
| `v_pending_claims` | Administrator queue joining claims, items and users. | Exposes the item verification hint (needed for review); never `claims.private_evidence` |
| `v_item_match_stats` | Per-report aggregates (`COUNT`, `MAX`, `FILTER`) for dashboards. | No private data |
| `fn_items_within_radius()` | Reusable indexed radius search in metres. | No |
| `fn_search_items()` | The canonical report search: filters, relevance, radius and window-count pagination in one query. | No |
| `fn_set_updated_at()`, `fn_validate_item_status_transition()`, `fn_validate_match_report_types()` | Trigger helpers. | — |

Using `v_public_items` for public reads means a future endpoint cannot leak private
data by forgetting a filter — the column simply is not there.

---

## 5. Indexing strategy

See `database/migrations/012_indexes.sql` for the definitions and
`014_search_index_tuning.sql` for the follow-up. Each index maps to a query the
application actually issues.

| Index | Type | Serves |
|---|---|---|
| `items_location_gist_idx` | **GiST** | `ST_DWithin` radius search and nearest-first ordering |
| `items_title_trgm_idx`, `items_description_trgm_idx` | **GIN** (`pg_trgm`) | Keyword search with `ILIKE` and the `%` similarity operator |
| `items_report_type_created_idx` | B-tree, partial | Public listing filtered by type, newest first |
| `items_status_idx`, `items_category_idx`, `items_event_time_idx` | B-tree, partial | The documented list filters |
| `items_open_match_idx` | B-tree, partial | The matching engine's candidate lookup (open/matched reports by type + category + time) |
| `items_reporter_idx` | B-tree | "My reports" |
| `items_colour_idx`, `items_brand_idx` | B-tree on `lower(colour/brand)`, partial | Case-insensitive attribute filters |
| `claims_active_unique_idx` | **Unique**, partial | At most one active claim per (item, claimant) — the race-safe duplicate guard |
| `claims_pending_idx` | B-tree, partial | Administrator queue ordered by age |
| `claims_item_idx`, `claims_claimant_idx`, `claims_reviewer_idx` | B-tree | Claim joins and filters |
| `matches_pair_key` | Unique | Prevents duplicate candidate pairs |
| `matches_ranked_idx` | B-tree, partial, covering | "Best suggested matches" |
| `matches_lost_idx`, `matches_found_idx`, `matches_status_idx`, `matches_reasons_gin` | B-tree / GIN | Match lookups and JSONB reason queries |
| `notifications_unread_idx` | B-tree, partial | Unread badge |
| `audit_logs_created_at_idx`, `audit_logs_actor_idx`, `audit_logs_entity_idx` | B-tree | Audit listing and filters |

Partial indexes are used wherever the query always carries the predicate
(`deleted_at IS NULL`, `status = 'pending'`), which keeps them small and hot.

### Measured plans (`npm run db:explain`)

The script loads 100,000 synthetic reports inside a **rolled-back transaction** and
runs `EXPLAIN ANALYZE` on the real query shapes. Measured on PostgreSQL 17.6 /
PostGIS 3.6.2 (Windows x64):

| Query shape | Index used | Result |
|---|---|---|
| Radius search (`ST_DWithin` + `<->` ordering) | `items_location_gist_idx` (Bitmap Index Scan) | PASS |
| Keyword on title (`ILIKE` OR `%`) | `items_title_trgm_idx` (Bitmap Index Scan) | PASS |
| Keyword on description (`ILIKE` OR `%`) | `items_description_trgm_idx` (Bitmap Index Scan) | PASS |
| `similarity(title, q) > 0.15` (counter-example) | **none — sequential scan** | See note |
| Public listing by type, newest first | `items_report_type_created_idx` (Index Scan) | PASS |
| Matching candidate lookup | `items_category_idx` (Index Scan; `items_open_match_idx` is also valid) | PASS |
| Pending claim queue | `claims_pending_idx` (Index Scan) | PASS |
| Best suggested matches | `matches_ranked_idx` (Index Scan) | PASS |

**The counter-example is a real optimisation result, not a failure.** Migration 013
originally filtered with `similarity(title, p_query) > 0.15`. `similarity()` is an
ordinary function call, so `gin_trgm_ops` cannot serve it and PostgreSQL scanned
every row. Migration 014 replaces that predicate with the index-supported
operators `%` and `ILIKE` and keeps `similarity()` only for *ranking*. This is why
the schema has a migration 014 at all.

A sequential scan is not automatically a defect: when a predicate matches a large
fraction of the table, scanning is genuinely cheaper than an index lookup. The
explain script reports what the planner chose instead of asserting an opinion.

---

## 6. Transactions and concurrency

Multi-step operations run inside one transaction with row-level locking
(`SELECT … FOR UPDATE`) so concurrent requests cannot produce inconsistent state.

| Operation | Steps kept atomic | Concurrency behaviour |
|---|---|---|
| Create report | insert report + private details + audit + initial matches | One transaction; a failure leaves nothing behind |
| Update report | update + private details + audit + match recalculation | Recalculation reuses the same transaction |
| Submit claim | lock item → check eligibility → insert claim → set item `claimed` → mark matches `claimed` → audit → notify | Two users may both claim; the same user claiming twice is stopped by `claims_active_unique_idx` (loser gets HTTP 409) |
| Approve/reject claim | lock claim → check pending → update claim → set item `returned`/`open` → reject competing claims → resolve matches → notify all parties → audit | Two administrators reviewing the same claim are serialised; the second sees `status <> 'pending'` and gets HTTP 409 |
| Withdraw claim | lock claim → set `withdrawn` → reopen item if no active claim → notify finder → audit | Same locking discipline |
| Moderation | lock item → validate transition → update → audit → notify | Same |

Verified by tests: `claims.test.js` posts two simultaneous identical claims (one
`201`, one `409`), two simultaneous admin decisions (one `200`, one `409`), and
asserts that a failed self-review leaves no notification and no audit row.

---

## 7. Spatial design

**Type:** `geography(Point, 4326)` on `items.location`.

**Axis order:** PostGIS uses `(x, y)`, i.e. **longitude first, latitude
second**. The API and the database both name the fields `latitude` and
`longitude`, and the swap happens in exactly one place per layer:

- SQL: `ST_MakePoint(longitude, latitude)`
- Node: `toGeographyParam()` in `server/src/utils/geo.js`

**Units:** `geography` computes on the WGS84 spheroid, so `ST_Distance` and
`ST_DWithin` return **metres** with no projection maths. A campus radius search
therefore needs no projected coordinate system.

**Index:** `items_location_gist_idx` (GiST) is what turns `ST_DWithin` into an
index lookup.

**Boundary behaviour:** `ST_DWithin` uses `<=`, so the radius is inclusive. Note
that it evaluates a spheroidal distance computed slightly differently from
`ST_Distance`; the two can differ by a fraction of a millimetre. The guarantee the
tests assert and the application relies on is:

- radius ≥ distance + 1 cm → included
- radius ≤ distance − 1 m → excluded

**Verified:** `spatial.test.js` asserts the extension version, the column type and
SRID via `geography_columns`, the existence and usability of the GiST index, that
`0.009°` of latitude measures ≈1000 m, that a point 26 m away is included in a
500 m radius, that it is excluded at 5 m, and that reports without coordinates are
handled gracefully (never returned by a radius search, still visible in a normal
listing).

---

## 8. Query patterns demonstrated

Representative SQL, all parameterised (`$1`, `$2`, …):

- **Multi-table joins** — `v_public_items` (items ⋈ users ⋈ categories),
  `CLAIM_SELECT` (claims ⋈ items ⋈ categories ⋈ users ⋈ users),
  `MATCH_SELECT` (matches ⋈ public items ×2 ⋈ items ×2).
- **Self-join** — the matching engine's candidate query pairs a report with its
  opposite type in one statement (`CROSS JOIN source`, `report_type = $1`).
- **Aggregates with `FILTER`** — `v_item_match_stats`
  (`COUNT(*) FILTER (WHERE match_status = 'suggested')`).
- **Window function** — `COUNT(*) OVER ()` in `fn_search_items` gives the
  unpaginated total in the same round trip as the page.
- **Correlated subqueries** — the account statistics in `authService.getProfile`
  and the counters in `GET /admin/stats`.
- **Left joins preserving history** — audit listing joins `users` with `LEFT JOIN`
  so records survive actor deletion; `listClaimQueue` uses a `LEFT JOIN` for the
  optional verification hint.
- **`ON CONFLICT … DO UPDATE`** — match upsert keyed on
  `(lost_item_id, found_item_id)`; `RETURNING (xmax = 0) AS inserted` distinguishes
  a new suggestion (which notifies) from a rescore (which does not).
- **`ANY($1::int[])`** — batching image and hint lookups to avoid N+1 queries.

**Parameterization:** no query in the codebase concatenates user input. Dynamic
filters are built as an ordered array of `$n` placeholders with a parallel values
array.

---

## 9. Reproducing the schema from scratch

```bash
npm run db:create      # create the dev and test databases
npm run db:migrate     # apply migrations 001..014
npm run db:seed        # categories + fictional demo data
npm run db:status      # show applied / pending migrations
npm run db:reset       # drop schema public and re-apply everything
npm run db:explain     # EXPLAIN ANALYZE walkthrough (rolled back)
```

The runner stores a SHA-256 checksum per migration and refuses to run if an
already-applied file has changed, so the database cannot silently drift from
version control. Schema changes are therefore always **new** files — see
`014_search_index_tuning.sql` for a worked example.
