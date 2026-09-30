import { evaluatePolicy } from './policy.js';
import { copilotLogin, defaultApprovalRegexp, latestReviewerReview, recommendsApproval } from './copilot.js';

const marker = '<!-- gha-approval -->';

export async function approvePullRequest({ api, repository, number, policy, dryRun = false,
  reviewAuthor = copilotLogin, approvalRegexp = defaultApprovalRegexp }) {
  if (!/^[A-Za-z0-9-]+(?:\[bot\])?$/.test(reviewAuthor)) throw new Error('review-author must be a GitHub username.');
  if (!approvalRegexp) throw new Error('approval-regexp cannot be empty.');
  const regexp = new RegExp(approvalRegexp, 'u');
  if (regexp.test('')) throw new Error('approval-regexp must not match an empty review.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error('A valid repository and pull request number are required.');
  }
  const path = `/repos/${repository}/pulls/${number}`;
  const pr = await api.request(path);
  const sha = pr.head?.sha;
  if (!sha || !pr.base?.sha) throw new Error('Pull request commit metadata is missing.');
  const [files, reviews] = await Promise.all([api.list(`${path}/files`), api.list(`${path}/reviews`)]);
  const result = evaluatePolicy(pr, files, policy);
  const review = latestReviewerReview(reviews, sha, reviewAuthor);
  if (!recommendsApproval(review, regexp)) result.reasons.push(`Latest ${reviewAuthor} review for the current commit does not explicitly recommend approval.`);
  result.eligible = result.reasons.length === 0;
  result.approved = false;
  result.headSha = sha;
  result.reviewerReviewId = review?.id;
  if (!result.eligible) return result;
  // Skip an existing approval from this action on this commit (safe on reruns).
  if (reviews.some(item => item.commit_id === sha && item.state === 'APPROVED' && item.body?.startsWith(marker))) {
    result.reasons.push('An gha-approval approval already exists for this commit.');
    return result;
  }
  // Recheck mutable PR state and review state immediately before writing.
  const fresh = await api.request(path);
  const freshReviews = await api.list(`${path}/reviews`);
  const freshReview = latestReviewerReview(freshReviews, sha, reviewAuthor);
  if (fresh.head?.sha !== sha || fresh.base?.sha !== pr.base.sha || fresh.state !== 'open' || fresh.draft !== false ||
      fresh.additions !== pr.additions || fresh.deletions !== pr.deletions || fresh.changed_files !== pr.changed_files ||
      freshReview?.id !== review.id || !recommendsApproval(freshReview, regexp)) {
    result.eligible = false;
    result.reasons.push('Pull request or reviewer assessment changed during evaluation.');
    return result;
  }
  if (dryRun) {
    result.reasons.push('Dry run: all approval requirements passed.');
    return result;
  }
  const submitted = await api.request(`${path}/reviews`, 'POST', {
    event: 'APPROVE',
    commit_id: sha,
    body: `${marker}\nApproved after ${reviewAuthor} explicitly recommended approval in review ${review.id}.\nAll gha-approval line-count and file-path rules passed for commit ${sha}.`,
  });
  result.approved = true;
  result.approvalReviewId = submitted.id;
  return result;
}
