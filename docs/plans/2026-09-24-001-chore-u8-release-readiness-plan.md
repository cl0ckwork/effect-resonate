# U8 release readiness

## Summary

Finish the U1–U7 stack as a usable, verifiable pair of npm packages. Replace
implementation-plan language in consumer docs with the shipped contract, run
packed-artifact checks in CI, and prepare an npm trusted-publishing workflow.
First publication occurs only after the npm packages are bootstrapped by their
owner. Later versions are staged with OIDC and approved with npm 2FA.

## Requirements trace

| ID  | Source                       | Outcome                                                                                                           |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| R1  | U8 plan, user request        | README and package docs describe the implemented API and operational contract; plans retain historical decisions. |
| R2  | U8 plan SC10                 | Core and Postgres provider pack independently; core has no `pg` dependency; testing stays private.                |
| R3  | `docs/PACKAGING.md`          | CI checks build, types, tests, packed consumers, and package metadata.                                            |
| R4  | `docs/RELEASE-BRAINSTORM.md` | Changesets prepares version PRs and npm stages via GitHub OIDC, without a persistent npm publish token.           |

## Walkthroughs and invariants

The durable execution walkthroughs and invariants remain in the core spec;
this work does not change execution semantics. Release-specific cases:

| Case                           | Path                                             | Expected result                                                                                                                                  |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Consumer installs core alone   | pack → install peers → import and typecheck      | No `pg` resolution or testing files are required.                                                                                                |
| Consumer installs the provider | pack both → install peers → import and typecheck | Public root and subpath exports resolve to built JS and declarations.                                                                            |
| Release PR merges              | validate → version → stage → approve             | Only public packages with new versions are staged; an unsuccessful gate cannot stage, and no staged version becomes public without 2FA approval. |

Safety: a publish never includes source tests or the private testing package.
Consistency: provider's core peer range matches the released core version.
Liveness: after npm publisher configuration, a merged release PR can stage
without a long-lived npm token. A failed stage leaves a retryable release state.

## Protocol and key decisions

Source and package manifests → `zshy` build → package validation and packed
consumer checks → version PR → GitHub stage job → npm approval. The stage job
rebuilds from the same commit and frozen lockfile after the validation job
passes. CI owns the pre-stage gate; Changesets owns versions/changelogs; npm
owns OIDC authentication. The existing root packed-consumer test checks API
examples and tarball boundaries; a clean consumer installation checks peer
resolution independently. Keep the two production packages separate and
ESM-only. The U7 Postgres suite remains part of regular `pnpm test`;
document its Docker requirement and the existing skip option accurately.

## Implementation units

### U1 — Consumer documentation

Update root and package READMEs plus `docs/PACKAGING.md` to reflect the actual
topology, composition, versioning, ID semantics, retry/idempotency, recovery,
and Postgres prerequisites. Mark deferred acceptance claims accurately.
Test expectation: none; review examples against public entrypoints and run
documentation link checks if available.

### U2 — Artifact gate and CI

Extend the root packed-consumer test where its current assertions do not prove
public runtime resolution or package isolation. Make CI call the root
`pnpm test`, which includes the packed-consumer test, and add package validators.
Verify with `pnpm check`, `pnpm test`, and package validation commands.

### U3 — Version and stage setup

Add Changesets, publish metadata and a release workflow using npm OIDC on a
GitHub-hosted runner with `id-token: write`. Keep release PR permissions apart
from stage permissions. Verify workflow syntax and dry-run package contents;
do not stage or publish a package during implementation.

## Risks and mitigations

- The existing CI command skips root tests: run the root script explicitly.
- Trusted publisher identity must match the workflow filename, repository, and
  GitHub environment: document the npm-side setup for both packages before
  enabling the first release.
- A first release from `0.0.0` and the provider's exact core peer can diverge:
  verify generated version/peer changes before publishing.
- The U7 suite needs Docker in CI: preserve its bounded setup and skip locally
  only when intentionally requested.

## Open questions

The npm scope owner must configure package ownership and trusted publishers.
This is an external release step, not an implementation-time API decision.
