# In-memory workflow test

This example tests a typed `Welcome` workflow with Resonate's `LocalNetwork`. It runs without PostgreSQL, Docker, or a Resonate server.

From the repository root, install dependencies and run:

```sh
pnpm install
pnpm --filter @effect-resonate/core build
pnpm --filter @effect-resonate/example-in-memory test
```

The test supplies `LocalNetwork` through `ResonateNetwork` and acquires `ResonateClient.layer` for one test run. It asserts the workflow's output and Resonate's first-writer-wins behavior: a second run with the same execution ID returns the first result even when its input differs.

`LocalNetwork` keeps state in the process. Use PostgreSQL for durable state that must survive process restarts; see the [PostgreSQL example](../postgres/README.md) for that setup.
