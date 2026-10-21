# OpenCode Development Instructions

## Smart Lost & Found: An AI-Assisted Campus Item Recovery System

This document explains how OpenCode should approach implementation.
**`PROJECT_SPEC.md` is the authoritative source for what the system must
do.** This file describes how to implement it safely and incrementally.

------------------------------------------------------------------------

## 1. Source of Truth and Priorities

Before making changes:

1.  Read `PROJECT_SPEC.md` completely.
2.  Read this file completely.
3.  Inspect the current repository and identify existing code,
    configuration, and tests.
4.  Follow the requirements, architecture, database schema, API
    contracts, security rules, and acceptance criteria in
    `PROJECT_SPEC.md`.
5.  If this file conflicts with `PROJECT_SPEC.md`, follow
    `PROJECT_SPEC.md`.
6.  Do not silently invent, remove, or materially change requirements.
    If a requirement is ambiguous, identify the ambiguity and propose
    the smallest compatible solution.

Do not regenerate files or overwrite working code without first
inspecting them.

## 2. Technology and Implementation Principles

Use the technology stack specified in `PROJECT_SPEC.md`, including the
project's React frontend, Node.js/Express backend, and PostgreSQL
database with PostGIS where specified.

Implementation principles:

-   Keep frontend, backend, database, and API contracts consistent.
-   Use maintainable, modular code and clear separation of concerns.
-   Use version-controlled database migrations rather than relying on
    undocumented manual schema changes.
-   Use parameterized SQL queries; never concatenate untrusted input
    into SQL.
-   Validate incoming data on the server, even when the frontend also
    validates it.
-   Keep credentials and secrets in environment variables. Commit only a
    safe `.env.example`, never real credentials.
-   Use secure password hashing and the authentication/authorization
    approach defined in the project specification.
-   Use consistent error responses and avoid exposing stack traces or
    secrets to end users.
-   Add appropriate logging without logging passwords, tokens, or
    unnecessary personal data.
-   Keep AI-generated match suggestions advisory. Do not treat
    similarity alone as proof of ownership or automatically approve a
    claim.
-   Prefer understandable, testable solutions over unnecessary
    complexity.
-   Do not add dependencies unless they provide a clear benefit; explain
    important new dependencies.

## 3. Initial Planning

Before substantial coding, provide a concise implementation plan that:

-   Maps the specification's major requirements to modules.
-   Identifies the required database migrations and relationships.
-   Lists the API groups and frontend pages/components.
-   Identifies environment variables and external services, if any.
-   Defines the implementation sequence and verification steps.
-   Notes ambiguities, risks, and dependencies.

Then begin implementation in the order below. Do not stop after
producing only a plan unless blocked by a genuine ambiguity or missing
prerequisite.

## 4. Recommended Implementation Phases

### Phase 1 --- Repository and Application Foundation

-   Establish or preserve a clear repository structure.
-   Set up the frontend and backend using the stack in
    `PROJECT_SPEC.md`.
-   Add development scripts, environment configuration,
    linting/formatting if appropriate, and centralized error handling.
-   Add a `.gitignore` that excludes secrets, dependencies, build
    output, logs, and local uploads as appropriate.
-   Create or update the README with initial setup instructions.
-   Verify that the frontend and backend start successfully.

### Phase 2 --- Database and Migrations

-   Configure PostgreSQL and enable PostGIS if required by the
    specification.
-   Implement the schema and relationships specified in
    `PROJECT_SPEC.md`.
-   Add primary keys, foreign keys, uniqueness rules, check constraints,
    and appropriate nullability.
-   Implement required indexes, including spatial indexes where
    appropriate.
-   Use migrations to create and evolve the schema.
-   Add safe development seed data where useful.
-   Verify migrations on a clean database and test important constraints
    and spatial queries.
-   Do not substitute a different database or silently omit PostGIS
    requirements.

### Phase 3 --- Backend and API Contracts

-   Implement routes, controllers, services, and database access in a
    clear structure.
-   Implement authentication, authorization, and role checks before
    protected operations.
-   Build the specified lost-item, found-item, search, match, claim,
    status, notification, and administrative endpoints.
-   Validate request parameters, bodies, and uploaded files.
-   Use transactions for multi-step operations that must remain
    consistent, including claim decisions and associated item-status
    updates.
-   Return consistent success and error responses.
-   Add tests for validation, permissions, database behavior, and
    important API paths.

### Phase 4 --- Matching and Spatial Search

-   Implement category and attribute matching as described in
    `PROJECT_SPEC.md`.
-   Use PostGIS spatial types and indexed spatial queries for
    location-based matching when specified.
-   Combine location, time, category, descriptive attributes, and AI
    similarity only as defined by the project design.
-   Keep scoring logic understandable and configurable where
    appropriate.
-   Handle missing location or description data gracefully.
-   If an AI model or external AI API is optional or unavailable,
    implement the documented fallback rather than blocking the whole
    application.
-   Clearly label results as candidate matches. Require the specified
    human review and ownership verification steps.

### Phase 5 --- Frontend

-   Implement the required pages, navigation, reusable components, and
    responsive layouts.
-   Build registration/login, dashboards, lost/found report forms,
    search and filters, item details, candidate matches, claim
    workflows, and administrative screens as specified.
-   Connect the frontend to the documented API; do not invent
    incompatible endpoint formats.
-   Include loading, empty, validation, success, and error states.
-   Do not expose secret keys or privileged operations in client-side
    code.
-   Ensure user-visible statuses match the backend's actual state.

### Phase 6 --- Integration and Testing

-   Run available lint, type-check, build, unit, integration, and
    end-to-end tests.
-   Test database migrations against a clean database.
-   Test authentication and role-based access, including unauthorized
    access attempts.
-   Test report creation, search, matching, claim submission, claim
    review, and item-status transitions.
-   Test spatial search and indexes where applicable.
-   Verify transaction rollback and data integrity for multi-step
    operations.
-   Fix regressions before proceeding.
-   Never claim tests passed unless they were actually run; report any
    tests that could not be run and why.

### Phase 7 --- Documentation and Final Verification

-   Complete README setup instructions for a fresh local environment.
-   Document required software, environment variables, database
    creation, PostGIS setup, migrations, seed data, and run/test
    commands.
-   Keep `.env.example` free of real secrets.
-   Verify the implementation against every acceptance criterion in
    `PROJECT_SPEC.md`.
-   Document known limitations and any incomplete requirements.
-   Summarize changed files, commands run, test outcomes, and the next
    steps.

## 5. Work Cycle for Each Phase

For each phase:

1.  Inspect relevant files and requirements.
2.  State briefly what will be implemented.
3.  Make a coherent, limited set of changes.
4.  Run the relevant tests, checks, or commands.
5.  Fix failures caused by the changes.
6.  Summarize files changed, functionality completed, verification
    results, and outstanding issues.
7.  Move to the next phase unless blocked.

Maintain a simple checklist of requirements and mark an item complete
only when its implementation has been verified. Avoid repeatedly
rewriting the whole application in one large change.

## 6. File and Database Safety

-   Inspect files before editing or replacing them.
-   Preserve existing working functionality unless a specification
    requirement demands a change.
-   Never delete user data, databases, migrations, or files without
    explicit approval.
-   Never run destructive database commands against a non-test
    environment without explicit approval.
-   Do not commit credentials, tokens, private uploads, or production
    data.
-   Do not disable security controls merely to make a test pass.
-   Use realistic but fictional seed data.
-   Ensure uploaded files are validated and stored using the security
    approach specified in `PROJECT_SPEC.md`.

## 7. How to Start OpenCode

1.  Create/open the project directory in OpenCode.
2.  Put `PROJECT_SPEC.md` and `OPENCODE_INSTRUCTIONS.md` in the project
    root.
3.  Ensure OpenCode can read both files.
4.  Start with the prompt below.

### Initial prompt

Read `PROJECT_SPEC.md` and `OPENCODE_INSTRUCTIONS.md` completely.
Inspect the current repository before changing files. Treat
`PROJECT_SPEC.md` as the authoritative specification for requirements,
architecture, database schema, APIs, security, and acceptance criteria.
Follow the implementation workflow in `OPENCODE_INSTRUCTIONS.md`.

First, produce a concise implementation plan and identify any genuine
blockers. Then begin Phase 1 and proceed incrementally through the
phases. Preserve working code, use migrations for database changes,
implement tests, and run the relevant checks after each phase. Do not
claim completion without verification. At each phase boundary, summarize
changed files, completed requirements, test results, and remaining work.
Continue with the next phase unless a real blocker requires my input.

### Prompt to resume after interruption

Read `PROJECT_SPEC.md` and `OPENCODE_INSTRUCTIONS.md`, then inspect the
current repository and test results. Identify completed, incomplete, and
failing requirements. Resume at the earliest incomplete task, preserve
working functionality, implement the next logical set of changes, run
relevant checks, and report verified results. Do not restart or
overwrite the project unnecessarily.

## 8. Definition of Done

The implementation is ready for final review only when:

-   Required features and modules in `PROJECT_SPEC.md` are implemented
    and integrated.
-   PostgreSQL schema, relationships, constraints, migrations, and
    required PostGIS behavior work as specified.
-   Search and candidate matching behave as documented.
-   Claim review, ownership verification, and item-status transitions
    preserve data integrity.
-   Authentication and authorization are enforced on protected routes.
-   Relevant tests and build checks have been run, with failures and
    limitations clearly reported.
-   The application can be set up from the README in a fresh local
    environment.
-   All acceptance criteria in `PROJECT_SPEC.md` have been checked and
    their status accurately documented.

A passing build alone does not mean the project is complete. Verify the
user workflows and database behavior too.
