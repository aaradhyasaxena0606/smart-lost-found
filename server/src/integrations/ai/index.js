/**
 * AI provider adapter (spec 13.3).
 *
 * The matching engine only ever talks to this module, so swapping or disabling a
 * provider is a configuration change, never a code change in the domain logic.
 *
 * Contract for every provider:
 *
 *   name: string
 *   enabled: boolean
 *   describe(): { provider, enabled, model, note, ... }
 *   scoreTextPair(textA, textB): Promise<{
 *     score: number|null,     // 0-100, or null when unavailable
 *     provider: string,
 *     model: string|null,
 *     error?: string,
 *     reason?: string,
 *     skipped?: boolean
 *   }>
 *
 * `scoreTextPair` must never throw: it resolves with `score: null` and a reason
 * so the deterministic engine can continue (FR-16).
 */
import config from '../../config/env.js';
import * as disabledProvider from './disabled.provider.js';
import * as openAiProvider from './openai.provider.js';

const PROVIDERS = Object.freeze({
  disabled: disabledProvider,
  openai: openAiProvider,
});

let cached = null;
let override = null;

/**
 * Test seam: forces the adapter to use `provider`.
 *
 * Passing null clears the override and restores normal configuration resolution.
 * Not used by production code paths.
 */
export function setAiProviderOverride(provider) {
  override = provider;
  cached = null;
}

/** Resolves the configured provider (memoised). */
export function getAiProvider() {
  if (override) return override;
  if (cached) return cached;

  const selected = PROVIDERS[config.ai.provider];
  if (!selected) {
    console.warn(
      `[ai] Unknown AI_PROVIDER "${config.ai.provider}"; falling back to the disabled provider.`
    );
    cached = disabledProvider;
    return cached;
  }

  // Guard against a half-configured provider: never make a network call without
  // credentials — behave as disabled instead.
  if (selected.enabled && !config.ai.apiKey) {
    console.warn(
      `[ai] AI_PROVIDER="${config.ai.provider}" is selected but AI_API_KEY is empty; ` +
        'falling back to the disabled provider.'
    );
    cached = disabledProvider;
    return cached;
  }

  cached = selected;
  return cached;
}

/** Status block used by the health endpoint (no secrets included). */
export function describeAiStatus() {
  const provider = getAiProvider();
  return {
    ...provider.describe(),
    configured: config.ai.provider,
  };
}

/** Test helper: clears the memoised provider after changing configuration. */
export function resetAiProviderCache() {
  cached = null;
  override = null;
}

export default { getAiProvider, describeAiStatus, resetAiProviderCache, setAiProviderOverride };
