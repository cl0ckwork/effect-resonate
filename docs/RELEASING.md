# Releasing effect-resonate

`@effect-resonate/core` is public; `@effect-resonate/testing` stays private.
Changesets records version and changelog intent. The release workflow validates
core and stages later versions with npm trusted publishing. A maintainer
approves each staged version with npm two-factor authentication before it is
public.

## Bootstrap the npm package name

If the core package name does not exist on npm, its scope owner must publish it
before automated OIDC staging can work: npm trusted publishers and staged
publishing require an existing package. Prepare the bootstrap version and
review the packed artifact in a release PR. From an authenticated maintainer
environment, publish core at the reviewed version. Publishing is irreversible;
do not run this step as part of a PR check. The manual bootstrap does not
receive OIDC provenance; later staged releases do.

The publishing account must own or have publish access to the `effect-resonate`
npm organization, which owns the `@effect-resonate` scope. Create the
organization on npm's free public-packages plan if the scope does not exist.

After the reviewed version PR has merged, verify the core manifest no longer
has `0.0.0`. Run the publish command if that version is not already live on npm:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
(cd packages/core && npm publish --access public --registry https://registry.npmjs.org/)
```

The automated staging script waits until the core package name exists on npm.
The release workflow checks for an unpublished version before requesting access
to the protected `npm` environment; pushes with no version to stage finish
without a deployment approval.

After core exists on npm, configure its GitHub Actions trusted publisher:

- GitHub owner/repository: `cl0ckwork/effect-resonate`
- Workflow filename: `release.yml`
- Environment name: `npm`
- Allowed action: `npm stage publish` only

An authenticated maintainer can configure this through npm CLI 11.15 or newer:

```sh
npm trust github @effect-resonate/core --file release.yml \
  --repo cl0ckwork/effect-resonate --env npm --allow-stage-publish
```

Enable GitHub Actions' **Allow GitHub Actions to create and approve pull
requests** setting so the Changesets version job can open its release PR.
Create a protected GitHub environment named `npm` with required reviewers and
deployment branches restricted to `main`. The npm trusted publisher's
environment name must match it exactly.
After a staged release succeeds, set the npm package's publishing access to
require 2FA and disallow traditional publish tokens; the stage-only trusted
publisher continues to work through OIDC.

Use the exact workflow filename; npm matches these fields to the GitHub OIDC
claims. The staging job uses a GitHub-hosted runner, Node 24, npm 11.20.0,
and `id-token: write`. Staged publishing requires npm 11.15.0 or newer.
Provenance is requested when staging and becomes visible after approval for a
public package from a public repository. See npm's
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[staged publishing](https://docs.npmjs.com/staged-publishing/) guides.

## Normal release flow

1. Add a Changeset with `pnpm changeset` in a feature PR that changes core.
   Describe user-visible changes and choose the version bump deliberately.
   Package README changes that should reach npm need a
   Changeset; repository-only docs, tests, and private tooling do not.
2. Merge the feature PR. The release workflow opens or updates a version PR
   with the package version, lockfile, and changelog. Its validation job checks
   the generated version state before opening the PR.
3. Review the version PR and packed package checks. GitHub may require a
   maintainer to approve CI runs
   created by the Actions token; approve and wait for those checks before
   merging.
4. The release workflow validates core and stages versions absent from npm
   through the npm CLI and OIDC. Review the staged tarball on npmjs.com or with
   `npm stage list`, then approve it with 2FA. A staged version is not
   installable until approval. Verify the package page, version, and provenance
   after approval. A rerun skips live versions. If npm rejects a stage attempt,
   inspect pending versions on npmjs.com or with an authenticated
   `npm stage list`. Approve an exact matching stage with 2FA, then rerun the
   workflow; investigate any other conflict before retrying. The OIDC staging
   job cannot inspect pending versions, so it stops on errors.

`pnpm check` builds and validates core with `publint`,
`@arethetypeswrong/cli`, and a fresh packed consumer. `pnpm test` runs the
root packed-consumer tests, package tests, and Docker-backed Postgres tests.
Run both locally before merging a release PR. When Docker is unavailable,
`SKIP_POSTGRES_TESTS=true pnpm test` is a local-only narrower check; CI runs
the full suite.
