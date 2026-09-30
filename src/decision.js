import { approvePullRequest } from './approval.js';

const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function decisionComment(result) {
  const status = result.approved ? 'approved' : result.eligible ? 'approval skipped' : 'blocked';
  const lines = [
    '<!-- gha-approval-decision -->',
    `## gha-approval: ${status}`,
    '',
    `Evaluated commit: \`${result.headSha}\`.`,
  ];
  if (result.reviewerReviewId) lines.push(`Reviewer assessment: [review ${result.reviewerReviewId}](#pullrequestreview-${result.reviewerReviewId}).`);
  if (result.approved) lines.push('', 'The reviewer recommendation and all configured approval rules passed. An approving review was submitted.');
  if (result.reasons.length) {
    lines.push('', 'Decision details:', '', `<pre>${escapeHtml(result.reasons.slice(0, 20).map(reason => reason.slice(0, 1000)).join('\n'))}</pre>`);
    if (result.reasons.length > 20) lines.push('', `Showing 20 of ${result.reasons.length} reasons. The complete result is in the workflow job summary.`);
  }
  return lines.join('\n');
}

export async function runApproval({ postComment = true, ...options }) {
  if (typeof postComment !== 'boolean') throw new Error('post-comment must be true or false.');
  const result = await approvePullRequest(options);
  // Dry runs must not mutate the PR, even when comments are enabled by default.
  if (postComment && !options.dryRun) {
    const comment = await options.api.request(`/repos/${options.repository}/issues/${options.number}/comments`, 'POST', {
      body: decisionComment(result),
    });
    result.decisionCommentId = comment.id;
  }
  return result;
}
