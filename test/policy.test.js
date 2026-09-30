import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGlob, evaluatePolicy } from '../src/policy.js';

const pr = { state: 'open', draft: false, additions: 500, deletions: 499, changed_files: 1 };
const files = [{ filename: 'src/main.js', status: 'modified' }];

test('line threshold is strict and includes deletions', () => {
  assert.equal(evaluatePolicy(pr, files).eligible, true);
  assert.equal(evaluatePolicy({ ...pr, deletions: 500 }, files).eligible, false);
});

test('zero disables only the line limit', () => {
  const large = { ...pr, additions: 100_000 };
  assert.equal(evaluatePolicy(large, files, { maxChangedLines: 0 }).eligible, true);
  assert.equal(evaluatePolicy({ ...pr, additions: undefined }, files, { maxChangedLines: 0 }).eligible, true);
  for (const blocked of [
    { filename: '.github/copilot-instructions.md' },
    { filename: 'AGENTS.md', status: 'removed' },
  ]) assert.equal(evaluatePolicy(large, [blocked], { maxChangedLines: 0 }).eligible, false);
  assert.equal(evaluatePolicy(large, files, { maxChangedLines: 0, denylist: ['src/**'] }).eligible, false);
  assert.equal(evaluatePolicy(large, files, { maxChangedLines: 0, allowlist: ['docs/**'] }).eligible, false);
  assert.equal(evaluatePolicy({ ...large, changed_files: 2 }, files, { maxChangedLines: 0 }).eligible, false);
});

test('file exclusions remove additions and deletions from the strict limit', () => {
  const changed = [
    { filename: 'src/main.js', additions: 500, deletions: 499 },
    { filename: 'uv.lock', additions: 2000, deletions: 2000 },
  ];
  const large = { ...pr, additions: 2500, deletions: 2499, changed_files: 2 };
  assert.equal(evaluatePolicy(large, changed).eligible, false);
  assert.equal(evaluatePolicy(large, changed, { lineCountExclude: ['uv.lock'] }).eligible, true);
  assert.equal(evaluatePolicy(large, [{ ...changed[0], deletions: 500 }, changed[1]], { lineCountExclude: ['uv.lock'] }).eligible, false);
  assert.equal(evaluatePolicy(large, changed, { lineCountExclude: ['**/*.lock'] }).eligible, true);
});

test('excluded files still undergo every path rule and complete-file checks', () => {
  for (const path of ['uv.lock', '.github/copilot-instructions.md']) {
    const changed = [{ filename: path, additions: 2000, deletions: 2000 }];
    assert.equal(evaluatePolicy(pr, changed, { lineCountExclude: ['**'], denylist: [path] }).eligible, false);
    assert.equal(evaluatePolicy(pr, changed, { lineCountExclude: ['**'], allowlist: ['src/**'] }).eligible, false);
  }
  assert.equal(evaluatePolicy(pr, [{ filename: '.github/copilot-instructions.md' }], { lineCountExclude: ['**'] }).eligible, false);
  assert.equal(evaluatePolicy({ ...pr, changed_files: 2 }, files, { lineCountExclude: ['**'] }).eligible, false);
});

test('renamed files are excluded only if both old and new paths are excluded', () => {
  const renamed = { filename: 'uv.lock', previous_filename: 'src/main.js', status: 'renamed', additions: 1000, deletions: 5 };
  assert.equal(evaluatePolicy(pr, [renamed], { lineCountExclude: ['uv.lock'] }).eligible, false);
  assert.equal(evaluatePolicy(pr, [{ ...renamed, filename: 'src/main.js', previous_filename: 'uv.lock' }], { lineCountExclude: ['uv.lock'] }).eligible, false);
  assert.equal(evaluatePolicy(pr, [{ ...renamed, previous_filename: 'old.lock' }], { lineCountExclude: ['**/*.lock'] }).eligible, true);
  assert.equal(evaluatePolicy(pr, [{ ...renamed, previous_filename: undefined }], { lineCountExclude: ['uv.lock'] }).eligible, false);
});

test('nonexcluded file counts must be complete; all-excluded PRs count as zero', () => {
  for (const metadata of [{}, { additions: 3 }, { additions: NaN, deletions: 1 }, { additions: 1, deletions: -1 }]) {
    assert.equal(evaluatePolicy(pr, [{ filename: 'src/main.js', ...metadata }], { lineCountExclude: ['uv.lock'] }).eligible, false);
  }
  assert.equal(evaluatePolicy(pr, [{ filename: 'uv.lock' }], { lineCountExclude: ['uv.lock'] }).eligible, true);
  assert.throws(() => evaluatePolicy(pr, files, { maxChangedLines: 0, lineCountExclude: ['!uv.lock'] }));
});

test('instruction additions, deletions and both sides of renames are blocked', () => {
  for (const path of ['.github/copilot-instructions.md', '.github/instructions/a/b.instructions.md',
    '.github/skills/code-review/SKILL.md', '.github/agents/reviewer.agent.md', '.github/prompts/review.prompt.md',
    'AGENTS.md', 'src/CLAUDE.md']) {
    for (const status of ['added', 'removed', 'modified']) {
      assert.equal(evaluatePolicy(pr, [{ filename: path, status }]).eligible, false);
    }
    assert.equal(evaluatePolicy(pr, [{ filename: 'doc.md', status: 'renamed', previous_filename: path }]).eligible, false);
    assert.equal(evaluatePolicy(pr, [{ filename: path, status: 'renamed', previous_filename: 'doc.md' }]).eligible, false);
  }
});

test('allowlist alone, denylist alone, and combined lists', () => {
  assert.equal(evaluatePolicy(pr, files, { allowlist: ['src/**'] }).eligible, true);
  assert.equal(evaluatePolicy(pr, files, { allowlist: ['docs/**'] }).eligible, false);
  assert.equal(evaluatePolicy(pr, files, { denylist: ['src/**'] }).eligible, false);
  assert.equal(evaluatePolicy(pr, files, { allowlist: ['src/**'], denylist: ['**/main.js'] }).eligible, false);
  assert.equal(evaluatePolicy(pr, [{ filename: '.github/copilot-instructions.md' }], { allowlist: ['**'] }).eligible, false);
});

test('every changed path and the old name must be allowed', () => {
  assert.equal(evaluatePolicy({ ...pr, changed_files: 2 }, [...files, { filename: 'secret.txt' }], { allowlist: ['src/**'] }).eligible, false);
  assert.equal(evaluatePolicy(pr, [{ filename: 'src/main.js', status: 'renamed', previous_filename: 'secret.txt' }], { allowlist: ['src/**'] }).eligible, false);
});

test('incomplete metadata, draft and closed PRs fail closed', () => {
  for (const override of [{ changed_files: 2 }, { additions: undefined }, { deletions: -1 }, { draft: true }, { state: 'closed' }]) {
    assert.equal(evaluatePolicy({ ...pr, ...override }, files).eligible, false);
  }
  assert.equal(evaluatePolicy(pr, [{ filename: 'src/main.js', status: 'renamed' }]).eligible, false);
});

test('glob semantics and invalid configuration', () => {
  assert.ok(compileGlob('**/AGENTS.md').test('AGENTS.md'));
  assert.ok(compileGlob('src/**/*.js').test('src/main.js'));
  assert.ok(compileGlob('src/**/*.js').test('src/deep/main.js'));
  assert.equal(compileGlob('src/*.js').test('src/deep/main.js'), false);
  assert.ok(compileGlob('file?.txt').test('file1.txt'));
  for (const glob of ['!src/**', '../src/**', '/src/**', 'src/{a,b}']) assert.throws(() => compileGlob(glob));
  for (const limit of [-1, NaN, 1.2, '1000', null, Infinity]) assert.throws(() => evaluatePolicy(pr, files, { maxChangedLines: limit }));
});
