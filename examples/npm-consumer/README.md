# Published npm consumer

This example installs `@effect-resonate/core` from the npm registry and runs a
workflow against Resonate's in-memory `LocalNetwork`. It needs no database or
Docker. Its version range currently starts at the published `0.1.1` release;
the lockfile pins the resolved npm package.

From the repository root:

```sh
pnpm install
pnpm --filter @effect-resonate/example-npm-consumer test
pnpm --filter @effect-resonate/example-npm-consumer typecheck
```

This checks the released package that a consumer installs. The `in-memory` and
`postgres` examples use `workspace:*` and exercise the current checkout instead.
For pre-release validation of current core changes, `pnpm check:packages` builds
and installs a packed tarball in a clean temporary consumer.
