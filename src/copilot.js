export const copilotLogin = 'copilot-pull-request-reviewer[bot]';
export const defaultApprovalRegexp = '^(?:<!-- ccr-overview-v2 -->\\n\\s*## Copilot review overview\\n\\s*)?### 🟢 Approval recommended[ \\t]*(?:\\n|$)';

function submittedReviewerReviews(reviews, author) {
  return reviews.filter(review => review.user?.login === author &&
    (!author.endsWith('[bot]') || review.user?.type === 'Bot') && review.submitted_at);
}

export function latestReviewerReview(reviews, sha, author = copilotLogin) {
  return submittedReviewerReviews(reviews, author).filter(review => review.commit_id === sha)
    .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at) || b.id - a.id)[0];
}

export function isFirstReviewerReview(reviews, review, author = copilotLogin) {
  const submitted = submittedReviewerReviews(reviews, author);
  return submitted.length === 1 && submitted[0].id === review?.id;
}

export function recommendsApproval(review, regexp = new RegExp(defaultApprovalRegexp, 'u')) {
  if (!review || !['COMMENTED', 'APPROVED'].includes(review.state)) return false;
  const body = String(review.body ?? '').replace(/\r\n/g, '\n').trim();
  // Accept only the top assessment, either standalone or in the observed v2 wrapper.
  // Text quoted in summaries, code, file tables, or findings cannot authorize approval.
  return regexp.test(body);
}
