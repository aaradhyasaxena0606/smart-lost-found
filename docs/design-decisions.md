# Design Decisions and Deviations from `PROJECT_SPEC.md`

This document records where the implementation deliberately departs from the
written specification, why, and what the consequences are. It exists so the
differences read as considered engineering rather than missed requirements.

---

## DD-01 — The finder decides routine claims; administrators hear appeals

**Specification:** FR-19 — "Claim review is restricted to authorized
administrators"; §5.2 and §6.3 place approval with administrators.

**Implementation:** the reporter of the found item (the *finder*) approves or
rejects routine claims. An administrator decides:

- claims the claimant has **disputed**;
- claims still pending after **48 hours**;
- suspected fraud or collusion;
- anything the finder escalates.

**Rationale**

1. The finder holds the evidence. They recorded the private verification detail
   and they physically hand the item over; a third party is comparing two texts
   with no context.
2. Administrators are a bottleneck. A campus desk cannot review every water bottle
   and umbrella, and delays are exactly when items are lost for good.
3. The handover is a two-party act. The finder must be willing to release the item,
   so giving them the decision removes a pointless coordination step.

**Why administrators remain essential**

- A finder can be dishonest or merely credulous. A plausible claimant who read the
  public description can talk their way past someone who wants to be helpful.
- Without an appeal path there is no accountability: "the finder said so" is not an
  audit trail.
- The administrator is now a **court of appeal**, not a rubber stamp — which is a
  better use of a scarce role than approving every claim.

**Consequences**

- `claims.decided_by_role` records `finder` or `admin` on every decision, so the
  audit trail shows who decided and in what capacity.
- The administrator queue defaults to disputed/overdue claims and can show all.
- FR-19 is **not** satisfied literally. The capability still exists (administrators
  can decide any claim), but routine review is by the finder.

---

## DD-02 — Found reports are not publicly browsable

**Specification:** §15 requires "Lost-items and found-items listings"; §14 exposes
`GET /items?type=found`.

**Implementation:** public search returns **lost reports only**. A found report is
visible to:

- its finder;
- administrators;
- a user the matching engine has paired with it (who sees it through Matches).

Anyone else — including a direct `GET /items/:id` — receives `404`, so ids cannot
be probed.

**Rationale**

Publishing "found black iPhone, cracked screen, cat sticker" hands a fraudster the
answers. Verification then tests whether the claimant can *read*, not whether they
own the item. Hiding the listing removes the cheat sheet; the finder's private
detail remains the real test.

**Consequences**

| Effect | Mitigation |
|---|---|
| A person who lost something but never reported it cannot discover the found item | A late lost report still back-matches existing found reports within the time window (30 days) and radius (1.5 km). Beyond that, an administrator can search on their behalf — the "exceptional lookup" role. |
| Radius and keyword search cover lost reports only | Documented in the UI; administrators still see everything. |
| Found-item photos are private too | Consistent with the item being private. |

`§15`'s "found-items listing" is therefore **not** satisfied for ordinary users.

---

## DD-03 — A claim must be grounded in a match

**Implementation:** `POST /items/:itemId/claims` requires an existing `matches` row
between the claimant's lost report and that found item. Otherwise `403`.

**Rationale:** with found reports hidden, an id check alone would make the privacy
change cosmetic — anyone could claim any item by guessing `itemId`.

**Consequence:** claims require the claimant to have a lost report. This is the
report-first model described in DD-02.

---

## DD-04 — Claimants' private evidence is visible to the finder and administrators

**Specification:** §16 lists "private claim evidence" among the things that must
never be returned.

**Implementation:** `private_evidence` is returned to

- the **finder** deciding the claim,
- **administrators** handling an appeal.

It is never returned to the claimant (they already know what they wrote), to other
users, or in any public response.

**Rationale:** if the finder is the decision-maker, withholding the evidence makes
the decision impossible. The specification's rule assumed an administrator would
judge using the finder's hint; with DD-01 the evidence is part of the test. The
disclosure is limited to the two people who must judge.

**Consequence:** a literal reading of §16 is not satisfied. The API never exposes
evidence publicly, and every access is via an authenticated, authorized endpoint.

---

## DD-05 — Administrators see disputes and escalations by default

**Specification:** §5.2 describes administrators "processing claim queues".

**Implementation:** the administrator claim page defaults to claims that are
disputed or overdue (> 48 h), with a toggle for all claims. Their other duties —
moderation, audit, accounts, exceptional search — are unchanged.

**Rationale:** follows from DD-01; a queue of every routine claim would recreate the
bottleneck the change was meant to remove.

---

## DD-06 — Found reports' verification detail is optional

**Specification:** describes it as optional.

**Implementation:** remains optional, but the UI explains that without it the finder
has nothing to judge a claim against, and the decision dialog states "No
verification detail was recorded" in that case.

**Rationale:** blocking report creation would deter finders, who are volunteers.
Strong prompting plus honest display is the better trade-off.

---

## What is unchanged

Everything else follows the specification: relational modelling and 3NF, keys and
constraints, transactions and row locking, B-tree/GiST/GIN indexes, PostGIS radius
search, deterministic matching with explainable scores, notifications, the audit
trail, soft deletion, JWT authentication, server-side authorization, upload
validation, the API envelope and error format, and the migration discipline.

## How to demonstrate both models

The original model is still reachable: an administrator can decide **any** claim
through the appeal queue, which is exactly the FR-19 capability. If an examiner
prefers the specification's workflow, use an administrator account for every
decision — the finder path is an additional route, not a replacement of the data
model.
