/**
 * Live smoke test against a running server (development convenience).
 *   node database/scripts/smoke-api.js
 * Not part of the automated test suite (see server/tests for that); this just
 * exercises the real HTTP surface end to end.
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4000/api/v1';

let pass = 0;
let fail = 0;

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

const unique = Date.now();

async function main() {
  console.log(`Smoke testing ${BASE}\n`);

  console.log('1. Health');
  const health = await call('GET', '/health?db=1');
  check('GET /health returns 200', health.status === 200, `status=${health.status}`);
  check('health reports database ok', health.json?.checks?.database?.status === 'ok');
  check('health reports postgis version', Boolean(health.json?.checks?.database?.postgisVersion), health.json?.checks?.database?.postgisVersion);
  check('health reports AI disabled', health.json?.ai?.provider === 'disabled');

  console.log('\n2. Authentication');
  const email = `smoke${unique}@campus.test`;
  const register = await call('POST', '/auth/register', {
    body: { fullName: 'Smoke Tester', email, password: 'Password123' },
  });
  check('register returns 201', register.status === 201, `status=${register.status}`);
  check('register returns a token', typeof register.json?.data?.token === 'string');
  check('register never returns a password hash', !JSON.stringify(register.json).includes('password_hash'));
  const token = register.json?.data?.token;

  const duplicate = await call('POST', '/auth/register', {
    body: { fullName: 'Smoke Tester', email: email.toUpperCase(), password: 'Password123' },
  });
  check('duplicate normalized email rejected with 409', duplicate.status === 409, `status=${duplicate.status}`);

  const weakPassword = await call('POST', '/auth/register', {
    body: { fullName: 'Weak Pass', email: `weak${unique}@campus.test`, password: 'short' },
  });
  check('weak password rejected with 422', weakPassword.status === 422, `status=${weakPassword.status}`);

  const badLogin = await call('POST', '/auth/login', { body: { email, password: 'WrongPassword1' } });
  check('invalid credentials rejected with 401', badLogin.status === 401, `status=${badLogin.status}`);

  const goodLogin = await call('POST', '/auth/login', { body: { email, password: 'Password123' } });
  check('valid login returns 200', goodLogin.status === 200, `status=${goodLogin.status}`);

  const meNoToken = await call('GET', '/auth/me');
  check('GET /auth/me without token returns 401', meNoToken.status === 401, `status=${meNoToken.status}`);

  const meBadToken = await call('GET', '/auth/me', { token: 'not.a.jwt' });
  check('GET /auth/me with invalid token returns 401', meBadToken.status === 401, `status=${meBadToken.status}`);

  const me = await call('GET', '/auth/me', { token });
  check('GET /auth/me returns the profile', me.status === 200 && me.json?.data?.email === email);

  // A second, independent user acts as the finder so that ownership rules
  // (nobody may claim their own report) can be exercised realistically.
  const finderEmail = `smoke-finder${unique}@campus.test`;
  const finderRegister = await call('POST', '/auth/register', {
    body: { fullName: 'Smoke Finder', email: finderEmail, password: 'Password123' },
  });
  check('second account can register', finderRegister.status === 201, `status=${finderRegister.status}`);
  const finderToken = finderRegister.json?.data?.token;

  console.log('\n3. Categories and public search');
  const categories = await call('GET', '/categories');
  check('GET /categories returns the seeded list', categories.status === 200 && categories.json.data.length >= 10, `${categories.json?.data?.length} categories`);

  const phoneCategory = categories.json.data.find((c) => c.name === 'Mobile Phone');

  const search = await call('GET', '/items?type=found&limit=5');
  check('GET /items returns 200', search.status === 200);
  check('GET /items is paginated', typeof search.json?.meta?.total === 'number', `total=${search.json?.meta?.total}`);
  check('public items do not expose private details', !JSON.stringify(search.json).includes('verification_hint'));

  const spatial = await call('GET', '/items?latitude=51.5007&longitude=-0.1246&radiusMeters=500&sort=distance');
  check('radius search returns rows', spatial.status === 200 && spatial.json.data.length > 0, `${spatial.json?.data?.length} within 500 m`);
  check('radius search includes distanceMeters', spatial.json?.data?.every((i) => typeof i.distanceMeters === 'number'));
  check('radius search sorted ascending', spatial.json.data.every((item, index, arr) => index === 0 || arr[index - 1].distanceMeters <= item.distanceMeters));

  const tiny = await call('GET', '/items?latitude=51.5007&longitude=-0.1246&radiusMeters=5');
  check('5 m radius excludes the ~26 m item', tiny.json.data.every((i) => i.distanceMeters <= 5), `${tiny.json?.data?.length} rows`);

  const badCoords = await call('GET', '/items?latitude=200&longitude=-0.1246');
  check('invalid latitude rejected with 422', badCoords.status === 422, `status=${badCoords.status}`);

  const radiusWithoutCoords = await call('GET', '/items?radiusMeters=500');
  check('radiusMeters without coordinates rejected with 400', radiusWithoutCoords.status === 400, `status=${radiusWithoutCoords.status}`);

  console.log('\n4. Creating reports and private data handling');
  const created = await call('POST', '/items', {
    token,
    body: {
      reportType: 'lost',
      categoryId: phoneCategory.categoryId,
      title: 'Lost smoke-test phone',
      description: 'A dark phone used only by the smoke test to verify report creation.',
      colour: 'black',
      brand: 'Apple',
      eventTime: new Date(Date.now() - 3600_000).toISOString(),
      locationName: 'Smoke Test Bench',
      latitude: 51.5007,
      longitude: -0.1246,
      verificationHint: 'smoke-test hint that must never be public',
    },
  });
  check('create lost report returns 201', created.status === 201, `status=${created.status}`);
  const lostItemId = created.json?.data?.itemId;
  check('owner sees own private hint', created.json?.data?.privateDetails?.verificationHint === 'smoke-test hint that must never be public');

  const publicDetail = await call('GET', `/items/${lostItemId}`);
  check('anonymous detail hides private details', publicDetail.json?.data?.privateDetails === undefined);

  const createdFound = await call('POST', '/items', {
    token: finderToken,
    body: {
      reportType: 'found',
      categoryId: phoneCategory.categoryId,
      title: 'Found smoke-test phone',
      description: 'A dark smartphone found during the smoke test on a bench near the library.',
      colour: 'black',
      brand: 'Apple',
      eventTime: new Date(Date.now() - 1800_000).toISOString(),
      locationName: 'Smoke Test Bench',
      latitude: 51.5009,
      longitude: -0.1248,
    },
  });
  check('create found report returns 201', createdFound.status === 201, `status=${createdFound.status}`);
  const foundItemId = createdFound.json?.data?.itemId;

  const ownClaim = await call('POST', `/items/${foundItemId}/claims`, {
    token: finderToken,
    body: { claimMessage: 'The finder trying to claim their own found report must be rejected.' },
  });
  check('finder cannot claim their own found report (409)', ownClaim.status === 409, `status=${ownClaim.status}`);

  const badItem = await call('POST', '/items', {
    token,
    body: { reportType: 'lost', categoryId: phoneCategory.categoryId, title: 'ab', description: 'too short', eventTime: new Date().toISOString() },
  });
  check('invalid report rejected with 422', badItem.status === 422, `status=${badItem.status}`);

  const unauthenticatedCreate = await call('POST', '/items', {
    body: { reportType: 'lost', categoryId: phoneCategory.categoryId, title: 'Nope', description: 'x'.repeat(30), eventTime: new Date().toISOString() },
  });
  check('creating without a token returns 401', unauthenticatedCreate.status === 401, `status=${unauthenticatedCreate.status}`);

  console.log('\n5. Matching');
  const matches = await call('GET', `/items/${lostItemId}/matches`, { token });
  check('GET /items/:id/matches returns 200', matches.status === 200, `status=${matches.status}`);
  check('a candidate match was generated', matches.json?.data?.length > 0, `${matches.json?.data?.length} matches`);
  const top = matches.json?.data?.[0];
  check('match has component scores', Boolean(top?.scores) && typeof top.overallScore === 'number');
  check('scores within 0-100', top && top.scores.attribute >= 0 && top.scores.attribute <= 100 && top.overallScore <= 100, JSON.stringify(top?.scores));
  check('only lost->found orientation', top?.lostItem?.reportType === 'lost' && top?.foundItem?.reportType === 'found');
  check('match reasons present', Array.isArray(top?.reasons) && top.reasons.length > 0);
  check('match reasons carry no private hint', !String(JSON.stringify(top?.reasons)).includes('smoke-test hint'));

  const othersMatches = await call('GET', `/items/${lostItemId}/matches`);
  check('matches for a private report require authentication', othersMatches.status === 401, `status=${othersMatches.status}`);

  const recalc = await call('POST', '/matches/recalculate', { token, body: { itemId: lostItemId } });
  check('recalculate returns 200', recalc.status === 200, `status=${recalc.status}`);
  check('recalculate prevents duplicate pairs', recalc.json?.data?.created === 0, `created=${recalc.json?.data?.created}, updated=${recalc.json?.data?.updated}`);

  console.log('\n6. Claims');
  const claim = await call('POST', `/items/${foundItemId}/claims`, {
    token,
    body: {
      claimMessage: 'This is my phone: the smoke test verifies the claim workflow end to end.',
      privateEvidence: 'demo evidence that must never be returned by any endpoint',
    },
  });
  check('submit claim returns 201', claim.status === 201, `status=${claim.status}`);
  const claimId = claim.json?.data?.claimId;
  check('claim response never returns private evidence', !String(JSON.stringify(claim.json)).includes('demo evidence that must never be returned'));
  check('claim reports hasPrivateEvidence only', claim.json?.data?.hasPrivateEvidence === true);

  const duplicateClaim = await call('POST', `/items/${foundItemId}/claims`, {
    token,
    body: { claimMessage: 'A second claim from the same user must be rejected outright.' },
  });
  check('duplicate active claim rejected with 409', duplicateClaim.status === 409, `status=${duplicateClaim.status}`);

  const selfClaim = await call('POST', `/items/${lostItemId}/claims`, {
    token,
    body: { claimMessage: 'Claiming my own lost report should be rejected by the API.' },
  });
  check('claiming a lost report rejected with 400', selfClaim.status === 400, `status=${selfClaim.status}`);

  const myClaims = await call('GET', '/claims/me', { token });
  check('GET /claims/me returns the claim', myClaims.json?.data?.some((c) => c.claimId === claimId));
  check('my claims exclude private evidence', !JSON.stringify(myClaims.json).includes('demo evidence'));

  console.log('\n7. Authorization boundaries');
  const adminQueueAsUser = await call('GET', '/admin/claims', { token });
  check('non-admin cannot read /admin/claims (403)', adminQueueAsUser.status === 403, `status=${adminQueueAsUser.status}`);

  const adminLogin = await call('POST', '/auth/login', { body: { email: 'admin@campus.test', password: 'Password123' } });
  check('admin login works', adminLogin.status === 200, `status=${adminLogin.status}`);
  const adminToken = adminLogin.json?.data?.token;

  const adminQueue = await call('GET', '/admin/claims', { token: adminToken });
  check('admin can read the claim queue', adminQueue.status === 200, `status=${adminQueue.status}`);
  check('queue exposes the verification hint for reviewers', adminQueue.json?.data?.some((c) => c.itemVerificationHint));
  check('queue never returns private evidence', !JSON.stringify(adminQueue.json).includes('must never be returned'));

  const adminStats = await call('GET', '/admin/stats', { token: adminToken });
  check('GET /admin/stats returns database counters', adminStats.status === 200 && adminStats.json?.data?.items?.total > 0);

  console.log('\n8. Claim review transaction');
  const approve = await call('PATCH', `/admin/claims/${claimId}`, {
    token: adminToken,
    body: { decision: 'approved', reviewReason: 'Verification details matched.' },
  });
  check('approve claim returns 200', approve.status === 200, `status=${approve.status}`);
  check('claim is approved', approve.json?.data?.status === 'approved');

  const itemAfter = await call('GET', `/items/${foundItemId}`);
  check('item moved to returned', itemAfter.json?.data?.status === 'returned', `status=${itemAfter.json?.data?.status}`);

  const approveAgain = await call('PATCH', `/admin/claims/${claimId}`, {
    token: adminToken,
    body: { decision: 'approved', reviewReason: 'Double review attempt.' },
  });
  check('reviewing a decided claim returns 409', approveAgain.status === 409, `status=${approveAgain.status}`);

  const rejectWithoutReason = await call('PATCH', `/admin/claims/${claimId}`, {
    token: adminToken,
    body: { decision: 'rejected' },
  });
  check('rejecting without a reason returns 422', rejectWithoutReason.status === 422, `status=${rejectWithoutReason.status}`);

  console.log('\n9. Notifications and audit');
  const notifications = await call('GET', '/notifications', { token });
  check('notifications are returned', notifications.status === 200 && notifications.json.data.length > 0, `${notifications.json?.data?.length}`);
  const notificationId = notifications.json.data[0]?.notificationId;
  const markRead = await call('PATCH', `/notifications/${notificationId}/read`, { token });
  check('marking a notification read works', markRead.status === 200, `status=${markRead.status}`);
  const otherUserRead = await call('PATCH', `/notifications/${notificationId}/read`, { token: adminToken });
  check("another user cannot mark someone else's notification", otherUserRead.status === 404, `status=${otherUserRead.status}`);

  const audit = await call('GET', '/admin/audit-logs?limit=5', { token: adminToken });
  check('audit log is readable by admin', audit.status === 200 && audit.json.data.length > 0, `${audit.json?.meta?.total} entries`);
  check('audit entries never contain secrets', !JSON.stringify(audit.json).includes('password_hash'));
  const auditAsUser = await call('GET', '/admin/audit-logs', { token });
  check('non-admin cannot read audit logs (403)', auditAsUser.status === 403, `status=${auditAsUser.status}`);

  console.log('\n10. Status transitions and moderation');
  const illegal = await call('PATCH', `/items/${lostItemId}/status`, { token, body: { status: 'returned' } });
  check('illegal status transition rejected (409)', illegal.status === 409, `status=${illegal.status}`);
  const legal = await call('PATCH', `/items/${lostItemId}/status`, { token, body: { status: 'closed' } });
  check('legal status transition accepted', legal.status === 200 && legal.json?.data?.status === 'closed', `status=${legal.json?.data?.status}`);
  const selfReject = await call('PATCH', `/items/${lostItemId}/status`, { token, body: { status: 'rejected' } });
  check('only admins can reject a report (403)', selfReject.status === 403 || selfReject.status === 409, `status=${selfReject.status}`);

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
