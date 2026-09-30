export const copilotLogin = 'copilot-pull-request-reviewer[bot]';
export const defaultApprovalRegexp = '^(?:<!-- ccr-overview-v2 -->\\n\\s*## Copilot review overview\\n\\s*)?### 🟢 Approval recommended[ \\t]*(?:\\n|$)';

export function latestReviewerReview(reviews, sha, author = copilotLogin) {
  return reviews.filter(review => review.user?.login === author &&
    (!author.endsWith('[bot]') || review.user?.type === 'Bot') && review.commit_id === sha && review.submitted_at)
    .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at) || b.id - a.id)[0];
}

export function recommendsApproval(review, regexp = new RegExp(defaultApprovalRegexp, 'u')) {
  if (!review || !['COMMENTED', 'APPROVED'].includes(review.state)) return false;
  const body = String(review.body ?? '').replace(/\r\n/g, '\n').trim();
  // Accept only the top assessment, either standalone or in the observed v2 wrapper.
  // Text quoted in summaries, code, file tables, or findings cannot authorize approval.
  return regexp.test(body);
}
