/**
 * Matching engine and AI adapter tests.
 *
 * Acceptance criteria covered (PROJECT_SPEC.md section 18 "Matching"):
 *   * compatible lost/found reports produce a candidate match
 *   * same-type pairs are excluded and duplicate pairs are prevented
 *   * component and overall scores stay within documented bounds
 *   * matching works when AI is not configured
 *   * match reasons do not expose private evidence
 *   * relevant report changes can trigger recalculation
 */
import './helpers/load-test-env.js';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  API,
  resetDatabase,
  closeDatabase,
  createUserViaApi,
  createItemViaApi,
  getCategoryId,
} from './helpers/setup.js';
import { query } from '../src/config/db.js';
import config from '../src/config/env.js';
import * as matchingService from '../src/services/matching.service.js';
import { getAiProvider, setAiProviderOverride } from '../src/integrations/ai/index.js';
import { createOpenAiProvider, cosineSimilarity } from '../src/integrations/ai/openai.provider.js';
import { textSimilarity, colourSimilarity, brandSimilarity, jaccardSimilarity } from '../src/utils/text.js';

let loser;
let finder;
let admin;
let phoneCategory;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

before(async () => {
  await resetDatabase();
  phoneCategory = await getCategoryId('Mobile Phone');
  loser = await createUserViaApi({ fullName: 'Lost Reporter' });
  finder = await createUserViaApi({ fullName: 'Found Reporter' });
  admin = await createUserViaApi({ fullName: 'Match Admin', role: 'admin' });
});

after(async () => {
  setAiProviderOverride(null);
  await closeDatabase();
});

/** Creates a strongly-matching lost/found pair. */
async function createMatchingPair(overrides = {}) {
  const lost = await createItemViaApi(loser.token, {
    categoryId: phoneCategory,
    reportType: 'lost',
    title: 'Lost black iPhone 15 with cracked screen',
    description: 'Black iPhone 15 with a cracked screen protector and a cat sticker on the back case.',
    colour: 'black',
    brand: 'Apple',
    latitude: 51.5007,
    longitude: -0.1246,
    verificationHint: 'private lost hint',
    ...(overrides.lost ?? {}),
  });

  const found = await createItemViaApi(finder.token, {
    categoryId: phoneCategory,
    reportType: 'found',
    title: 'Found black iPhone near the library',
    description: 'Found a black Apple iPhone with a cracked screen protector on a bench outside the library.',
    colour: 'black',
    brand: 'Apple',
    latitude: 51.5009,
    longitude: -0.1248,
    verificationHint: 'private found hint',
    ...(overrides.found ?? {}),
  });

  return { lost, found };
}

describe('Candidate generation', () => {
  test('a compatible lost/found pair produces a candidate match', async () => {
    const { lost, found } = await createMatchingPair();

    const { rows } = await query(
      `SELECT * FROM matches WHERE lost_item_id = $1 AND found_item_id = $2`,
      [lost.itemId, found.itemId]
    );

    assert.equal(rows.length, 1, 'a match row should have been generated on report creation');
    assert.equal(rows[0].match_status, 'suggested');
    assert.ok(rows[0].overall_score >= config.matching.minScore);
  });

  test('two reports of the same type never match each other', async () => {
    await resetDatabase();
    phoneCategory = await getCategoryId('Mobile Phone');
    loser = await createUserViaApi({ fullName: 'Same Type A' });
    finder = await createUserViaApi({ fullName: 'Same Type B' });
    admin = await createUserViaApi({ fullName: 'Same Type Admin', role: 'admin' });

    const lostA = await createItemViaApi(loser.token, {
      categoryId: phoneCategory,
      reportType: 'lost',
      title: 'Lost black iPhone with a cracked screen',
      description: 'Black iPhone with a cracked screen protector and a cat sticker on the back.',
      colour: 'black',
      brand: 'Apple',
      latitude: 51.5007,
      longitude: -0.1246,
    });
    const lostB = await createItemViaApi(finder.token, {
      categoryId: phoneCategory,
      reportType: 'lost',
      title: 'Lost black iPhone with a cracked screen',
      description: 'Black iPhone with a cracked screen protector and a cat sticker on the back.',
      colour: 'black',
      brand: 'Apple',
      latitude: 51.5007,
      longitude: -0.1246,
    });

    const { rows } = await query(
      `SELECT * FROM matches
        WHERE (lost_item_id = $1 AND found_item_id = $2)
           OR (lost_item_id = $2 AND found_item_id = $1)`,
      [lostA.itemId, lostB.itemId]
    );
    assert.equal(rows.length, 0, 'two lost reports must never be paired');
  });

  test('the database refuses a match whose sides are the wrong report type', async () => {
    const lost = await createItemViaApi(loser.token, { categoryId: phoneCategory, reportType: 'lost' });
    const found = await createItemViaApi(finder.token, { categoryId: phoneCategory, reportType: 'found' });

    // Correct orientation already exists from creation; try the inverted one.
    await assert.rejects(
      () =>
        query(
          `INSERT INTO matches (lost_item_id, found_item_id, attribute_score, time_score, overall_score)
           VALUES ($1, $2, 10, 10, 10)`,
          [found.itemId, lost.itemId]
        ),
      /must reference a report with report_type = 'lost'/
    );
  });

  test('recalculating twice does not create duplicate pairs', async () => {
    const { lost } = await createMatchingPair();

    const first = await matchingService.recalculateForItem(lost.itemId, { notify: false });
    const second = await matchingService.recalculateForItem(lost.itemId, { notify: false });

    assert.equal(second.created, 0, 'no new pairs should appear on a second pass');
    assert.equal(second.updated, first.scanned > 0 ? second.updated : 0);

    const { rows } = await query(
      `SELECT lost_item_id, found_item_id, COUNT(*)::int AS n
         FROM matches GROUP BY lost_item_id, found_item_id HAVING COUNT(*) > 1`
    );
    assert.equal(rows.length, 0, 'the unique constraint must prevent duplicate pairs');
  });

  test('an unrelated report does not produce a match', async () => {
    const backpack = await getCategoryId('Bag & Backpack');
    const unrelated = await createItemViaApi(finder.token, {
      categoryId: backpack,
      reportType: 'found',
      title: 'Found a green backpack with a broken zip',
      description: 'A green backpack with a broken zip was handed in at the sports centre.',
      colour: 'green',
      brand: 'Campus Gear',
      latitude: 51.6007, // ~11 km away
      longitude: -0.4246,
      eventTime: new Date(Date.now() - 3 * 3600_000).toISOString(),
    });

    const { rows } = await query(
      `SELECT * FROM matches WHERE lost_item_id = $1 OR found_item_id = $1`,
      [unrelated.itemId]
    );
    assert.equal(rows.length, 0, 'a distant, unrelated report must not be suggested');
  });
});

describe('Score model', () => {
  test('all component and overall scores stay within 0-100', async () => {
    const { lost } = await createMatchingPair();
    const { rows } = await query(`SELECT * FROM matches WHERE lost_item_id = $1 OR found_item_id = $1`, [lost.itemId]);

    assert.ok(rows.length > 0);
    for (const row of rows) {
      for (const column of ['attribute_score', 'time_score', 'spatial_score', 'ai_score', 'overall_score']) {
        const value = row[column];
        if (value === null) continue;
        assert.ok(value >= 0 && value <= 100, `${column} out of range: ${value}`);
      }
    }
  });

  test('the overall score equals the weighted mean of the available components', async () => {
    const lost = {
      item_id: 1, reporter_id: 1, report_type: 'lost', category_id: 7, category_name: 'Mobile Phone',
      title: 'Lost black iPhone with cracked screen', description: 'Black iPhone with a cracked screen and a cat sticker.',
      colour: 'black', brand: 'Apple', event_time: new Date('2026-01-01T10:00:00Z'), status: 'open',
      latitude: 51.5, longitude: -0.12,
    };
    const found = {
      ...lost, item_id: 2, reporter_id: 2, report_type: 'found',
      description: 'Found a black iPhone with a cracked screen protector and a cat sticker.',
      event_time: new Date('2026-01-01T14:00:00Z'),
    };

    const scored = await matchingService.scorePair(lost, found, { distanceMeters: 200 });
    const weights = config.matching.weights;
    const expected =
      (scored.attributeScore * weights.attribute +
        scored.timeScore * weights.time +
        scored.spatialScore * weights.spatial) /
      (weights.attribute + weights.time + weights.spatial);

    assert.ok(Math.abs(scored.overallScore - Math.round(expected * 100) / 100) < 0.01);
    assert.equal(scored.aiScore, null, 'AI must not contribute while disabled');
    assert.equal(scored.spatialScore !== null, true);

    const reasons = scored.reasons.map((reason) => reason.code);
    assert.ok(reasons.includes('ai_disabled'));
    assert.ok(reasons.includes('weighting'));
    assert.ok(reasons.includes('score_notice'));
  });

  test('missing colour and brand re-normalise instead of penalising the score', async () => {
    const base = {
      item_id: 1, reporter_id: 1, report_type: 'lost', category_id: 7, category_name: 'Keys',
      title: 'Lost a set of keys with a red tag', description: 'A set of keys with a red plastic tag and three keys.',
      colour: null, brand: null, event_time: new Date('2026-01-01T10:00:00Z'), status: 'open',
      latitude: 51.5, longitude: -0.12,
    };
    const other = { ...base, item_id: 2, reporter_id: 2, report_type: 'found' };

    const scored = await matchingService.scorePair(base, other, { distanceMeters: 0 });
    const codes = scored.reasons.map((reason) => reason.code);
    assert.ok(codes.includes('colour_unavailable'));
    assert.ok(codes.includes('brand_unavailable'));
    // Identical items with no colour/brand/distance should still score very high.
    assert.ok(scored.overallScore >= 99, `expected a near-perfect score, got ${scored.overallScore}`);
  });

  test('missing locations drop the spatial component and re-normalise', async () => {
    const base = {
      item_id: 1, reporter_id: 1, report_type: 'lost', category_id: 7, category_name: 'Mobile Phone',
      title: 'Lost black iPhone', description: 'A black iPhone with a cracked screen protector.',
      colour: 'black', brand: 'Apple', event_time: new Date('2026-01-01T10:00:00Z'), status: 'open',
      latitude: null, longitude: null,
    };
    const found = { ...base, item_id: 2, reporter_id: 2, report_type: 'found' };

    const scored = await matchingService.scorePair(base, found, { distanceMeters: null });
    assert.equal(scored.spatialScore, null);
    assert.ok(scored.reasons.some((reason) => reason.code === 'spatial_unavailable'));

    const weights = config.matching.weights;
    const expected =
      (scored.attributeScore * weights.attribute + scored.timeScore * weights.time) /
      (weights.attribute + weights.time);
    assert.ok(Math.abs(scored.overallScore - Math.round(expected * 100) / 100) < 0.01);
  });

  test('the time score decays with the gap and reaches zero at the window edge', async () => {
    const make = (hours) => ({
      item_id: 1, reporter_id: 1, report_type: 'lost', category_id: 1, category_name: 'X',
      title: 'Lost an item somewhere on campus today', description: 'A description long enough to be valid here.',
      colour: null, brand: null, status: 'open', latitude: null, longitude: null,
      event_time: new Date(Date.now() - hours * 3600_000),
    });

    const near = await matchingService.scorePair(make(0), { ...make(0), item_id: 2, report_type: 'found' });
    const far = await matchingService.scorePair(make(0), {
      ...make(config.matching.maxDays * 24),
      item_id: 2,
      report_type: 'found',
    });

    assert.ok(near.timeScore > far.timeScore);
    assert.equal(near.timeScore, 100);
    assert.equal(far.timeScore, 0);
  });

  test('the spatial score decays with distance', async () => {
    const lost = {
      item_id: 1, reporter_id: 1, report_type: 'lost', category_id: 1, category_name: 'X',
      title: 'Lost a thing near the fountain today', description: 'A sufficiently long description for validation.',
      colour: null, brand: null, status: 'open', latitude: 51.5, longitude: -0.12,
      event_time: new Date(),
    };
    const found = { ...lost, item_id: 2, reporter_id: 2, report_type: 'found' };

    const close = await matchingService.scorePair(lost, found, { distanceMeters: 0 });
    const mid = await matchingService.scorePair(lost, found, {
      distanceMeters: config.matching.radiusMeters / 2,
    });
    const edge = await matchingService.scorePair(lost, found, {
      distanceMeters: config.matching.radiusMeters,
    });

    assert.equal(close.spatialScore, 100);
    assert.ok(Math.abs(mid.spatialScore - 50) < 0.01);
    assert.equal(edge.spatialScore, 0);
  });

  test('match reasons never contain private verification data', async () => {
    const { lost, found } = await createMatchingPair();
    const { rows } = await query(`SELECT match_reasons FROM matches WHERE lost_item_id = $1 AND found_item_id = $2`, [
      lost.itemId,
      found.itemId,
    ]);

    const serialised = JSON.stringify(rows[0].match_reasons);
    assert.ok(!serialised.includes('private lost hint'));
    assert.ok(!serialised.includes('private found hint'));
    assert.ok(Array.isArray(rows[0].match_reasons));
    assert.ok(rows[0].match_reasons.every((reason) => typeof reason.code === 'string' && typeof reason.label === 'string'));
  });
});

describe('Recalculation triggers', () => {
  test('updating a report recalculates its matches', async () => {
    const { lost, found } = await createMatchingPair();
    const before = await query(`SELECT overall_score FROM matches WHERE lost_item_id = $1 AND found_item_id = $2`, [
      lost.itemId,
      found.itemId,
    ]);

    // Change the found report so it no longer resembles the lost one at all.
    const updated = await api.patch(`${API}/items/${found.itemId}`).set(auth(finder.token)).send({
      title: 'Found a green umbrella near the bus stop',
      description: 'A green umbrella found at the bus stop, completely unrelated to any phone.',
      colour: 'green',
      brand: 'RainPro',
    });
    assert.equal(updated.status, 200);

    const after = await query(`SELECT overall_score FROM matches WHERE lost_item_id = $1 AND found_item_id = $2`, [
      lost.itemId,
      found.itemId,
    ]);

    const changed = after.rows.length === 0 || after.rows[0].overall_score !== before.rows[0].overall_score;
    assert.ok(changed, 'the stored score must change after the report changes');
  });

  test('POST /matches/recalculate refreshes the caller\'s own reports', async () => {
    await resetDatabase();
    phoneCategory = await getCategoryId('Mobile Phone');
    loser = await createUserViaApi({ fullName: 'Recalc Loser' });
    finder = await createUserViaApi({ fullName: 'Recalc Finder' });
    admin = await createUserViaApi({ fullName: 'Recalc Admin', role: 'admin' });

    const lost = await createItemViaApi(loser.token, {
      categoryId: phoneCategory,
      reportType: 'lost',
      title: 'Lost black iPhone with cracked screen protector',
      description: 'Black iPhone with a cracked screen protector and a cat sticker.',
      colour: 'black',
      brand: 'Apple',
    });

    const response = await api.post(`${API}/matches/recalculate`).set(auth(loser.token)).send({});
    assert.equal(response.status, 200);
    assert.ok(response.body.data.itemsProcessed >= 1);

    const single = await api.post(`${API}/matches/recalculate`).set(auth(loser.token)).send({ itemId: lost.itemId });
    assert.equal(single.status, 200);
    assert.equal(single.body.data.itemId, lost.itemId);
  });

  test('a normal user cannot recalculate every report (403)', async () => {
    const response = await api.post(`${API}/matches/recalculate`).set(auth(loser.token)).send({ all: true });
    assert.equal(response.status, 403);
  });

  test('a dismissed match is not resurrected by a recalculation', async () => {
    await resetDatabase();
    phoneCategory = await getCategoryId('Mobile Phone');
    loser = await createUserViaApi({ fullName: 'Dismiss Loser' });
    finder = await createUserViaApi({ fullName: 'Dismiss Finder' });
    admin = await createUserViaApi({ fullName: 'Dismiss Admin', role: 'admin' });

    const { lost, found } = await createMatchingPair();

    const matches = await api.get(`${API}/items/${lost.itemId}/matches`).set(auth(loser.token));
    const matchId = matches.body.data[0].matchId;

    const dismissed = await api.post(`${API}/matches/${matchId}/dismiss`).set(auth(loser.token)).send({});
    assert.equal(dismissed.status, 200);
    assert.equal(dismissed.body.data.matchStatus, 'dismissed');

    await matchingService.recalculateForItem(lost.itemId, { notify: false });

    const { rows } = await query(`SELECT match_status FROM matches WHERE match_id = $1`, [matchId]);
    assert.equal(rows[0].match_status, 'dismissed', 'recalculation must not downgrade a reviewed match');
    assert.ok(found.itemId);
  });
});

describe('Match visibility and authorization', () => {
  test('GET /matches returns only the caller\'s matches', async () => {
    await resetDatabase();
    phoneCategory = await getCategoryId('Mobile Phone');
    loser = await createUserViaApi({ fullName: 'Visibility Loser' });
    finder = await createUserViaApi({ fullName: 'Visibility Finder' });
    admin = await createUserViaApi({ fullName: 'Visibility Admin', role: 'admin' });

    const { lost } = await createMatchingPair();

    const mine = await api.get(`${API}/matches`).set(auth(loser.token));
    assert.equal(mine.status, 200);
    assert.ok(mine.body.data.length >= 1);
    assert.ok(mine.body.data.every((match) => match.lostItem.isMine || match.foundItem.isMine));
    assert.ok(mine.body.data.some((match) => match.lostItem.itemId === lost.itemId && match.lostItem.isMine));

    const otherUser = await createUserViaApi({ fullName: 'Unrelated User' });
    const theirs = await api.get(`${API}/matches`).set(auth(otherUser.token));
    assert.equal(theirs.status, 200);
    assert.equal(theirs.body.data.length, 0, 'an unrelated user must see no matches');
  });

  test('a user cannot read matches for someone else\'s report (403)', async () => {
    const { lost } = await createMatchingPair();
    const outsider = await createUserViaApi({ fullName: 'Outsider' });
    const response = await api.get(`${API}/items/${lost.itemId}/matches`).set(auth(outsider.token));
    assert.equal(response.status, 403);
  });

  test('an administrator can read matches for any report', async () => {
    const { lost } = await createMatchingPair();
    const response = await api.get(`${API}/items/${lost.itemId}/matches`).set(auth(admin.token));
    assert.equal(response.status, 200);
  });

  test('an outsider cannot dismiss a match (403)', async () => {
    const { lost } = await createMatchingPair();
    const outsider = await createUserViaApi({ fullName: 'Dismiss Outsider' });
    const matches = await api.get(`${API}/items/${lost.itemId}/matches`).set(auth(loser.token));
    const matchId = matches.body.data[0].matchId;

    const response = await api.post(`${API}/matches/${matchId}/dismiss`).set(auth(outsider.token)).send({});
    assert.equal(response.status, 403);
  });

  test('needs a token for the match list (401)', async () => {
    const response = await api.get(`${API}/matches`);
    assert.equal(response.status, 401);
  });
});

describe('Text similarity helpers', () => {
  test('identical text is 1, unrelated text is low', () => {
    assert.equal(textSimilarity('Lost black iPhone', 'Lost black iPhone'), 1);
    assert.ok(textSimilarity('Lost black iPhone', 'green umbrella') < 0.2);
  });

  test('jaccard similarity ignores word order', () => {
    assert.equal(jaccardSimilarity('black iPhone case', 'case iPhone black'), 1);
  });

  test('colour similarity groups related colours and reports missing data', () => {
    assert.equal(colourSimilarity('black', 'Black').score, 1);
    assert.ok(colourSimilarity('grey', 'silver').score > 0);
    assert.equal(colourSimilarity('red', 'blue').score, 0);
    assert.equal(colourSimilarity(null, 'blue').score, null);
  });

  test('brand similarity tolerates suffixes', () => {
    assert.equal(brandSimilarity('Apple', 'apple').score, 1);
    assert.ok(brandSimilarity('Apple', 'Apple Inc.').score > 0.5);
    assert.equal(brandSimilarity(null, 'Apple').score, null);
  });
});

describe('AI adapter', () => {
  test('the default provider is disabled and returns no score', async () => {
    const provider = getAiProvider();
    assert.equal(provider.name, 'disabled');
    assert.equal(provider.enabled, false);

    const result = await provider.scoreTextPair('lost phone', 'found phone');
    assert.equal(result.score, null);
    assert.equal(result.skipped, true);
  });

  test('cosine similarity is computed correctly', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-12);
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-12);
    assert.ok(Math.abs(cosineSimilarity([1, 2], [2, 4]) - 1) < 1e-12);
    assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), null);
    assert.equal(cosineSimilarity([0, 0], [1, 1]), null);
  });

  test('a configured provider returns a 0-100 score from embeddings', async () => {
    const provider = createOpenAiProvider({
      apiKey: 'test-key',
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        assert.match(url, /\/embeddings$/);
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        assert.equal(body.input.length, 2);
        return {
          ok: true,
          json: async () => ({ data: [{ embedding: [1, 0, 0] }, { embedding: [1, 0, 0] }] }),
        };
      },
    });

    const result = await provider.scoreTextPair('lost black iPhone', 'found black iPhone');
    assert.equal(result.score, 100);
    assert.equal(result.provider, 'openai');
  });

  test('an HTTP failure degrades to a null score instead of throwing', async () => {
    const warnings = [];
    const provider = createOpenAiProvider({
      apiKey: 'test-key',
      fetchImpl: async () => ({ ok: false, status: 429 }),
      logger: { warn: (message) => warnings.push(message) },
    });

    const result = await provider.scoreTextPair('a', 'b');
    assert.equal(result.score, null);
    assert.match(result.error, /429/);
    assert.equal(warnings.length, 1);
  });

  test('a timeout degrades to a null score', async () => {
    const provider = createOpenAiProvider({
      apiKey: 'test-key',
      timeoutMs: 10,
      fetchImpl: (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
      logger: { warn: () => {} },
    });

    const result = await provider.scoreTextPair('a', 'b');
    assert.equal(result.score, null);
    assert.match(result.error, /Timed out/);
  });

  test('a provider without an API key reports that it is skipped', async () => {
    const provider = createOpenAiProvider({ apiKey: '', fetchImpl: async () => ({ ok: true }) });
    const result = await provider.scoreTextPair('a', 'b');
    assert.equal(result.score, null);
    assert.match(result.reason, /AI_API_KEY/);
  });

  test('only public text is sent to the provider', async () => {
    let captured = null;
    const provider = createOpenAiProvider({
      apiKey: 'test-key',
      fetchImpl: async (_url, options) => {
        captured = JSON.parse(options.body);
        return { ok: true, json: async () => ({ data: [{ embedding: [1, 0] }, { embedding: [1, 0] }] }) };
      },
    });
    await provider.scoreTextPair('title A. description A', 'title B. description B');
    assert.deepEqual(captured.input, ['title A. description A', 'title B. description B']);
    assert.ok(!JSON.stringify(captured).includes('verification'));
  });

  test('when a provider is injected the AI component joins the weighted score', async () => {
    setAiProviderOverride({
      name: 'stub',
      enabled: true,
      describe: () => ({ provider: 'stub', enabled: true, model: 'stub-model' }),
      scoreTextPair: async () => ({ score: 50, provider: 'stub', model: 'stub-model' }),
    });

    try {
      const lost = {
        item_id: 1, reporter_id: 1, report_type: 'lost', category_id: 1, category_name: 'X',
        title: 'Lost an item on campus today', description: 'A description long enough to be valid here.',
        colour: null, brand: null, status: 'open', latitude: null, longitude: null, event_time: new Date(),
      };
      const found = { ...lost, item_id: 2, reporter_id: 2, report_type: 'found' };

      const scored = await matchingService.scorePair(lost, found, { distanceMeters: null });
      assert.equal(scored.aiScore, 50, 'the injected provider score must be used');

      const weights = config.matching.weights;
      const expected =
        (scored.attributeScore * weights.attribute + scored.timeScore * weights.time + 50 * weights.ai) /
        (weights.attribute + weights.time + weights.ai);
      assert.ok(Math.abs(scored.overallScore - Math.round(expected * 100) / 100) < 0.01);
      assert.ok(scored.reasons.some((reason) => reason.code === 'ai_similarity'));
    } finally {
      setAiProviderOverride(null);
    }
  });

  test('a failing AI provider never breaks matching', async () => {
    setAiProviderOverride({
      name: 'stub-failing',
      enabled: true,
      describe: () => ({ provider: 'stub-failing', enabled: true, model: 'stub-model' }),
      scoreTextPair: async () => ({ score: null, provider: 'stub-failing', error: 'upstream unavailable' }),
    });

    try {
      const { lost } = await createMatchingPair();
      const summary = await matchingService.recalculateForItem(lost.itemId, { notify: false });
      assert.ok(summary.scanned >= 1);

      const { rows } = await query(`SELECT match_reasons, ai_score FROM matches WHERE lost_item_id = $1`, [lost.itemId]);
      assert.ok(rows.length >= 1, 'matching must still produce candidates');
      assert.ok(rows.every((row) => row.ai_score === null));
      assert.ok(
        rows.some((row) => row.match_reasons.some((reason) => reason.code === 'ai_unavailable')),
        'the unavailable AI component must be recorded in the reasons'
      );
    } finally {
      setAiProviderOverride(null);
    }
  });
});
