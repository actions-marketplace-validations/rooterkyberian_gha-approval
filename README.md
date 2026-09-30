# gha-approval

A GitHub Action that approves a pull request only when a trusted review explicitly
recommends approval and all configured policy rules pass. Defaults target GitHub
Copilot; the reviewer username and detection regex are configurable.

## Usage

Add this workflow to the consuming repository's default branch:

```yaml
name: Approve eligible PRs
on:
  pull_request_review:
    types: [submitted, edited, dismissed]
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: gha-approval-${{ github.event.pull_request.number }}
  cancel-in-progress: false
jobs:
  approve:
    if: github.event.review.user.login == 'copilot-pull-request-reviewer[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: rooterkyberian/gha-approval@main
        with:
          max-changed-lines: '1000'
          line-count-exclude: |
            uv.lock
            **/package-lock.json
          allowlist: |
            src/**
            test/**
            docs/**
          denylist: |
            src/auth/**
            **/*.pem
          dry-run: 'false'
```

Pin `uses` to a reviewed commit SHA for production. This action requires no checkout
and never executes PR code. While this repository is private, allow the consuming
repositories to access it under **Settings → Actions → General → Access**.

Enable **Allow GitHub Actions to create and approve pull requests** in the consuming
repository's Actions settings. Repository and organization policies determine
whether the resulting bot approval satisfies merge requirements. If native Copilot
approvals are enabled, those approvals operate independently of these rules; disable
native approvals if this action should be the sole automatic approval path.

The workflow above works with a writable token for same-repository PRs. Fork review
workflows normally have a read-only `GITHUB_TOKEN`. To handle forks, invoke the action
from a trusted workflow with a suitably scoped GitHub App token or PAT and an explicit
`pull-request-number`. Never check out or run the PR head in that privileged workflow.
Supplying a token cannot bypass repository or organization permission restrictions.

## Rules

- Added plus deleted lines must be **strictly less than** `max-changed-lines`
  (default 1000). Set `max-changed-lines: '0'` to disable this size check.
- `line-count-exclude` accepts newline-separated file globs (for example, `uv.lock`).
  When set, the size check sums additions plus deletions for nonexcluded files.
  Excluded files still must pass all allowlist, denylist and instruction rules;
  add them to your allowlist too if you use one. A rename is excluded only when
  both its old and new paths match the exclusion list. Missing counts for a
  nonexcluded file block approval. If every file is excluded, the count is zero.
  Renames, binaries and metadata-only changes still undergo path checks.
- Every changed file must match at least one allowlist glob when an allowlist is set.
- No changed file may match a denylist glob. A denylist match always wins.
- Either list can be used alone, or both can be combined. Empty lists impose no
  additional path restrictions. Lists contain one glob per line.
- Changes to `.github/copilot-instructions.md`, anything in `.github/instructions/`,
  `.github/agents/`, `.github/skills/`, `.github/prompts/`,
  and any `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` always block approval. Add denylist
  entries for other files referenced by your instructions or used as review context.
- Additions, modifications, deletions and both the old and new paths of renames are
  checked. Protected instruction rules cannot be disabled by the allowlist.
- Draft, closed, empty, or incompletely enumerated PRs cannot be approved.
- The latest submitted review by the configured author **on the current head SHA**
  must be `COMMENTED` or `APPROVED` and match the approval regex. Dismissed reviews,
  requests for changes, missing reviews and stale reviews do not qualify.

Globs are relative to the repository root. `*` matches within one directory, `**`
matches across directories, `?` matches one non-slash character, and `**/` includes
zero directories. Matching is case insensitive. Negation, braces, character classes,
absolute paths, backslashes and `..` segments are rejected. Use the two lists to
express exclusions instead of negated globs.

## Review detection

On September 30, 2026, reviews from the preceding week showed this assessment format:

```markdown
<!-- ccr-overview-v2 -->

## Copilot review overview

### 🟢 Approval recommended
```

Sources: [cork #23, September 30](https://github.com/john-noble-joby/cork/pull/23#pullrequestreview-5370295460),
[mxc #1348, September 30](https://github.com/microsoft/mxc/pull/1348#pullrequestreview-5369204934),
and a negative assessment in [rocm-systems #12363, September 28](https://github.com/ROCm/rocm-systems/pull/12363#pullrequestreview-5337586383).

The default detector accepts the exact green heading at the start of the body,
optionally preceded by the v2 wrapper above. It rejects approval phrases inside
quotes, code blocks or summaries. A recommendation can coexist with low-severity
findings; zero findings are not required.

Customize detection for another reviewer or a changed format:

```yaml
with:
  review-author: my-reviewer-bot[bot]
  approval-regexp: '^Decision: APPROVE(?:\n|$)'
```

Update the workflow's job `if` condition to match the new username too.
`approval-regexp` is JavaScript regex **source**, without `/.../` delimiters, compiled
with the `u` flag. The body is trimmed and CRLF is normalized to LF. Inline multiline
matching is not enabled; use explicit newline expressions or `[\s\S]` as needed.
An omitted/blank input uses the default detector. Invalid patterns and patterns
matching an empty body fail the action. Use anchored, unambiguous patterns; custom
regexes control the trust decision and can accept quoted text if written broadly.
Regex configuration must live in a trusted workflow, never be supplied from PR text.

## Inputs and outputs

| Input | Default | Purpose |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token with pull requests write permission |
| `pull-request-number` | Event's PR number | Override for trusted/manual workflows |
| `max-changed-lines` | `1000` | Exclusive additions + deletions threshold; `0` disables |
| `line-count-exclude` | Empty | Newline-separated globs omitted from the line count |
| `allowlist` | Empty | Newline-separated allowed globs |
| `denylist` | Empty | Newline-separated additional blocked globs |
| `review-author` | `copilot-pull-request-reviewer[bot]` | Exact trusted reviewer username |
| `approval-regexp` | Strict Copilot heading detector | Custom positive assessment regex |
| `dry-run` | `false` | Evaluate without submitting approval |

Outputs: `eligible`, `approved`, `head-sha`, `reviewer-review-id`, and `reasons`
(a JSON array). A policy rejection is a successful run with `eligible=false`;
configuration and API errors fail the action. Every run emits a job summary.

PR state, head, base and reviewer assessment are checked again before submission.
Approvals are pinned to the evaluated head SHA and existing action approvals are
skipped on reruns. Serialize workflow runs with the concurrency group shown above.
GitHub does not offer an atomic compare-and-approve API: enable dismissal of stale
approvals in branch protection so new commits require a fresh review. This action
does not retract an existing approval when rules or an assessment later change.

## Development

This repository uses the action in [`.github/workflows/approval.yml`](.github/workflows/approval.yml).
Copilot review submissions and edits trigger evaluation with a strict 1000-line
limit. Source, tests, README, license, action metadata, package manifests and
`.gitignore` are allowlisted; all `.github/` changes are denied. Mandatory instruction
protections still apply. The workflow pins the action to a reviewed commit; update
that SHA deliberately when adopting action changes.

The workflow can also be dispatched manually with a PR number; manual runs default
to dry run. Copilot must have reviewed the current PR head and recommended approval
before even a manual run can approve. Request a Copilot review in the PR's Reviewers
menu if the repository does not already request reviews automatically.

The approval job uses `ubuntu-slim`. The action needs only the runner's Node.js 24
runtime and outbound HTTPS to the GitHub API; no Docker, package install, checkout,
or privileged operations are needed. GitHub limits slim jobs to 15 minutes; this
repository caps the approval job at 5 minutes.

Node.js 24 or newer. No runtime or development dependencies.

```sh
npm test
```

Tests cover policy boundaries, disabled limits, line-count exclusions and renames,
protected instructions, list precedence,
review parsing and identity, custom regexes, stale/newer reviews, pagination, dry runs,
duplicate approvals and changes detected before submission. CI runs the same tests.

Licensed under [MIT](LICENSE).
