import { readFileSync, appendFileSync } from 'node:fs';
import { githubClient } from './github.js';
import { approvePullRequest } from './approval.js';

const input = name => process.env[`INPUT_${name.toUpperCase()}`]?.trim() ?? '';
const globs = name => input(name).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const escape = value => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

try {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const limit = input('max-changed-lines') || '1000';
  if (!/^\d+$/.test(limit)) throw new Error('max-changed-lines must be a positive integer.');
  const dryRun = input('dry-run') || 'false';
  if (!['true', 'false'].includes(dryRun)) throw new Error('dry-run must be true or false.');
  const result = await approvePullRequest({
    api: githubClient(input('github-token'), process.env.GITHUB_API_URL),
    repository: process.env.GITHUB_REPOSITORY,
    number: Number(input('pull-request-number') || event.pull_request?.number),
    policy: { maxChangedLines: Number(limit), allowlist: globs('allowlist'), denylist: globs('denylist') },
    dryRun: dryRun === 'true',
    ...(input('review-author') ? { reviewAuthor: input('review-author') } : {}),
    ...(input('approval-regexp') ? { approvalRegexp: input('approval-regexp') } : {}),
  });
  if (process.env.GITHUB_OUTPUT) {
    for (const [key, value] of Object.entries({ eligible: result.eligible, approved: result.approved,
      'head-sha': result.headSha, 'reviewer-review-id': result.reviewerReviewId ?? '',
      reasons: JSON.stringify(result.reasons) })) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
  const summary = `gha-approval: ${result.approved ? 'approved' : result.eligible ? 'eligible' : 'blocked'}`;
  console.log(summary);
  for (const reason of result.reasons) console.log(JSON.stringify(reason));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `${summary}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
} catch (error) {
  console.log(`::error::${escape(error.message)}`);
  process.exitCode = 1;
}
