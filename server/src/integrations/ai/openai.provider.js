/**
 * OpenAI embeddings provider (optional).
 *
 * Uses the documented embeddings endpoint:
 *   POST {baseUrl}/embeddings
 *   { "model": "<model>", "input": ["<text A>", "<text B>"] }
 *   -> { "data": [ { "embedding": [...] }, ... ] }
 *
 * Reference: https://platform.openai.com/docs/api-reference/embeddings
 *
 * Safety and privacy (spec 13.3, 16):
 *   * Only public, non-sensitive item attributes are sent by the caller. The
 *     matching service never passes private verification hints or claim evidence
 *     into this adapter.
 *   * Requests carry a hard timeout and every failure degrades to a null score;
 *     the application never depends on this provider being reachable.
 *   * Credentials are never logged.
 *
 * The provider is built by `createOpenAiProvider()`, which accepts dependency
 * overrides. That keeps the network boundary injectable, so the fallback
 * behaviour can be tested without contacting a real service.
 */
import config from '../../config/env.js';

export const name = 'openai';

export const enabled = true;

/** Cosine similarity of two equal-length vectors, or null when undefined. */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Builds a provider bound to the given settings.
 *
 * @param {{
 *   apiKey?: string, baseUrl?: string, model?: string, timeoutMs?: number,
 *   fetchImpl?: typeof fetch, logger?: {warn: Function}
 * }} [overrides]
 */
export function createOpenAiProvider(overrides = {}) {
  const settings = {
    apiKey: overrides.apiKey ?? config.ai.apiKey,
    baseUrl: overrides.baseUrl ?? config.ai.baseUrl,
    model: overrides.model ?? config.ai.model,
    timeoutMs: overrides.timeoutMs ?? config.ai.timeoutMs,
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
    logger: overrides.logger ?? console,
  };

  function describe() {
    return {
      provider: name,
      enabled: true,
      model: settings.model,
      baseUrl: settings.baseUrl,
      timeoutMs: settings.timeoutMs,
      note: 'Text similarity is computed from embedding cosine similarity and contributes the AI component of the match score.',
    };
  }

  async function requestEmbeddings(inputs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const response = await settings.fetchImpl(`${settings.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({ model: settings.model, input: inputs }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Only the status is surfaced to callers; the body may contain details we
        // do not want to leak into logs.
        throw new Error(`Embeddings request failed with HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (!payload || !Array.isArray(payload.data) || payload.data.length !== inputs.length) {
        throw new Error('Embeddings response had an unexpected shape.');
      }
      return payload.data.map((entry) => entry.embedding);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Scores two texts by cosine similarity of their embeddings.
   * Never throws: failures resolve to `score: null` with a reason.
   */
  async function scoreTextPair(textA, textB) {
    const a = typeof textA === 'string' ? textA.trim() : '';
    const b = typeof textB === 'string' ? textB.trim() : '';

    if (!a || !b) {
      return {
        score: null,
        provider: name,
        model: settings.model,
        skipped: true,
        reason: 'Both texts are required.',
      };
    }
    if (!settings.apiKey) {
      return {
        score: null,
        provider: name,
        model: settings.model,
        skipped: true,
        reason: 'AI_API_KEY is not configured; falling back to deterministic scoring.',
      };
    }

    try {
      const [embeddingA, embeddingB] = await requestEmbeddings([a, b]);
      const similarity = cosineSimilarity(embeddingA, embeddingB);
      if (similarity === null) {
        throw new Error('Could not compute cosine similarity from the returned embeddings.');
      }
      // Cosine similarity for related short texts sits roughly in [0, 1]. Clamp
      // defensively and scale to the project's 0-100 component scale.
      const normalised = Math.max(0, Math.min(1, similarity));
      return { score: Math.round(normalised * 100 * 100) / 100, provider: name, model: settings.model };
    } catch (error) {
      const reason =
        error.name === 'AbortError' ? `Timed out after ${settings.timeoutMs} ms` : error.message;
      settings.logger.warn(`[ai] ${name} provider unavailable (${reason}); using deterministic scoring only.`);
      return { score: null, provider: name, model: settings.model, error: reason };
    }
  }

  return { name, enabled: true, describe, scoreTextPair };
}

/** Default instance bound to the process configuration. */
const defaultProvider = createOpenAiProvider();

export const describe = defaultProvider.describe;
export const scoreTextPair = defaultProvider.scoreTextPair;

export default { name, enabled, describe, scoreTextPair, createOpenAiProvider, cosineSimilarity };
