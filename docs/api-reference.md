# API Reference

Base path: **`/api/v1`** · Format: JSON · Authentication: `Authorization: Bearer <JWT>`

## Conventions

**Success envelope**

```json
{ "data": { }, "meta": { } }
```

`meta` is present on list endpoints:

```json
{
  "page": 1, "limit": 20, "total": 42, "totalPages": 3,
  "hasNextPage": true, "hasPreviousPage": false
}
```

**Error envelope** (identical for every failure)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid or missing fields.",
    "details": [{ "field": "title", "message": "String must contain at least 3 character(s)" }]
  }
}
```

**Status codes**

| Code | Used for |
|---|---|
| `200` | Successful read or update |
| `201` | Resource created (with `Location`) |
| `204` | Deleted, no body |
| `400` | Semantically invalid request (unknown category, illegal report type change, malformed JSON) |
| `401` | Missing, invalid or expired token; bad credentials |
| `403` | Authenticated but not permitted (role or ownership); deactivated account |
| `404` | Not found, or not visible to the caller |
| `409` | Conflict (duplicate email, duplicate claim, illegal transition, already-decided claim) |
| `413` | Upload or body too large |
| `422` | Validation failure with field details |
| `429` | Rate limited |
| `500` | Unexpected server error (no internal detail is exposed) |
| `503` | Database unavailable on the health check |

**Rate limits:** authentication endpoints are limited per IP; the whole API has a
second, looser limit. Production defaults are 10 and 300 requests per 15 minutes;
development defaults are 1000 and 10000 so the suite is not throttled. Configurable
with `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_API_MAX`, `RATE_LIMIT_WINDOW_MINUTES`.

**Privacy rules applied everywhere**

- `password_hash` is never returned by any endpoint.
- `items.verification_hint` appears only in `GET /admin/items/:itemId` and in the
  administrator claim queue — never in a public response.
- `claims.private_evidence` is **never** returned, not even to administrators
  (only `hasPrivateEvidence: true|false`).

---

## Authentication

### `POST /auth/register`

Create an account. _Public, rate limited._

```json
{ "fullName": "Ada Lovelace", "email": "ada@campus.test", "password": "Password123" }
```

Rules: `fullName` 2–120 chars; a valid email (stored lower-cased); password 8–128
chars with at least one letter and one digit.

`201` → `{ "data": { "user": { … }, "token": "…" } }`

Errors: `409` duplicate normalized email · `422` invalid fields.
Tests: `tests/auth.test.js` (duplicate case-insensitive email, weak passwords, no
hash in the response, hash actually stored).

### `POST /auth/login`

```json
{ "email": "ada@campus.test", "password": "Password123" }
```

`200` → `{ "data": { "user": { … }, "token": "…" } }`

Errors: `401` wrong password, unknown email (identical message, so accounts cannot
be enumerated), deactivated account.
Tests: `tests/auth.test.js`.

### `GET /auth/me`

_Authenticated._ `200` → profile plus `stats: { itemCount, claimCount, unreadNotificationCount }`.

Errors: `401` missing/invalid/expired token · `403` deactivated account.

### `POST /auth/change-password`

```json
{ "currentPassword": "Password123", "newPassword": "NewPassword456" }
```

`200` → `{ "data": { "changed": true } }` · `401` wrong current password.

---

## Items

### `GET /items`

_Public (a token is optional)._ Searchable, paginated, public-safe listing.

| Parameter | Type | Notes |
|---|---|---|
| `type` | `lost` \| `found` | |
| `categoryId` | integer | |
| `status` | item status | |
| `colour`, `brand` | string | case-insensitive exact match |
| `q` | string | matches title/description by substring or trigram similarity |
| `from`, `to` | ISO date | filters `event_time` |
| `latitude`, `longitude` | number | must be supplied together |
| `radiusMeters` | number | 1–200000; requires coordinates |
| `sort` | `recent` \| `relevance` \| `distance` \| `event_time` | default `recent` |
| `page`, `limit` | integer | `limit` ≤ 100, default 20 |

`200` → array of items. Items with coordinates include `distanceMeters` when
coordinates were supplied.

Item shape:

```json
{
  "itemId": 1, "reportType": "lost", "title": "…", "description": "…",
  "colour": "black", "brand": "Apple", "eventTime": "…", "locationName": "…",
  "location": { "latitude": 51.5007, "longitude": -0.1246 },
  "status": "open",
  "category": { "categoryId": 2, "name": "Mobile Phone" },
  "reporter": { "userId": 2, "fullName": "Ada Lovelace" },
  "createdAt": "…", "updatedAt": "…", "closedAt": null,
  "images": [{ "imageId": 1, "imageUrl": "/uploads/…png", "mimeType": "image/png", "altText": "…", "uploadedAt": "…" }],
  "distanceMeters": 26.23
}
```

Errors: `422` invalid coordinates, radius, page or limit · `400` `radiusMeters`
without coordinates.
Tests: `tests/items.test.js` (all filters, sorting, pagination, bounded limit, no
private data, soft-deleted rows excluded), `tests/spatial.test.js` (radius
inclusion/exclusion, units, boundary).

### `GET /items/:itemId`

_Public (a token is optional)._ `200` → one item, plus:

- `privateDetails: { hasVerificationHint, verificationHint }` **only** when the
  caller is the reporter or an administrator;
- `matchSummary: { matchCount, suggestedCount, bestScore }`.

Errors: `404` unknown (or soft-deleted, unless the caller is an administrator) ·
`422` non-numeric id.

### `POST /items`

_Authenticated._

```json
{
  "reportType": "lost", "categoryId": 2, "title": "…", "description": "…",
  "colour": "black", "brand": "Apple", "eventTime": "2026-10-01T10:00:00.000Z",
  "locationName": "Main Library", "latitude": 51.5007, "longitude": -0.1246,
  "verificationHint": "private detail only the owner would know"
}
```

`201` → the created item (with its initial `matchSummary`). Candidate matches are
generated inside the same transaction.

Errors: `400` unknown category or an event time more than 24 h in the future ·
`422` any field bound · `401` unauthenticated.
Tests: `tests/items.test.js`, `tests/matching.test.js`.

### `PATCH /items/:itemId`

_Owner or administrator._ Any subset of the create fields. `latitude: null` and
`longitude: null` clear the location; `verificationHint: null` deletes the private
detail.

`200` → the updated item. Matches are recalculated in the same transaction.

Errors: `403` not owner/admin · `400` change of `reportType`, or editing a
`returned`/`closed` report as a non-admin · `409` conflict · `422` empty body.

### `PATCH /items/:itemId/status`

_Owner or administrator (only administrators may set `rejected`)._

```json
{ "status": "closed" }
```

`200` → the updated item. `closed_at` is set for `returned`/`closed`/`rejected`.

Errors: `409` illegal transition, with `details.allowed` listing legal targets ·
`403` not owner/admin, or a non-admin requesting `rejected` · `422` unknown status.

### `DELETE /items/:itemId`

_Owner or administrator._ Soft delete: `204`, no body. The row remains for claim
and audit history.

Errors: `409` active claim exists or already deleted · `403` not owner/admin.

### `POST /items/:itemId/images`

_Owner or administrator._ `multipart/form-data`, field name **`image`**.

Acceptance: JPEG, PNG or WebP, ≤ `MAX_UPLOAD_MB` (default 5 MB), verified by MIME
type **and** file header. Stored under a generated `randomUUID()` filename.

`201` → `{ "data": { "imageId": 1, "imageUrl": "/uploads/<uuid>.png", "storageKey": "…", "mimeType": "image/png", "byteSize": 1024 } }`

Errors: `400` disallowed type or content that does not match the declared type ·
`413` too large · `403` not owner/admin.
Tests: `tests/items.test.js` (real PNG accepted, `.exe` rejected, spoofed PNG
rejected, oversize rejected, filename sanitised, deletion removes the file).

### `DELETE /items/:itemId/images/:imageId`

_Owner or administrator._ `204` and the stored file is removed.

### `GET /users/me/items`

_Authenticated._ The caller's own reports. Parameters: `type`, `status`,
`includeDeleted`, `page`, `limit`. Soft-deleted reports are included only when
`includeDeleted=true`.

### `GET /categories`

_Public._ `200` → `[{ categoryId, name, description, itemCount }]`.

---

## Matches

### `GET /matches`

_Authenticated._ Matches where the caller is the reporter of either side.
Parameters: `status`, `itemId`, `page`, `limit`.

```json
{
  "matchId": 1, "overallScore": 86.15, "matchStatus": "suggested",
  "scores": { "attribute": 86.06, "time": 99.93, "spatial": 98.25, "ai": null },
  "reasons": [ { "code": "category_match", "label": "Same category", "detail": "Mobile Phone", "weight": 0.4, "value": 100 } ],
  "distanceMeters": 26.2, "createdAt": "…", "updatedAt": "…",
  "lostItem": { "itemId": 1, "reportType": "lost", "title": "…", "isMine": true, "location": { … } },
  "foundItem": { "itemId": 2, "reportType": "found", "title": "…", "isMine": false, "location": { … } }
}
```

### `GET /items/:itemId/matches`

_Reporter of that item or an administrator._ Same shape. `403` otherwise.

### `POST /matches/:matchId/dismiss`

_Reporter of either side or an administrator._ `200` → the match with
`matchStatus: "dismissed"`. A recalculation will not resurrect it.

Errors: `400` only `suggested` matches can be dismissed · `403` not a participant ·
`404` unknown match.

### `POST /matches/recalculate`

_Authenticated._ Body `{}` recalculates the caller's own open reports. Body
`{ "itemId": 5 }` recalculates one report (owner or admin). Body
`{ "all": true }` recalculates the entire database (**admin only**, `403`
otherwise).

`200` → `{ "data": { "itemId"?, "itemsProcessed"?, "scanned", "created", "updated", "removed", "skipped" } }`

---

## Claims

### `POST /items/:itemId/claims`

_Authenticated, for a `found` report the caller did not create._

```json
{
  "claimMessage": "This is my phone: the screen protector is cracked in the top-left.",
  "privateEvidence": "IMEI ends 4471 — stored but never returned"
}
```

`201` → the claim (never the evidence):

```json
{
  "claimId": 4, "status": "pending", "claimMessage": "…", "hasPrivateEvidence": true,
  "item": { "itemId": 2, "title": "…", "reportType": "found", "status": "claimed", "categoryName": "Mobile Phone" },
  "claimant": { "userId": 2, "fullName": "Ada Lovelace", "email": "…" },
  "review": { "reviewedBy": null, "reviewerName": null, "reviewedAt": null, "reviewReason": null },
  "createdAt": "…", "updatedAt": "…"
}
```

Side effects in one transaction: the item becomes `claimed`, the item's suggested
matches become `claimed`, the finder is notified, an audit row is written.

Errors: `400` not a found report · `409` claiming your own report, or an
already-active claim · `409` item not claimable in its current status · `422`
message below 10 characters.
Tests: `tests/claims.test.js` (including two simultaneous submissions → exactly one
`201`).

### `GET /claims/me`

_Authenticated._ Parameters `status`, `page`, `limit`. Never returns private
evidence.

### `POST /claims/:claimId/withdraw`

_Claimant (or an administrator)._

`200` → the claim with `status: "withdrawn"`. If no other claim is active, the item
returns to `open` and its matches return to `suggested`.

Errors: `403` not your claim · `409` already decided.

### `GET /admin/claims`

_Administrator._ Review queue. Parameters: `status`, `includeDecided`, `itemId`,
`page`, `limit`. Pending claims first (oldest first). Each entry additionally has
`itemVerificationHint` (the reviewer's basis for judging ownership). **Never
includes `privateEvidence`.**

### `GET /admin/claims/:claimId`

_Administrator._ One claim with `itemVerificationHint`.

### `PATCH /admin/claims/:claimId`

_Administrator._

```json
{ "decision": "approved", "reviewReason": "Ownership details matched." }
```

`200` → the decided claim.

Side effects in one transaction when **approved**: the item becomes `returned`,
every other pending claim for the item becomes `rejected` (with a reason), related
matches become `resolved`, the claimant and finder are notified, other claimants
are notified, and an audit row is written. When **rejected**: the item reopens to
`open` only if no other claim is active, and the claimant is notified with the
reason.

Errors: `403` reviewing your own claim · `409` already decided (also returned when
two administrators race) · `422` rejection without a `reviewReason` · `404`
unknown claim.
Tests: `tests/claims.test.js` (approve, reject, competing claims, double review,
concurrent decisions, rollback leaving no partial state).

---

## Notifications

### `GET /notifications`

_Authenticated._ Parameters `unreadOnly`, `page`, `limit`. `meta` additionally
contains `unreadCount`.

### `GET /notifications/unread-count`

_Authenticated._ `200` → `{ "data": { "unreadCount": 6 } }`.

### `PATCH /notifications/:notificationId/read`

_Authenticated._ `200` → `{ notificationId, isRead: true }`. `404` when the
notification does not belong to the caller.

### `PATCH /notifications/read-all`

_Authenticated._ `200` → `{ "data": { "updated": 6 } }`.

---

## Administration and health

| Endpoint | Access | Notes |
|---|---|---|
| `GET /admin/items` | admin | Moderation queue. Parameters `type`, `status`, `reporterId`, `includeDeleted`, `page`, `limit`. Adds `hasPrivateDetails`, `matchCount`, `suggestedCount`, `pendingClaims`. Does not include the hint itself. |
| `GET /admin/items/:itemId` | admin | Full detail **including** `privateDetails.verificationHint`, plus all claims (messages only, never evidence). |
| `PATCH /admin/items/:itemId/moderation` | admin | `{ "action": "approve"\|"reject"\|"close", "reason": "…" }`. `reason` is required for `reject`. Obeys the item lifecycle. Writes an audit row and notifies the reporter. `409` illegal transition · `400` already in that status or deleted. |
| `GET /admin/audit-logs` | admin | Parameters `actorUserId`, `action`, `entityType`, `entityId`, `from`, `to`, `page`, `limit`. Newest first, with `actorName`. |
| `GET /admin/stats` | admin | Real counters: users, items by type, returned, matches, claims, PostGIS version. |
| `GET /admin/users` | admin | Parameters `role`, `isActive`, `page`, `limit`. Never returns password hashes. |
| `GET /health` | public | Liveness plus matching weights and AI provider status. Add `?db=1` for a database readiness check (name, PostGIS version, latency). Returns `503` with `status: "degraded"` when the database is unreachable. Never reveals connection strings or credentials. |

Tests: `tests/admin.test.js`, `tests/auth.test.js` (role enforcement on every
admin route).

---

## Coverage map

| Test file | Covers |
|---|---|
| `tests/auth.test.js` | Registration, login, token validity/expiry/forgery, deactivation, role enforcement, password change |
| `tests/items.test.js` | Report creation/update/status rules, validation, search filters, sorting, pagination, soft delete, image uploads |
| `tests/spatial.test.js` | PostGIS setup, column type/SRID, GiST index existence and usability, metres, radius boundaries, missing coordinates |
| `tests/matching.test.js` | Candidate generation, same-type exclusion, duplicate prevention, score bounds and formula, recalculation triggers, visibility/authorization, text helpers, AI adapter |
| `tests/claims.test.js` | Claim submission rules, duplicates, concurrency, withdrawal, review, competing claims, self-review prohibition, atomic rollback, notifications, audit |
| `tests/admin.test.js` | Moderation queues and actions, audit filters, stats, account listing, health, consistent error envelopes |
