# Releasing effect-resonate

Two packages are public: `@effect-resonate/core` and
`@effect-resonate/network-postgres`. `@effect-resonate/testing` stays private.
Changesets records version and changelog intent; the release workflow validates
the packages and stages later versions with npm trusted publishing. A maintainer
approves each staged version with npm two-factor authentication before it is
public.

## Before the first release

Both package names are currently absent from the public npm registry. npm
trusted publishers and staged publishing require an existing package, so the
npm scope owner must bootstrap each package before automated OIDC staging can
work. Prepare the first version and review both packed artifacts in a release
PR. From an authenticated maintainer environment, publish core
first and the Postgres provider second at the reviewed versions. Publishing is
irreversible; do not run this step as part of a PR check.
The manual bootstrap does not receive OIDC provenance; later staged releases
do.

After the reviewed version PR has merged, verify neither manifest still has
`0.0.0` and that the provider's `@effect-resonate/core` peer range matches the
core version. Then run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
(cd packages/core && npm publish --access public --registry https://registry.npmjs.org/)
(cd packages/network-postgres && npm publish --access public --registry https://registry.npmjs.org/)
```

The automated staging script waits until **both** package names already exist
on npm, so a partial bootstrap never causes it to stage the other package.

After both packages exist, configure a GitHub Actions trusted publisher on
**each** npm package:

- GitHub owner/repository: `cl0ckwork/effect-resonate`
- Workflow filename: `release.yml`
- Environment name: `npm`
- Allowed action: `npm stage publish` only

Enable GitHub Actions' **Allow GitHub Actions to create and approve pull
requests** setting so the Changesets version job can open its release PR.
Create a protected GitHub environment named `npm` with required reviewers and
deployment branches restricted to `main`. The npm trusted publisher's
environment name must match it exactly.
After a staged release succeeds, set each npm package's publishing access to
require 2FA and disallow traditional publish tokens; the stage-only trusted
publisher continues to work through OIDC.

Use the exact workflow filename; npm matches these fields to the GitHub OIDC
claims. The staging job uses a GitHub-hosted runner, Node 24, npm 11.20.0,
and `id-token: write`. Staged publishing requires npm 11.15.0 or newer.
Provenance is requested when staging and becomes visible after approval for
public packages from a public repository. See npm's
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[staged publishing](https://docs.npmjs.com/staged-publishing/) guides.

## Normal release flow

1. Add a Changeset with `pnpm changeset` in a feature PR that changes a public
   package. Describe user-visible changes and choose each package's version
   bump deliberately. Package README changes that should reach npm need a
   Changeset; repository-only docs, tests, and private tooling do not.
2. Merge the feature PR. The release workflow opens or updates a version PR
   with package versions, lockfile, and changelogs. Its validation job checks
   the generated version state before opening the PR.
3. Review the version PR, including the provider's core peer range and the
   packed package checks. GitHub may require a maintainer to approve CI runs
   created by the Actions token; approve and wait for those checks before
   merging.
4. The release workflow validates the packages and stages versions absent
   from npm through the npm CLI and OIDC. Review each staged tarball on
   npmjs.com or with `npm stage list`, then approve it with 2FA. A staged
   version is not installable until approval. Verify both package pages,
   versions, and provenance after approval. A rerun safely skips live versions
   and tolerates versions already staged.

`pnpm check` builds and validates the packages with `publint`,
`@arethetypeswrong/cli`, and a fresh packed consumer. `pnpm test` runs the
root packed-consumer tests, package tests, and Docker-backed Postgres tests.
Run both locally before merging a release PR. When Docker is unavailable,
`SKIP_POSTGRES_TESTS=true pnpm test` is a local-only narrower check; CI runs
the full suite.
