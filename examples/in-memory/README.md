# In-memory workflow test

This example tests a typed `Welcome` workflow with Resonate's `LocalNetwork`. It runs without PostgreSQL, Docker, or a Resonate server.

From the repository root, install dependencies and run:

```sh
pnpm install
pnpm --filter @effect-resonate/core build
pnpm --filter @effect-resonate/example-in-memory test
```

The test supplies `LocalNetwork` through `ResonateNetwork.layer` and acquires
`ResonateClient.layer` for one test run. The workflow uses `context.run` for its
durable step and `Result.map` to format its success value. This also preserves
the failure branch if a step later declares a typed failure. The test also
asserts Resonate's first-writer-wins behavior: a second run with the same
execution ID returns the first result even when its input differs.

`LocalNetwork` keeps state in the process. Use PostgreSQL for durable state that must survive process restarts; see the [PostgreSQL example](../postgres/README.md) for that setup.
