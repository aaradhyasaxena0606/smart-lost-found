# Security and Privacy

This document states what is protected, how, and where the deliberate trade-offs
are. Every claim here is implemented in code and, where testable, asserted by the
automated suite.

---

## 1. Authentication

| Control | Implementation |
|---|---|
| Password storage | `bcryptjs` with cost 12 in development/production, 4 in tests. Hashes are verified in constant time. `users_password_hash_len_chk` refuses anything under 20 characters, so a plaintext password cannot be stored even by mistake. |
| Password policy | 8–128 characters, at least one letter and one digit. Enforced server-side by zod and mirrored in the UI. |
| Session token | JWT signed with `HS256` from `JWT_SECRET`, `sub` = user id, `role` claim, issuer `smart-lost-found`, expiry from `JWT_EXPIRES_IN` (default `1d`). |
| Token transport | `Authorization: Bearer <token>` only. A token is never placed in a URL, query string or log. |
| Revalidation | `authenticate` re-loads the account on **every** request, so deactivating a user takes effect immediately, and a deleted account's unexpired token stops working. |
| Session expiry | `exp` is honoured; an expired token returns `401` with `"session has expired"`. |
| Account enumeration | Login returns the same `401` message for an unknown email and a wrong password. Registration necessarily reveals that an email is taken (`409`), which is documented as a deliberate usability trade-off. |

### Token storage trade-off (documented, as required by spec 16)

The client keeps the JWT in `localStorage` under `sllf.token`. `localStorage` is
readable by any script on the origin, so a cross-site scripting flaw would expose
the session. The alternative — an `HttpOnly`, `Secure`, `SameSite=Strict` cookie —
removes that exposure but introduces CSRF, which then needs its own defence.

The choice is `localStorage` because:

- the session must survive a page reload, which the assignment requires;
- the application renders no user-supplied HTML (React escapes by default) and
  serves uploaded files as inert images, which removes the main XSS vector;
- it can be replaced without touching the API, since the token is added to exactly
  one `fetch` wrapper.

Hardening steps for a real deployment: move to an `HttpOnly` cookie with CSRF
tokens, shorten expiry and add refresh-token rotation.

---

## 2. Authorization

Authorization is enforced on the server for every protected route; the client-side
guards exist only for navigation (`docs/architecture.md` §2).

| Layer | Mechanism |
|---|---|
| Authentication required | `authenticate` middleware on every non-public route |
| Role required | `requireAdmin` on everything under `/admin` and `/admin/claims` |
| Ownership required | `requireItemAccess` resolves the report and rejects a non-owner non-admin with `403` (or `404` for a soft-deleted report) before the controller runs; services re-check inside the transaction because they lock the row |
| Participant required | `requireMatchAccess` for match dismissal; claim withdrawal checks `claimant_id` |
| Self-review prohibited | `decideClaim` rejects a reviewer equal to the claimant (`403`) **and** `claims_no_self_review_chk` makes it impossible at the database level |
| Query scoping | "my" endpoints filter on the authenticated id; notifications are always scoped by `user_id`, so one user cannot read or mark another's |

Verified by tests: normal users receive `403` on all five administrator endpoints;
a user gets `403` when editing, deleting, changing status, uploading to or
dismissing matches on someone else's report; a non-participant gets `403` on
`GET /items/:id/matches`; a user's notification cannot be marked read by another.

---

## 3. Data exposure

**Never returned by any endpoint:** `users.password_hash`, `claims.private_evidence`,
`JWT_SECRET`, database credentials, connection strings, stack traces, SQL.

**Access-restricted:** `items.verification_hint`.

### Structural exclusion of private verification data

The public read path goes through the `v_public_items` view, which does not join
`item_private_details` at all. A public response therefore *cannot* leak it — this
is a property of the query, not a filter someone has to remember. `GET /items/:itemId`
adds the hint only for the reporter (their own report) or an administrator.

### Deliberate decision: administrators see the hint, never the claim evidence

Reviewing a claim requires comparing what the claimant described against what the
finder recorded. The finder's `verification_hint` is therefore returned **only** in
the administrator claim queue and `GET /admin/items/:itemId`.

`claims.private_evidence` is returned by **no** endpoint at all, including
administrator ones, because spec §16 lists private claim evidence among the things
that must never be returned. Administrators see `hasPrivateEvidence: true|false` and
rely on the claim message plus the verification hint. The UI repeats this so a
reviewer is not left wondering where the evidence went.

Verified by tests: public item responses, listings and match responses are asserted
not to contain the hint; the claim queue is asserted to contain the hint but not the
evidence; audit metadata is asserted not to contain evidence.

### Other leakage controls

- `helmet` sets `X-Content-Type-Options`, `X-Frame-Options`, HSTS and a
  restrictive CSP.
- `x-powered-by` is disabled.
- Uploaded files are served with `Content-Disposition: inline`,
  `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: cross-origin`;
  they are never executed as content.
- The health endpoint reports only a boolean, the database name and the PostGIS
  version — never a host, port, user or connection string.
- SQL errors are translated into generic messages; a constraint violation returns a
  friendly `400`/`409` with the constraint name only (useful for a developer,
  harmless to an attacker).
- `audit_logs.metadata` is written by the application with an explicit field list
  and never includes credentials, tokens or private evidence.

---

## 4. Input validation

| Input | Control |
|---|---|
| Request bodies, query strings, path parameters | zod schemas in `modules/*/*.validation.js`, applied by `middleware/validate.js`; `422` with per-field details |
| Email | Format check plus lower-casing on write, so uniqueness is enforced on the normalized value (`users_email_normalized_chk`) |
| Enumerations | zod `z.enum` on input, `CHECK` constraints in the database |
| Dates | Parsed and range-checked; an `event_time` more than 24 h in the future is rejected |
| Coordinates | Latitude −90..90, longitude −180..180, and both must be supplied together |
| Radius | 1–200000 metres |
| Pagination | `page ≥ 1`, `1 ≤ limit ≤ 100`, enforced both in zod and in SQL (`LEAST`/`GREATEST`) so the database cannot be asked for an unbounded page |
| Text lengths | Bounds duplicated in zod and as `CHECK` constraints |
| File uploads | MIME allow-list + magic-byte verification + size limit + generated filename |
| JSON body size | `express.json({ limit: '100kb' })` |

Validation runs on the server regardless of what the UI does.

---

## 5. SQL injection

Every query uses `pg` parameterised statements (`$1`, `$2`, …). There is no string
concatenation of user input anywhere in the codebase.

Where a query must be dynamic (the update builder in `items.service.js`, the filter
builder in `audit.service.js`), the *structure* is assembled from a fixed set of
column names while every **value** is pushed into the values array and referenced as
`$n`. Identifiers that come from configuration (the database name in
`create-databases.js`) are validated against `^[A-Za-z_][A-Za-z0-9_]*$` and quoted.

---

## 6. Uploads

Handled in `server/src/middleware/upload.js` and `modules/items/items.service.js`:

1. `multer` enforces `MAX_UPLOAD_MB` before the file is written.
2. `fileFilter` accepts only `image/jpeg`, `image/png`, `image/webp`.
3. The filename is `randomUUID()` plus an extension derived from the accepted MIME
   type. The client's filename is discarded (it is stored, truncated, only as
   `alt_text`), so path traversal and extension tricks are impossible.
4. The first bytes of the stored file are compared with real magic numbers
   (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF….WEBP`). A file whose
   content does not match its declared type is deleted and rejected with `400`.
5. Files are stored outside the source tree in `UPLOAD_DIR` (git-ignored) and served
   read-only with execution suppressed by headers.
6. Only the report's owner or an administrator may attach or remove an image.

Verified by tests: a real PNG is accepted; `.exe` is rejected by type; a text file
declared as `image/png` is rejected by content; an oversized upload returns `413`; a
filename containing `../` is replaced by a generated name.

---

## 7. CORS, headers and rate limiting

- **CORS** is an allow-list built from `CLIENT_ORIGIN` (comma-separated). `*` is
  never used; requests without an `Origin` header (same-origin, tooling) are
  allowed; `credentials` is disabled because the token travels in a header.
- **helmet** with CSP `img-src 'self' data: blob:`, `script-src 'self'`,
  `object-src 'none'`.
- **Rate limits**: strict on `/auth/register` and `/auth/login` (10 per IP per
  15 min in production), loose on the rest (300 per IP per 15 min). Disabled under
  `NODE_ENV=test`.

---

## 8. AI privacy

- Only public item text (title, description) is passed to a provider. Private
  verification hints and claim evidence are never sent — the matching service does
  not have access to them at the point it calls the adapter.
- Requests have a hard timeout (`AI_TIMEOUT_MS`).
- A provider must never throw: failures resolve to `score: null` with a reason, and
  the engine drops the AI component. An unavailable provider degrades the ranking,
  never the workflow.
- Provider responses influence only a numeric ranking component. AI never decides
  ownership; a human administrator reviews every claim (the UI states this on every
  match card).
- Cost and privacy implications are documented in
  [`ai-provider.md`](./ai-provider.md) before enabling a provider.

---

## 9. Audit trail

`audit_logs` is append-only; the application only inserts. Recorded actions:

`user.registered`, `user.login`, `user.password_changed`, `user.role_granted`,
`item.created`, `item.updated`, `item.status_changed`, `item.moderated`,
`item.soft_deleted`, `item.image_uploaded`, `item.image_deleted`,
`matches.recalculated`, `match.dismissed`, `claim.submitted`, `claim.approved`,
`claim.rejected`, `claim.withdrawn`.

`metadata` carries an explicit, allow-listed field set (for example
`{ from: "open", to: "rejected", reason }`) so credentials and private evidence can
never be written into the log. `actor_user_id` is `ON DELETE SET NULL`, so the
record survives account deletion.

---

## 10. Logging

- `morgan('tiny')` logs method, URL, status and duration only — never headers,
  bodies or tokens.
- The error handler logs the message and stack for 5xx server-side and a single
  line for 4xx; neither is returned to the client.
- No `console.log` of a request body exists in the codebase.
- Application logs are written to the terminal only; no log file is created by
  default, which keeps log rotation and data-retention decisions with the operator.

---

## 11. Configuration and secrets

- `.env` is git-ignored; only `.env.example` with placeholders is committed.
- `config/env.js` validates all configuration at startup and **refuses to start in
  production** with a placeholder or short `JWT_SECRET`, or the example database
  password.
- Secrets are never logged, returned, or embedded in the client bundle. The Vite
  client only ever reads `VITE_*` variables, and the only ones defined are a base URL
  and an asset origin.
- The connection string is used as a whole and is never printed: startup logs a
  `host:port/database` label with no credentials, and the health endpoint reports a
  database *name* only.

---

## 12. Known limitations and residual risks

1. **No refresh tokens or revocation list.** Logout is client-side; a stolen,
   unexpired token stays valid until it expires. Shortening `JWT_EXPIRES_IN`
   reduces the window.
2. **No email verification or password reset.** Both are out of scope per
   `PROJECT_SPEC.md` §4.2; a real deployment must add them.
3. **No multi-factor authentication.**
4. **Administrators are created only by direct SQL or the seed.** There is
   deliberately no endpoint that can grant the admin role, so privilege escalation
   through the API is impossible.
5. **Rate limiting is per IP and in-process.** Behind multiple instances a shared
   store (for example Redis) would be required.
6. **Claim evidence is stored but not retrievable through the API.** An
   administrator who needs it must read it out-of-band with database access. This is
   the conservative reading of spec §16 and is called out in §3.
7. **Uploads are stored on the local filesystem.** A multi-instance deployment needs
   object storage; the `storage_key` indirection already isolates that change.
8. **No antivirus scanning of uploads.** Content sniffing plus a strict image
   allow-list mitigates but does not eliminate the risk.
9. **`localStorage` token storage is XSS-sensitive** (§1).
10. **Auditing is application-driven.** A direct `UPDATE` by a database superuser is
    not audited, although the status-transition and match-orientation triggers still
    prevent illegal *states*.
