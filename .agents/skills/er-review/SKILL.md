---
name: er-review
description: Review effect-resonate changes before commit or PR for correctness, durable execution semantics, Effect usage, tests, public API stability, and packaging. Use for working-tree, branch, commit, or PR review.
---

# Effect Resonate Review

Review the named scope. When none is named, review staged and unstaged working-tree
changes. Findings are the primary output; summaries and praise are secondary.

## Establish context

Read `.agents/AGENTS.md`, then inspect the diff before selecting reviewers. Read
the matching spec or plan when one exists. Identify changed contracts, ownership
boundaries, state transitions, failure paths, and verification already performed.

For Effect changes, first read `node_modules/effect/AGENTS.md` completely and use
the installed `node_modules/effect/src` to verify uncertain API claims. For
Resonate claims, inspect installed `@resonatehq/sdk/async` types or authoritative
documentation. Do not report remembered library behavior as fact.

## Review lenses

Apply correctness and testing to every behavioral change. Add durability when
Resonate workflows, steps, durable values, retries, or escaped side effects
change. Apply the Effect lens when Effect code changes, architecture for public
APIs, modules, dependencies, or packaging, and tooling for shell, direnv,
worktree, symlink, lock, or dependency-bootstrap changes.

Use the reviewer prompts under `.agents/agents/` as bounded helpers when their
lens has meaningful work. Dispatch at most six reviewers, keep each scope narrow,
and synthesize the result yourself. A helper's claim is not a finding until you
verify its failure path and current file/line reference.

## Required checks

- Trace null, empty, malformed, repeated, concurrent, timed-out, cancelled, and
  partially failed execution where each case is possible.
- Preserve the boundary: workflows own durable Resonate operations; registered
  steps own arbitrary Effect programs.
- Check replay safety, retry semantics, idempotency assumptions, and side effects
  that could occur twice.
- Check durable values for JSON compatibility and runtime decoding at actual
  trust boundaries.
- Check public exports, declaration output, peer dependency placement, and the
  bundler-free `zshy` contract when package shape changes.
- Require tests to prove observable behavior or an invariant. Do not request
  tests that only mirror implementation structure.

Run the smallest relevant verification first. Broaden to `pnpm check` and
`pnpm test` when the diff warrants it. Review may continue if a command cannot
run, but record the resulting uncertainty.

## Report

Order verified findings by severity:

- **Must fix**: data loss, broken durability, incorrect public behavior,
  unrecoverable failure, or a release-breaking package contract.
- **Should fix**: realistic correctness or maintenance failure that does not
  block every use.
- **Nice to have**: a concrete improvement with limited impact. Omit style-only
  preferences.

For each finding include `file:line`, the triggering input or execution sequence,
impact, and a concrete correction. Deduplicate overlapping reviewer output.

Finish with:

1. Verdict: `ship 🟢`, `fix-first 🟡`, or `needs-work 🔴`.
2. At-a-glance list of reviewed modules and lenses.
3. Verification commands and results.
4. Residual risks or unverified assumptions.

If there are no findings, say so directly and still report verification and
residual risk.
