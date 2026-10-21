/**
 * Disabled AI provider.
 *
 * This is the default and is a first-class implementation, not an error path:
 * when no provider is configured the application must stay fully functional on
 * the deterministic engine alone (FR-16, NFR-16, spec 13.3).
 *
 * `scoreTextPair` resolves to a null score, which tells the matching engine to
 * drop the AI component and re-normalise the remaining weights, so candidates
 * are not penalised for the missing provider.
 */

export const name = 'disabled';

export const enabled = false;

export function describe() {
  return {
    provider: 'disabled',
    enabled: false,
    model: null,
    note: 'AI similarity is disabled; match scores use the deterministic components only.',
  };
}

/**
 * @returns {Promise<{score: null, provider: string, model: null, skipped: true, reason: string}>}
 */
export async function scoreTextPair() {
  return {
    score: null,
    provider: 'disabled',
    model: null,
    skipped: true,
    reason: 'AI provider is disabled (AI_PROVIDER=disabled).',
  };
}

export default { name, enabled, describe, scoreTextPair };
