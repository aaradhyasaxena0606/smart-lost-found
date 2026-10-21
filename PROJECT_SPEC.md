# PROJECT SPECIFICATION

## Smart Lost & Found: An AI-Assisted Campus Item Recovery System Using Spatial Database Indexing and Relational Data Management

**Project type:** DBMS-focused academic web application  
**Primary stack:** React + Vite, Node.js + Express, PostgreSQL + PostGIS  
**Document purpose:** Defines the product scope, requirements, architecture, data model, interfaces, security, and acceptance criteria for implementation.

---

## 1. Project Overview

Smart Lost & Found is a campus-focused web application that centralizes lost-item and found-item reports. Users can submit reports, search and filter listings, receive possible matches based on item attributes, time, and location, and submit claims to recover belongings. Administrators can moderate reports and review claims.

The system uses PostgreSQL as its primary relational database and PostGIS for location-aware searches and spatial indexing. A deterministic matching engine is required for the initial version. Optional AI-based text or image similarity may improve ranking, but the application must remain usable when no AI provider is configured.

## 2. Problem Statement

Campus lost-property recovery is often handled through informal messages, notice boards, and disconnected group chats. Information is difficult to search, duplicate reports occur, and people may not learn that an item matching theirs has been found. A centralized, searchable system can organize reports and identify potential matches using structured item attributes, time windows, and geographic proximity.

## 3. Objectives

- Provide a single platform for reporting lost and found items.
- Maintain structured, consistent, relational records.
- Demonstrate core DBMS concepts through schema design, normalization, keys, constraints, joins, transactions, and indexing.
- Use PostgreSQL and PostGIS for spatial storage, proximity filtering, and GiST indexing.
- Rank possible lost/found pairs using documented, explainable matching logic.
- Support ownership claims, administrator review, and item-return status updates.
- Provide in-app notifications and an audit trail for important actions.
- Deliver a responsive, secure, testable application suitable for an academic demonstration.

## 4. Scope

### 4.1 In Scope

- User registration, login, and authenticated sessions.
- User and administrator roles.
- Lost-item and found-item reports.
- Optional item image uploads or safe image references.
- Item categories, descriptions, colour, brand, event date/time, and location.
- Search, filtering, sorting, and pagination.
- PostGIS-based radius/proximity search.
- Deterministic candidate matching and match-score explanations.
- Optional AI text/image similarity adapter with fallback behavior.
- Claim submission, review, and return workflow.
- In-app notifications, report moderation, and audit logging.
- Database migrations, development seed data, tests, and documentation.

### 4.2 Out of Scope for the Initial Version

- Native Android or iOS applications.
- Payments or financial transactions.
- AI making the final ownership decision or automatically approving claims.
- Complex indoor positioning and live tracking.
- Guaranteed availability of external AI services.
- Production-grade email/SMS delivery unless separately implemented.

## 5. User Roles and Permissions

### 5.1 Student/User

- Register and sign in.
- Create and manage their own eligible lost/found reports.
- Browse and search public-safe item reports.
- View matches relevant to their reports.
- Submit claims for eligible found items.
- View their own claims and notifications.
- Never view another user's private claim evidence or private verification details.

### 5.2 Administrator

- Review and moderate reports.
- View and process claim queues.
- Approve or reject claims with a recorded reason.
- Manage appropriate item status transitions.
- Review audit information relevant to administrative actions.
- Cannot approve their own claim.

### 5.3 System

- Validate requests and enforce authorization.
- Generate and persist candidate matches.
- Update related statuses atomically where required.
- Create notifications and audit records for key events.

## 6. Core User Workflows

### 6.1 Report a Lost Item

1. The user signs in and opens the lost-item form.
2. The user enters the title, category, description, optional colour/brand/image, approximate date/time, and last known location.
3. The backend validates the input and saves the report.
4. The matching service searches compatible found reports and stores candidate matches.
5. The user can review relevant candidates and submit a claim when appropriate.

### 6.2 Report a Found Item

1. The user signs in and opens the found-item form.
2. The user enters the item details, found date/time, location, and optional image.
3. The user may provide private verification details, which must never appear in public listing responses.
4. The backend saves the report and searches for compatible lost reports.
5. Candidate matches are ranked and relevant users may receive notifications without private verification details.

### 6.3 Claim an Item

1. A user selects an eligible found-item report and submits an explanation and any required private evidence.
2. The backend checks eligibility, authorization, and duplicate active claims.
3. An administrator reviews the claim and approves or rejects it with a reason.
4. Claim and item status changes occur in a database transaction.
5. Relevant users receive notifications and the action is recorded in the audit log.

### 6.4 Administrator Review

1. The administrator signs in and opens the review dashboard.
2. The administrator reviews reports and pending claims.
3. Invalid or duplicate reports can be moderated.
4. Claims are approved or rejected with a recorded reason.
5. Important administrative actions are written to the audit log.

## 7. Functional Requirements

- **FR-01:** Users can register using a name, valid email, and password.
- **FR-02:** Duplicate accounts are prevented using normalized email addresses.
- **FR-03:** Users can log in and receive an authenticated session token.
- **FR-04:** Protected endpoints reject missing, invalid, or expired authentication tokens.
- **FR-05:** Administrator endpoints enforce server-side role authorization.
- **FR-06:** Authenticated users can create lost-item reports.
- **FR-07:** Authenticated users can create found-item reports.
- **FR-08:** Users can edit or close their own eligible reports.
- **FR-09:** Users can attach an optional image within configured size/type limits.
- **FR-10:** The system stores category, description, colour, brand, event time, location, and status when available.
- **FR-11:** Users can search, filter, sort, and paginate item reports.
- **FR-12:** Location-aware searches use PostGIS spatial queries.
- **FR-13:** Candidate matching considers report type, category, attributes, time, and location.
- **FR-14:** Candidate match scores and non-sensitive explanations are persisted.
- **FR-15:** An optional AI adapter can contribute text or image similarity.
- **FR-16:** Core workflows continue when AI integration is disabled or unavailable.
- **FR-17:** Users can view their own reports, relevant matches, claims, and notifications.
- **FR-18:** Users can submit claims for eligible found-item reports.
- **FR-19:** Claim review is restricted to authorized administrators; users cannot approve their own claims.
- **FR-20:** Administrators can approve or reject claims and provide a review reason.
- **FR-21:** Item and claim status transitions are validated on the backend.
- **FR-22:** Item-return and related status updates are atomic transactions.
- **FR-23:** The system creates in-app notifications for key workflow events.
- **FR-24:** Important user and administrator actions create audit records.
- **FR-25:** Database constraints prevent invalid relationships and invalid status values.
- **FR-26:** Public item responses never expose private verification details, private claim evidence, password hashes, or secrets.

## 8. Non-Functional Requirements

- **NFR-01:** Use a modular frontend, backend, and database architecture.
- **NFR-02:** Use parameterized SQL for all user-influenced database queries.
- **NFR-03:** Passwords are stored only as hashes produced by a maintained password-hashing library.
- **NFR-04:** Secrets and environment-specific configuration are not hardcoded.
- **NFR-05:** Authorization is enforced on the backend, not only in the UI.
- **NFR-06:** Database constraints and transactions maintain data integrity.
- **NFR-07:** Frequently filtered columns are indexed; spatial locations have a GiST index.
- **NFR-08:** List endpoints are paginated and bounded.
- **NFR-09:** API errors use consistent responses and appropriate HTTP status codes.
- **NFR-10:** The UI is responsive and uses accessible labels, focus states, and keyboard navigation.
- **NFR-11:** User-facing operations provide loading, empty, success, and error states.
- **NFR-12:** Setup documentation includes database backup and recovery guidance.
- **NFR-13:** Automated tests cover authentication, permissions, item workflows, claims, and matching.
- **NFR-14:** Logs and API responses do not leak secrets or private verification evidence.
- **NFR-15:** AI-generated scores are advisory and never prove ownership.
- **NFR-16:** Optional integrations have documented configuration, failure handling, and fallback behavior.
- **NFR-17:** A student developer can reproduce the setup using the documented prerequisites and commands.

## 9. Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React + Vite + JavaScript | User interface and client-side routing/state |
| Styling | Responsive CSS | Accessible, consistent presentation |
| Backend | Node.js + Express | REST API, business logic, authorization |
| Database | PostgreSQL | Relational system of record |
| Spatial extension | PostGIS | Geographic types, distance queries, spatial indexing |
| Database driver | `pg` | Parameterized PostgreSQL access |
| Authentication | JWT plus bcrypt or equivalent | Authenticated sessions and password hashing |
| API format | REST + JSON | Client/server communication |
| Validation | Reusable server-side validation middleware/library | Input validation and normalization |
| Testing | Node test runner or Jest/Vitest; Supertest where appropriate | Unit and API tests |
| Optional AI | Provider adapter interface | Optional semantic text/image similarity |

Use JavaScript consistently unless the repository is already deliberately configured for TypeScript. The selected package manager and supported runtime versions must be documented in the README.

## 10. System Architecture

```text
┌─────────────────────────────────────────────┐
│                React + Vite UI              │
│ Reports • Search • Matches • Claims • Admin │
└──────────────────────┬──────────────────────┘
                       │ HTTPS / JSON REST API
┌──────────────────────▼──────────────────────┐
│             Node.js + Express API            │
│ Routes • Validation • Auth/RBAC • Services   │
│ Error Handling • Notifications • Audit       │
└─────────────┬────────────────────┬──────────┘
              │                    │
┌─────────────▼────────────┐  ┌────▼─────────────────┐
│ PostgreSQL + PostGIS     │  │ Matching Service     │
│ Relational records       │  │ Rules + optional AI  │
│ Constraints and indexes  │  │ similarity adapter   │
└──────────────────────────┘  └──────────────────────┘
```

### Architecture Rules

- React communicates with Express through versioned REST endpoints.
- The backend is the normal application component that accesses PostgreSQL.
- PostgreSQL is the source of truth for accounts, reports, claims, matches, statuses, notifications, and audit records.
- PostGIS performs geographic filtering in SQL; location matching must not be simulated by comparing location strings.
- Matching logic is separated from route handlers.
- AI integration is isolated behind an adapter and can be disabled.
- Database changes are versioned through migrations.
- Upload storage must be configurable; uploaded files must not be executable application content.

## 11. Suggested Repository Structure

```text
smart-lost-found/
├── PROJECT_SPEC.md
├── README.md
├── .gitignore
├── .env.example
├── docker-compose.yml                 # Optional local PostgreSQL/PostGIS
├── docs/
│   ├── architecture.md
│   ├── database-design.md
│   ├── er-diagram.mmd
│   ├── api-reference.md
│   ├── test-plan.md
│   └── security.md
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── scripts/
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── modules/                   # auth, users, items, matches, claims, admin
│   │   ├── services/                  # matching, spatial, notifications, audit
│   │   ├── integrations/ai/
│   │   └── utils/
│   └── tests/
└── client/
    └── src/
        ├── api/
        ├── components/
        ├── pages/
        ├── hooks/
        ├── context/
        └── styles/
```

This is a recommended structure, not a reason to overwrite useful existing code. Any substantial deviation should be documented.

## 12. Database Design

### 12.1 Core Tables

#### `users`
- `user_id` — primary key.
- `full_name` — required.
- `email` — required and unique after normalization.
- `password_hash` — required; never return it through the API.
- `role` — `user` or `admin`.
- `is_active` — boolean.
- `created_at`, `updated_at` — timestamps.

#### `categories`
- `category_id` — primary key.
- `name` — required and unique.
- `description` — optional.

#### `items`
Represents both lost and found reports.
- `item_id` — primary key.
- `reporter_id` — foreign key to `users`.
- `category_id` — foreign key to `categories`.
- `report_type` — `lost` or `found`.
- `title`, `description` — required.
- `colour`, `brand` — optional.
- `event_time` — date/time the item was lost or found.
- `location_name` — human-readable location.
- `location` — consistently selected PostGIS `geography(Point, 4326)` or `geometry(Point, 4326)`.
- `status` — controlled lifecycle status.
- `created_at`, `updated_at`, `closed_at` — timestamps; `closed_at` is optional.

#### `item_images`
- `image_id` — primary key.
- `item_id` — foreign key to `items`.
- `image_url` or `storage_key` — required.
- `uploaded_at` — timestamp.

#### `item_private_details`
- `private_detail_id` — primary key.
- `item_id` — unique foreign key to `items`, allowing at most one record per item.
- `verification_hint` or protected verification data — optional and access-restricted.
- `created_at` — timestamp.
- Store only information necessary for verification; never include it in public item responses.

#### `matches`
- `match_id` — primary key.
- `lost_item_id`, `found_item_id` — foreign keys to `items`.
- `attribute_score`, `time_score`, `spatial_score` — numeric component scores.
- `ai_score` — nullable numeric score.
- `overall_score` — numeric ranking score.
- `match_status` — for example `suggested`, `dismissed`, `claimed`, `resolved`.
- `match_reasons` — JSONB or normalized child records; must not contain private evidence.
- `created_at`, `updated_at` — timestamps.
- Unique constraint on `(lost_item_id, found_item_id)`.
- Enforce that the referenced reports are respectively lost and found through application validation and, where practical, database safeguards.

#### `claims`
- `claim_id` — primary key.
- `item_id` — foreign key to the found item.
- `claimant_id` — foreign key to `users`.
- `claim_message` — claimant's explanation.
- `private_evidence` — sensitive; access-restricted and excluded from public responses.
- `status` — `pending`, `approved`, `rejected`, or `withdrawn`.
- `reviewed_by` — nullable foreign key to `users`.
- `reviewed_at`, `review_reason` — nullable review fields.
- `created_at`, `updated_at` — timestamps.

#### `notifications`
- `notification_id` — primary key.
- `user_id` — foreign key to `users`.
- `notification_type`, `title`, `message` — required notification fields.
- `related_item_id` — optional foreign key to `items`.
- `related_claim_id` — optional foreign key to `claims`.
- `is_read` — boolean.
- `created_at` — timestamp.

#### `audit_logs`
- `audit_id` — primary key.
- `actor_user_id` — nullable foreign key to `users`.
- `action`, `entity_type` — required event fields.
- `entity_id` — identifier of the affected record.
- `metadata` — JSONB with safe, non-secret details only.
- `created_at` — timestamp.

### 12.2 DBMS Implementation Requirements

- Use primary keys for all tables and foreign keys for relational integrity.
- Use unique constraints for normalized email and category names.
- Use `NOT NULL`, `CHECK`, and appropriate default constraints.
- Choose and document a consistent strategy for controlled status values (PostgreSQL enums or `CHECK` constraints).
- Use transactions for multi-step operations such as claim approval and marking an item returned.
- Add B-tree indexes for commonly filtered fields, such as report type, status, category, event time, reporter, and claimant.
- Add a GiST index for the PostGIS location column.
- Consider partial indexes for open reports and pending claims when query patterns justify them.
- Use parameterized SQL and document representative joins and aggregate queries.
- Use migrations for all schema changes and provide repeatable seed scripts.
- Demonstrate query planning with `EXPLAIN ANALYZE` in development documentation.
- Use views, functions, or triggers only when they serve a documented purpose.
- Define deletion behavior intentionally. Prefer report closure/soft deletion where appropriate and preserve audit history.
- Normalize the schema appropriately (target 3NF where applicable) and document any justified denormalization.

### 12.3 ER Relationships

- One user can create many item reports.
- One category can classify many item reports.
- One item can have many images.
- One item can have zero or one private-details record.
- One lost item can have many candidate matches; one found item can also have many candidate matches.
- One found item can have many claims, subject to business rules.
- One user can submit many claims.
- One administrator can review many claims.
- One user can receive many notifications.
- One user can generate many audit-log entries.

Create `docs/er-diagram.mmd` and ensure its entities, keys, and cardinalities match the implemented SQL schema.

### 12.4 Suggested Status Values

- Item: `open`, `matched`, `claimed`, `returned`, `closed`, `rejected`.
- Match: `suggested`, `dismissed`, `claimed`, `resolved`.
- Claim: `pending`, `approved`, `rejected`, `withdrawn`.

Validate status transitions in backend logic and enforce valid values at the database level.

## 13. Matching and AI Requirements

### 13.1 Deterministic Baseline

1. Select eligible open lost reports and open found reports.
2. Exclude pairs with the same report type.
3. Apply configurable date/time windows.
4. Use PostGIS to shortlist reports within a configurable radius when both locations are available.
5. Compare category, title, colour, brand, and description using documented deterministic rules.
6. Calculate component scores on a documented scale, such as 0–100.
7. Combine available components using configurable weights.
8. Persist scores and non-sensitive reasons in `matches`.
9. Prevent duplicate pairs with the unique constraint and an upsert/update strategy.
10. Recalculate when relevant report data changes or provide a documented recalculation action.

### 13.2 Example Score Model

Initial weights may be:
- Attribute similarity: 35%.
- Time proximity: 20%.
- Spatial proximity: 25%.
- AI text/image similarity: 20% when available.

These are starting values, not validated probabilities. If AI is unavailable, normalize the remaining available components so results are not unfairly penalized. Document, configure, and test the final weights. Explain to users that a score ranks candidates and does not prove ownership.

### 13.3 Optional AI Integration

- Define a provider interface for optional semantic text or image similarity.
- Isolate provider-specific code in `server/src/integrations/ai/`.
- Read provider configuration and credentials from environment variables.
- Apply timeouts, error handling, and deterministic fallback behavior.
- Never send private verification details or claim evidence to an external AI provider.
- Do not fabricate provider endpoints, credentials, SDK methods, or model results.
- When no real provider is configured, use deterministic matching and indicate that AI enhancement is disabled.
- Document cost, privacy implications, and setup requirements before enabling an external provider.

## 14. REST API Requirements

Use a consistent prefix such as `/api/v1`. Every endpoint must document authentication, role/ownership requirements, request validation, success responses, error responses, and tests. Response envelopes and error formats must be consistent.

### Authentication

- `POST /api/v1/auth/register` — create account.
- `POST /api/v1/auth/login` — authenticate.
- `GET /api/v1/auth/me` — retrieve current user profile.

### Items

- `GET /api/v1/items` — searchable public-safe reports with filters and pagination.
- `GET /api/v1/items/:itemId` — item details excluding private evidence.
- `POST /api/v1/items` — create lost/found report.
- `PATCH /api/v1/items/:itemId` — update an authorized report.
- `PATCH /api/v1/items/:itemId/status` — validated status update.
- `GET /api/v1/users/me/items` — current user's reports.

Supported list filters may include `type=lost|found`, `categoryId`, `status`, `colour`, `from`, `to`, `latitude`, `longitude`, `radiusMeters`, `page`, `limit`, and `sort=recent|relevance`. Validate coordinates, radius, page, and limit server-side.

### Matches

- `GET /api/v1/matches` — matches relevant to the current user.
- `GET /api/v1/items/:itemId/matches` — authorized matches for a report.
- `POST /api/v1/matches/:matchId/dismiss` — dismiss a candidate where permitted.
- `POST /api/v1/matches/recalculate` — optional authorized recalculation action.

### Claims

- `POST /api/v1/items/:itemId/claims` — submit a claim.
- `GET /api/v1/claims/me` — current user's claims.
- `GET /api/v1/admin/claims` — administrator review queue.
- `PATCH /api/v1/admin/claims/:claimId` — approve/reject with authorization and transactional updates.

### Notifications

- `GET /api/v1/notifications` — current user's notifications.
- `PATCH /api/v1/notifications/:notificationId/read` — mark a notification as read.

### Administration and Health

- `GET /api/v1/admin/items` — report review queue.
- `PATCH /api/v1/admin/items/:itemId/moderation` — moderate a report.
- `GET /api/v1/admin/audit-logs` — authorized audit listing.
- `GET /api/v1/health` — application health; an optional database readiness check must not reveal credentials or internal connection strings.

Use appropriate HTTP status codes, including `200`, `201`, `400`, `401`, `403`, `404`, `409`, and `500` where applicable.

## 15. Frontend Requirements

### Required Pages

- Registration and login.
- User dashboard.
- Lost-items and found-items listings.
- Report-lost and report-found forms.
- Item details.
- Potential matches.
- My claims.
- Notifications.
- Administrator dashboard and review queue.

### UI Behavior

- Clear navigation and consistent layout.
- Responsive desktop and mobile layouts.
- Search, filters, sorting, and pagination.
- Item cards with public-safe details and available images.
- Field-level validation and useful error messages.
- Loading, empty, success, and error states.
- Confirmation before destructive or irreversible actions.
- Accessible labels, keyboard navigation, and visible focus states.
- Protected client routes for user experience, with backend authorization remaining authoritative.
- No private evidence or secret verification details in public UI.
- No fabricated production counts or fake match data. Development seed data must be clearly identified.

## 16. Security and Privacy Requirements

- Hash passwords with bcrypt or an equivalent maintained library.
- Validate and normalize email, identifiers, enums, dates, coordinates, text lengths, and upload size/type.
- Use parameterized SQL for all database queries.
- Apply authentication and role/ownership checks to every protected route.
- Never return password hashes, private claim evidence, secret item details, tokens, or environment variables.
- Configure CORS deliberately, security headers, request-size limits, and rate limits for authentication endpoints.
- Keep `.env` out of version control and use a strong random JWT secret outside example configuration.
- Configure token expiry and document token-storage trade-offs. Never place tokens in URLs.
- Treat uploads as untrusted input: validate type and size, generate safe filenames, and prevent execution.
- Avoid logging passwords, tokens, private evidence, or unnecessary personal data.
- Prevent users from approving their own claims.
- Record important administrative status changes.
- AI must not decide ownership or disclose private verification details.

## 17. Environment Configuration

Provide a `.env.example` containing safe placeholders, for example:

```env
NODE_ENV=development
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://postgres:change_me@localhost:5432/smart_lost_found
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=1d
UPLOAD_DIR=uploads
MAX_UPLOAD_MB=5
MATCH_RADIUS_METERS=1500
MATCH_MAX_DAYS=30
AI_PROVIDER=disabled
AI_API_KEY=
```

- Never use the example database password or JWT secret in a real deployment.
- Validate required environment variables on startup.
- The application must work when `AI_PROVIDER=disabled`.
- Document one consistent database configuration strategy.
- Keep real user uploads and `.env` files out of version control.

## 18. Testing and Acceptance Criteria

### Authentication and Authorization

- Registration succeeds for valid input; duplicate normalized email is rejected.
- Invalid credentials are rejected and passwords are stored as hashes.
- Protected endpoints reject missing, invalid, or expired tokens.
- Normal users cannot access administrator endpoints or modify other users' reports.

### Reports and Search

- Valid lost/found reports can be created and updated according to permissions.
- Invalid fields and invalid coordinates are rejected.
- Search filters, sorting, and pagination work.
- Private verification data never appears in public responses.
- Upload type and size restrictions are enforced.

### Spatial Database

- Setup/migrations enable PostGIS.
- Coordinates are stored in the selected spatial type and coordinate order is documented.
- A spatial index exists and is documented.
- Radius queries return points within the configured radius and exclude points outside it, with boundary behavior documented.
- Spatial distance calculations use appropriate units.

### Matching

- Compatible lost/found reports can produce a candidate match.
- Same-type pairs are excluded and duplicate pairs are prevented.
- Component and overall scores stay within documented bounds.
- Matching works when AI is not configured.
- Match reasons do not expose private evidence.
- Relevant report changes can trigger or request recalculation as documented.

### Claims and Audit

- Valid claims can be submitted and invalid or unauthorized claims are rejected.
- Only authorized administrators can approve/reject claims.
- Claim review and related item status changes are atomic.
- Duplicate or concurrent requests do not create inconsistent state.
- Required notifications and audit records are created.

### Delivery

- Main pages use real API responses for core functionality.
- Forms show validation errors and meaningful loading/empty/success/error states.
- A clean setup can be run using the README instructions.
- Migrations and seed scripts are repeatable or safely idempotent as documented.
- Tests and build commands are run; results are reported accurately.

## 19. Documentation and Deployment Requirements

The project README and supporting documentation must include:

- Project purpose, features, roles, and limitations.
- Architecture diagram and technology stack.
- Prerequisites and runtime/package-manager versions.
- PostgreSQL/PostGIS setup and environment configuration.
- Database migration and seed commands.
- Backend and frontend startup commands.
- Test, lint, and build commands.
- API endpoint reference.
- ER diagram, table descriptions, and relationship cardinalities.
- DBMS concepts implemented in the application.
- Matching algorithm and scoring explanation.
- AI provider setup and fallback behavior.
- Security/privacy notes, backup/recovery guidance, and deployment steps.
- Known limitations and future enhancements.

Use versioned SQL migrations, a `.gitignore`, `.env.example`, and demo seed data that contains no real personal information. Include ER diagram source such as `docs/er-diagram.mmd` and API documentation such as `docs/api-reference.md` or OpenAPI.

## 20. DBMS Concepts to Demonstrate

- Relational modelling and normalization (target 3NF where applicable).
- Primary keys, foreign keys, unique constraints, `NOT NULL`, `CHECK`, and referential integrity.
- One-to-many and many-to-many relationships where appropriate.
- SQL joins, subqueries, aggregates, sorting, filtering, and pagination.
- Transactions, rollback, and ACID properties.
- B-tree and GiST indexing.
- PostGIS spatial data types, distance queries, and radius searches.
- Query planning and optimization using `EXPLAIN ANALYZE`.
- Views, functions, or triggers where justified by real requirements.
- Concurrency and duplicate-request handling.
- Audit logging and data lifecycle management.
- Secure parameterized database access.

Only describe a concept as implemented if it exists in the final code/schema and can be demonstrated.

## 21. Future Scope

- Real image embeddings for visual matching.
- Semantic text embeddings for item descriptions.
- Campus map integration.
- Email or SMS notifications.
- QR-based item handover confirmation.
- Multi-campus support.
- Administrative analytics dashboard.
- Advanced duplicate-report detection.
- Deployment using managed PostgreSQL/PostGIS and object storage.

## 22. Definition of Done

The project is ready for academic demonstration when:

- A developer can configure and run the application by following the README.
- PostgreSQL/PostGIS setup and migrations are repeatable.
- A user can register, sign in, and report both lost and found items.
- Users can search reports and obtain location-based results.
- Candidate matches are generated and ranked using documented logic.
- Users can submit claims and administrators can review them.
- Status updates, notifications, and audit records work for key workflows.
- Core frontend actions use real backend functionality.
- Critical authorization and data-integrity tests pass.
- Secrets and private verification evidence are not exposed.
- Final documentation accurately states completed features, actual test results, and known limitations.
