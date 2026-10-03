import test from 'node:test';
import assert from 'node:assert/strict';
import { approvePullRequest } from '../src/approval.js';
import { copilotLogin, latestReviewerReview, recommendsApproval } from '../src/copilot.js';

const positive = '<!-- ccr-overview-v2 -->\n\n## Copilot review overview\n\n### 🟢 Approval recommended\n\n**Findings:** None';
const pr = { state: 'open', draft: false, additions: 5, deletions: 3, changed_files: 1,
  head: { sha: 'head' }, base: { sha: 'base' } };
const review = { id: 10, user: { login: copilotLogin, type: 'Bot' }, state: 'COMMENTED',
  body: positive, commit_id: 'head', submitted_at: '2026-09-30T18:22:14Z' };

function scenario({ reviews = [review], freshReviews = reviews, pullRequest = pr, freshPr = pullRequest,
  files = [{ filename: 'src/main.js', additions: 5, deletions: 3 }] } = {}) {
  const writes = [];
  let reads = 0, reviewReads = 0;
  const api = {
    async request(path, method = 'GET', body) {
      if (method === 'POST') { writes.push({ path, body }); return { id: 20 }; }
      return ++reads === 1 ? pullRequest : freshPr;
    },
    async list(path) {
      if (path.endsWith('/files')) return files;
      return ++reviewReads === 1 ? reviews : freshReviews;
    },
  };
  return { writes, run: options => approvePullRequest({ api, repository: 'owner/repo', number: 1, ...options }) };
}

test('observed standalone and v2 approval headings are accepted', () => {
  assert.equal(recommendsApproval(review), true);
  assert.equal(recommendsApproval({ ...review, body: '### 🟢 Approval recommended\n\nLooks good.' }), true);
  assert.equal(recommendsApproval({ ...review, body: positive.replaceAll('\n', '\r\n') }), true);
});

test('unknown, negative, quoted, misplaced and dismissed assessments cannot approve', () => {
  for (const body of ['### 🟡 Changes recommended', 'Looks good!', 'No findings',
    '> ### 🟢 Approval recommended', '```\n### 🟢 Approval recommended\n```',
    'Summary\n\n### 🟢 Approval recommended', '### 🟢 Approval recommended after fixes']) {
    assert.equal(recommendsApproval({ ...review, body }), false, body);
  }
  for (const state of ['DISMISSED', 'PENDING', 'CHANGES_REQUESTED']) assert.equal(recommendsApproval({ ...review, state }), false);
});

test('latest review selection validates identity, commit and timestamp', () => {
  const newer = { ...review, id: 11, submitted_at: '2026-09-30T19:00:00Z', body: '### 🟡 Changes recommended' };
  const wrongAuthor = { ...newer, user: { login: 'someone', type: 'User' } };
  assert.equal(latestReviewerReview([newer, review, wrongAuthor], 'head').id, 11);
  assert.equal(latestReviewerReview([{ ...review, commit_id: 'old' }], 'head'), undefined);
  assert.equal(latestReviewerReview([{ ...review, user: { login: copilotLogin, type: 'User' } }], 'head'), undefined);
});

test('approval write is pinned to the reviewed SHA', async () => {
  const s = scenario();
  const result = await s.run();
  assert.equal(result.approved, true);
  assert.equal(s.writes.length, 1);
  assert.equal(s.writes[0].body.event, 'APPROVE');
  assert.equal(s.writes[0].body.commit_id, 'head');
});

test('first-review-only permits the first submitted review and safe reruns', async () => {
  const first = scenario();
  assert.equal((await first.run({ firstReviewOnly: true })).approved, true);
  assert.equal(first.writes.length, 1);
  const duplicate = scenario({ reviews: [review, { ...review, id: 20,
    user: { login: 'github-actions[bot]', type: 'Bot' }, state: 'APPROVED', body: '<!-- gha-approval -->' }] });
  const result = await duplicate.run({ firstReviewOnly: true });
  assert.equal(result.eligible, true);
  assert.equal(result.approved, false);
  assert.match(result.reasons.join('\n'), /already exists/);
  assert.equal(duplicate.writes.length, 0);
});

test('first-review-only blocks subsequent reviews on the same or a new commit, including dismissed history', async () => {
  for (const commit_id of ['head', 'old']) {
    for (const state of ['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']) {
      const s = scenario({ reviews: [review, { ...review, id: 9, commit_id, state,
        body: '### 🟡 Changes recommended', submitted_at: '2026-09-29T18:22:14Z' }] });
      const result = await s.run({ firstReviewOnly: true });
      assert.equal(result.eligible, false);
      assert.equal(result.approved, false);
      assert.match(result.reasons.join('\n'), /first-review-only.*more than one review/);
      assert.equal(s.writes.length, 0);
    }
  }
});

test('first-review-only remains disabled by default and can be explicitly disabled', async () => {
  for (const options of [{}, { firstReviewOnly: false }]) {
    const s = scenario({ reviews: [review, { ...review, id: 9, commit_id: 'old', state: 'DISMISSED' }] });
    assert.equal((await s.run(options)).approved, true);
    assert.equal(s.writes.length, 1);
  }
});

test('first-review-only ignores unrelated reviewers, invalid bot identities and pending drafts', async () => {
  const s = scenario({ reviews: [
    { ...review, id: 7, user: { login: 'someone', type: 'User' } },
    { ...review, id: 8, user: { login: copilotLogin, type: 'User' } },
    { ...review, id: 9, state: 'PENDING', submitted_at: null },
    review,
  ] });
  assert.equal((await s.run({ firstReviewOnly: true })).approved, true);
});

test('first-review-only applies to a custom configured reviewer', async () => {
  const custom = { ...review, user: { login: 'my-reviewer', type: 'User' }, body: 'Decision: APPROVE' };
  const options = { firstReviewOnly: true, reviewAuthor: 'my-reviewer', approvalRegexp: '^Decision: APPROVE$' };
  const first = scenario({ reviews: [review, custom] });
  assert.equal((await first.run(options)).approved, true);
  const repeated = scenario({ reviews: [custom, { ...custom, id: 9, commit_id: 'old' }] });
  assert.equal((await repeated.run(options)).eligible, false);
  assert.equal(repeated.writes.length, 0);
});

test('first-review-only is rechecked when another review appears during evaluation', async () => {
  for (const commit_id of ['head', 'old']) {
    const s = scenario({ freshReviews: [review, { ...review, id: 11, commit_id,
      submitted_at: '2026-09-30T19:00:00Z' }] });
    const result = await s.run({ firstReviewOnly: true });
    assert.equal(result.eligible, false);
    assert.match(result.reasons.join('\n'), /changed during evaluation/);
    assert.equal(s.writes.length, 0);
  }
});

test('first-review-only still requires a current positive review and applies in dry runs', async () => {
  for (const reviews of [[], [{ ...review, commit_id: 'old' }],
    [{ ...review, body: '### 🟡 Changes recommended' }],
    [review, { ...review, id: 9, commit_id: 'old' }]]) {
    const s = scenario({ reviews });
    assert.equal((await s.run({ firstReviewOnly: true, dryRun: true })).eligible, false);
    assert.equal(s.writes.length, 0);
  }
  const first = scenario();
  assert.equal((await first.run({ firstReviewOnly: true, dryRun: true })).eligible, true);
  assert.equal(first.writes.length, 0);
});

test('invalid first-review-only configuration fails before any API calls', async () => {
  const api = {
    async request() { assert.fail('Invalid configuration must not call the API.'); },
    async list() { assert.fail('Invalid configuration must not call the API.'); },
  };
  for (const firstReviewOnly of ['true', 'false', null, 0, 1]) {
    await assert.rejects(approvePullRequest({ api, repository: 'owner/repo', number: 1, firstReviewOnly }),
      /first-review-only must be true or false/);
  }
});

test('policies, stale review and newer negative review prevent writes', async () => {
  for (const options of [
    { files: [{ filename: '.github/copilot-instructions.md' }] },
    { reviews: [{ ...review, commit_id: 'old' }] },
    { reviews: [review, { ...review, id: 11, submitted_at: '2026-09-30T19:00:00Z', body: '### 🟡 Changes recommended' }] },
    { reviews: [{ ...review, user: { login: 'someone', type: 'User' } }] },
  ]) {
    const s = scenario(options);
    assert.equal((await s.run()).eligible, false);
    assert.equal(s.writes.length, 0);
  }
});

test('PR and reviewer mutations between evaluation and submission prevent writes', async () => {
  for (const options of [
    { freshPr: { ...pr, head: { sha: 'new' } } },
    { freshPr: { ...pr, base: { sha: 'new-base' } } },
    { freshPr: { ...pr, draft: true } },
    { freshPr: { ...pr, state: 'closed' } },
    { freshReviews: [{ ...review, state: 'DISMISSED' }] },
    { freshReviews: [{ ...review, body: '### 🟡 Changes recommended' }] },
    { freshReviews: [{ ...review, id: 11 }] },
  ]) {
    const s = scenario(options);
    assert.equal((await s.run()).eligible, false);
    assert.equal(s.writes.length, 0);
  }
});

test('dry run and duplicate approval do not submit another review', async () => {
  const dry = scenario();
  assert.equal((await dry.run({ dryRun: true })).eligible, true);
  assert.equal(dry.writes.length, 0);
  const duplicate = scenario({ reviews: [review, { ...review, user: { login: 'github-actions[bot]', type: 'Bot' },
    state: 'APPROVED', body: '<!-- gha-approval -->\nApproved.' }] });
  assert.equal((await duplicate.run()).approved, false);
  assert.equal(duplicate.writes.length, 0);
});

test('custom username and regex work; invalid or empty-matching regex fails', async () => {
  const s = scenario({ reviews: [{ ...review, user: { login: 'my-reviewer', type: 'User' }, body: 'Decision: APPROVE' }] });
  assert.equal((await s.run({ reviewAuthor: 'my-reviewer', approvalRegexp: '^Decision: APPROVE$' })).approved, true);
  for (const approvalRegexp of ['[', '', '.*']) await assert.rejects(s.run({ approvalRegexp }));
  await assert.rejects(s.run({ reviewAuthor: '' }));
});

test('disabled limits and glob exclusions work through the full approval flow', async () => {
  const large = { ...pr, additions: 2005, deletions: 2003, changed_files: 2 };
  const changed = [
    { filename: 'src/main.js', additions: 5, deletions: 3 },
    { filename: 'uv.lock', additions: 2000, deletions: 2000 },
  ];
  for (const policy of [{ maxChangedLines: 0 }, { lineCountExclude: ['**/*.lock'] }]) {
    const positive = scenario({ pullRequest: large, files: changed });
    assert.equal((await positive.run({ policy })).approved, true);
    assert.equal(positive.writes.length, 1);
    const missingReview = scenario({ pullRequest: large, files: changed, reviews: [] });
    assert.equal((await missingReview.run({ policy })).eligible, false);
    assert.equal(missingReview.writes.length, 0);
  }
});
