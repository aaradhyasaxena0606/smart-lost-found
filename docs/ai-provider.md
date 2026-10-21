# Optional AI Provider Setup and Fallback Behaviour

The matching engine works fully without any AI provider. This document explains
what the adapter does, what enabling it costs, and what happens when it fails.

---

## 1. What the AI component is (and is not)

When enabled, the adapter computes an **embedding-based text similarity** between a
lost report and a found report and contributes it as **one weighted component** of
the overall match score:

```
overall = Σ(weight_i × score_i) / Σ(weight_i)     over AVAILABLE components
weights: attribute 0.35 · time 0.20 · spatial 0.25 · ai 0.20   (all configurable)
```

It is **advisory**. It never decides whether a claim is approved, it never changes an
item's status, and it never proves ownership. A human administrator reviews every
claim.

---

## 2. Default: disabled

`AI_PROVIDER=disabled` (the default) is a real implementation, not an error path.
`disabled.provider.js` returns:

```json
{ "score": null, "provider": "disabled", "skipped": true, "reason": "AI provider is disabled (AI_PROVIDER=disabled)." }
```

A `null` score means the AI component is **removed** from the weighted mean and the
remaining weights are re-normalised. Candidates are therefore not penalised for the
missing provider — a pair that matches perfectly on category, text, time and place
still scores 100.

`GET /api/v1/health` reports the active provider so this is always observable, and
each persisted match records an `ai_disabled` reason so a stored score can be
explained after the fact.

---

## 3. Enabling the OpenAI provider

```env
AI_PROVIDER=openai
AI_API_KEY=sk-…                       # required; without it the adapter stays disabled
AI_MODEL=text-embedding-3-small       # any embedding model the account can use
AI_TIMEOUT_MS=5000
AI_BASE_URL=https://api.openai.com/v1
```

Restart the API. `GET /api/v1/health` will then report
`{ "provider": "openai", "enabled": true, "model": "text-embedding-3-small" }`.

### Request made

```
POST {AI_BASE_URL}/embeddings
Authorization: Bearer {AI_API_KEY}
{ "model": "{AI_MODEL}", "input": ["<lost title>. <lost description>", "<found title>. <found description>"] }
```

The two embeddings are compared with cosine similarity, clamped to `[0, 1]` and
scaled to `0..100`. Two identical strings give 100.

### Why a factory rather than a hardcoded client

`createOpenAiProvider({ apiKey, baseUrl, model, timeoutMs, fetchImpl })` allows the
network boundary to be injected. The test suite uses this to verify the success
path, the HTTP-error path and the timeout path **without contacting any external
service**, which is why the fallback behaviour is genuinely tested rather than
assumed.

---

## 4. Failure handling

The adapter must never throw. Every failure resolves to `score: null` with a reason,
the engine records an `ai_unavailable` reason, and matching continues with the
deterministic components:

| Failure | Behaviour |
|---|---|
| `AI_API_KEY` missing while `AI_PROVIDER=openai` | The adapter falls back to the disabled provider at startup and logs a warning. The application never makes an unauthenticated call. |
| HTTP error (401, 429, 5xx) | `score: null`, `error: "Embeddings request failed with HTTP 429"`, one warning logged. Only the status is surfaced; the response body is not logged. |
| Timeout (`AI_TIMEOUT_MS`) | Request aborted, `error: "Timed out after 5000 ms"`. |
| Malformed response | Treated as an error; `score: null`. |
| Either text empty | `skipped: true`, `score: null`. |
| Unknown `AI_PROVIDER` value | Falls back to `disabled` with a warning. |

The API keeps returning `200` with deterministic scores. There is no endpoint whose
success depends on the provider being reachable, and no cached or fabricated score
is ever written.

Verified by `tests/matching.test.js`: unavailable provider still produces candidates
and records `ai_unavailable`; an injected provider's score participates in the
weighted overall exactly as the formula predicts; a provider with no API key reports
that it was skipped.

---

## 5. Privacy

- Only **public** item text (title and description) is transmitted. Private
  verification hints and claim evidence are never sent: the matching service does not
  read those columns and the adapter has no access to them.
- Request bodies are never logged.
- A test asserts that the exact payload sent contains only the two public strings.

If a campus decides that item descriptions must not leave the institution, keep
`AI_PROVIDER=disabled` — that is the supported default and every feature works.

---

## 6. Cost

Embeddings are billed per input token. Two short descriptions per candidate pair is
a small request, but note the scaling behaviour:

- each newly created or edited report is compared against its candidate shortlist
  (bounded by `MATCH_CANDIDATE_LIMIT`, default 200, after the time-window and radius
  filters have already reduced it);
- a recalculation re-embeds the same texts, because no embedding cache is kept.

For a campus-sized dataset (thousands of reports) this is negligible. For a much
larger dataset, add an embedding cache keyed by a hash of the text — the adapter
interface does not change. Check the provider's current pricing page before enabling
it; no cost figures are reproduced here because they change.

---

## 7. Adding a different provider

Implement the contract from `server/src/integrations/ai/index.js`:

```js
export const name = 'my-provider';
export const enabled = true;
export function describe() { /* { provider, enabled, model, note } */ }
export async function scoreTextPair(textA, textB) {
  // Must resolve, never throw. Return { score: 0..100 | null, provider, model, reason?, error? }
}
```

Then register it in the `PROVIDERS` map and add the value to the `AI_PROVIDER`
enum in `server/src/config/env.js`. Nothing else changes: the matching engine only
knows the interface.
