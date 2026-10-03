# Set up gha-approval in your repository

gha-approval turns an explicit recommendation from a trusted reviewer into an
approving GitHub review, provided every configured rule passes. This guide uses
Copilot, but `review-author` and `approval-regexp` support other reviewers.

## 1. Make the action available

This action is public; use `rooterkyberian/gha-approval@v0.1` from your repository.
For production, pin to the full commit SHA shown on the release instead of a tag.

If you host a private copy, GitHub permits private action sharing with
other private repositories under the same user or organization. In the **action
repository**, open **Settings → Actions → General → Access**, select the permitted
owner scope, and save. That setting does not grant access across arbitrary owners
or from public repositories. See [GitHub's private action sharing guide](https://docs.github.com/en/actions/how-tos/reuse-automations/share-across-private-repositories).

If you host your own copy, copy the repository including `action.yml`,
`package.json`, `src/`, and `LICENSE`, publish a tag or choose a commit SHA, and
replace `rooterkyberian/gha-approval` in the examples with your action repository.
No build, bundling, or dependency installation is required.

## 2. Enable workflow approval permissions

In the **repository whose PRs will be approved**, open **Settings → Actions →
General**. Allow this action under the repository's action policy. Under
**Workflow permissions**, enable **Allow GitHub Actions to create and approve
pull requests**. Organization policies may control this option.

Keep the default workflow token permission at read access. The approval job below
explicitly requests `pull-requests: write`; that also permits decision comments on
PRs. It does not need `contents: write`, a checkout, or a secret for same-repository
PRs. See [GitHub's workflow permission settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).

## 3. Add the workflow

Save this as `.github/workflows/gha-approval.yml` on the default branch. Adjust the
allowlist and denylist to your repository, then merge the initial configuration
through your normal review process.

```yaml
name: gha-approval

on:
  workflow_run:
    workflows: [Copilot]
    types: [completed]
  workflow_dispatch:
    inputs:
      pull-request-number:
        description: Pull request to evaluate
        required: true
        type: string
      dry-run:
        description: Evaluate without approving or commenting
        type: boolean
        default: true

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: gha-approval-${{ github.event.workflow_run.pull_requests[0].number || inputs.pull-request-number }}
  cancel-in-progress: false

jobs:
  approve:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event.workflow_run.conclusion == 'success' &&
       github.event.workflow_run.pull_requests[0].number != null)
    runs-on: ubuntu-slim
    timeout-minutes: 5
    steps:
      - uses: rooterkyberian/gha-approval@v0.1
        with:
          pull-request-number: ${{ github.event.workflow_run.pull_requests[0].number || inputs.pull-request-number }}
          dry-run: ${{ github.event_name == 'workflow_dispatch' && inputs.dry-run && 'true' || 'false' }}
          max-changed-lines: '1000'
          line-count-exclude: |
            **/*.lock
            **/package-lock.json
          allowlist: |
            src/**
            test/**
            docs/**
            README.md
            uv.lock
            **/package-lock.json
          denylist: |
            .github/**
            src/auth/**
            **/*.pem
          review-author: copilot-pull-request-reviewer[bot]
          post-comment: 'true'
```

Every changed file must pass the path rules. A denylist match wins over the
allowlist. Excluding a lockfile from the line count does not allow its path: include
it in the allowlist too. Set `max-changed-lines: '0'` to disable the size limit.
Set `post-comment: 'false'` to disable decision comments. Dry runs never post an
approval or comment. The [README](../README.md#rules) describes all glob rules and
mandatory instruction protections.

Optionally add `first-review-only: 'true'` under `with` to permit automatic approval
only after Copilot's first submitted review of the entire PR. The default is
`false`. Reviews of earlier commits and dismissed reviews still count, so a second
Copilot review blocks approval even if it recommends approval. Other reviewers and
pending drafts do not count. Use this option if follow-up reviews that repeat old
comments should not authorize approval; subsequent reviews require human approval.
The first review must still recommend approval for the current head and pass every
other rule.

`workflow_run` executes the workflow from the default branch after Copilot's
review workflow completes. The filter uses its registered workflow name,
**Copilot**; the displayed run title, **Running Copilot Code Review**, is not the
registered name. It must be installed on that branch before it can trigger.
GitHub can still require a maintainer to approve the run; see the gate results below.
This repository's checked-in `.github/workflows/approval.yml` also retains
`Running Copilot Code Review` as an extra filter entry. That entry is redundant
here: the registered `Copilot` entry is what matches. The consumer example above
uses that registered name alone.
The action reads current PR and review data from GitHub; it does not
download upstream artifacts or execute PR code. If GitHub changes Copilot's workflow
name, update the `workflows` filter to match its registered workflow name. The
Actions workflows API exposes that name under `name`; a run title can differ. Reviews
that do not use Copilot's Actions workflow need another trigger or manual dispatch.
See [GitHub's workflow_run event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

## 4. Configure Copilot reviews

Request Copilot reviews manually in the PR's **Reviewers** menu, or enable
automatic reviews in your personal **Copilot settings → Code review** settings.
Enable **Review new pushes** so updated PR heads can receive a fresh assessment.
Repositories and organizations can also request reviews through rulesets.

Choose **Lite** effort for routine testing in the PR's Copilot review menu or your
personal review settings. Existing PRs can retain their previous effort selection.
The review overview reports the effort actually used. See [Copilot review configuration](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review).

If gha-approval should control automatic approvals, disable native Copilot
auto-approvals. Otherwise Copilot may approve independently of this action's rules.
Keep Copilot reviewing and producing approval assessments.

### GitHub's workflow approval gate

Copilot-triggered review workflows may appear as **workflow awaiting approval**
before gha-approval starts. This GitHub gate is separate from required PR reviews.
Until the workflow runs, the action cannot evaluate or approve the PR.

GitHub documents a repository setting at **Settings → Copilot → Cloud agent →
Actions workflow approval → Require approval for workflow runs**. In this
repository, disabling it did **not** remove the gate for a `pull_request_review`
event from Copilot. The follow-up `workflow_run` test triggered successfully from
the default branch but also stopped with `action_required`, before any job ran.
Using `workflow_run` did not bypass the gate. See the
[review-event test](https://github.com/rooterkyberian/gha-approval/actions/runs/36788729940)
and [workflow-run test](https://github.com/rooterkyberian/gha-approval/actions/runs/36789547531).
See
[GitHub's Copilot workflow approval setting](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/configuring-agent-settings).

When a run is gated, use **Approve workflows to run** or rerun the workflow as a
maintainer. A manual dispatch also evaluates the selected PR and still requires
the configured review recommendation and every policy rule. This repository
verified approvals and decision comments using maintainer-triggered runs; fully
unattended Copilot-triggered execution remains subject to GitHub's gate.

## 5. Require approvals and CI before merging

In **Settings → Branches**, add or edit protection for your default branch
(or configure equivalent rules under **Settings → Rules → Rulesets**):

1. Require a pull request before merging and at least **one approving review**.
2. Enable **Dismiss stale pull request approvals when new commits are pushed**.
3. Run your repository's existing test/build workflow on PRs and require its check
   under **Require status checks to pass before merging**. Select a check that has
   already run, for example `test`; enable up-to-date branches if desired.
4. Apply the requirements to administrators too if that is your merge policy.

GitHub's plan and organization policies determine which protections are available
and whether a bot approval satisfies them. See [branch protection setup](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule).

CI and approvals are independent: gha-approval can approve before CI finishes, and
GitHub prevents merging until required CI passes. Do not use a green gha-approval
job as the required test check: policy rejections are successful evaluations too.
The action never merges PRs.

## 6. Verify with a small PR

Create a PR with one small change in an allowlisted file, such as `README.md`.
Leave `.github/` and instruction files untouched. Let Copilot review the current
head; expect the heading `### 🟢 Approval recommended` for a favorable assessment.

Check the Actions run, then look for an **APPROVED** review from the account behind
the action token (normally `github-actions[bot]`). With comments enabled, the PR
also receives a **gha-approval: approved** decision comment. Required CI must pass
before GitHub allows merging.

To evaluate without writing, select **Actions → gha-approval → Run workflow**,
enter the PR number, and leave **dry-run** checked. The job summary includes
`eligible`, `approved`, the evaluated commit and rejection reasons.

| Symptom | Check |
| --- | --- |
| No approval job started | Workflow is on the default branch; Copilot's review workflow name matches; the completed run is attached to a PR |
| Workflow awaiting approval | Approve the run, rerun as a maintainer, or dispatch manually; the tested Copilot setting and `workflow_run` did not remove this gate |
| Green job, no approving review | Decision comment/job summary: allowlist, denylist, line limit, draft state, stale review, or dry run |
| Copilot recommends approval, action blocks | Recommendation is only one requirement; every changed path and the size limit must pass too |
| A new commit loses approval | Expected when stale approvals are dismissed; request a fresh review of that head, or human approval when `first-review-only` is enabled |
| API returns 403 | Job token has PR write permission and repository/organization approval policies allow it |
| Action cannot be downloaded | Version exists, allowed-action policy permits it, and private-action sharing is configured |
| Approval exists but merge is blocked | Required CI, branch freshness, additional review requirements, or repository policies |

## Fork PRs

The workflow above is for same-repository PRs with a writable token. Fork review
workflows normally have a read-only `GITHUB_TOKEN` and no secrets. For fork support,
invoke the action from a trusted workflow with a scoped GitHub App token or PAT and
an explicit `pull-request-number`. Run that privileged workflow from trusted
configuration; never check out or execute the PR head. A token cannot override
repository or organization permission restrictions.
