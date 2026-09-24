# effect-resonate

Use [Effect](https://effect.website/) services, typed errors, and Layers with
[Resonate](https://resonatehq.io/) durable execution. Resonate handles workflow
orchestration, replay, timers, and retries. Effect runs application work inside
registered steps and manages client and network resources.

## Install

Node.js 22 or newer is required. For the PostgreSQL provider, install both
packages and their peer dependencies:

```sh
pnpm add @effect-resonate/core @effect-resonate/network-postgres effect @resonatehq/sdk pg
```

Provision the Resonate PostgreSQL schema and `pg_cron` extension before starting
the client. See the
[Postgres setup guide](./packages/network-postgres/README.md#database-setup).

If you supply another network provider, install `@effect-resonate/core`,
`effect`, and `@resonatehq/sdk` without the PostgreSQL package or `pg`.

## Quick start

This example registers a durable workflow that calls an Effect step. Set
`DATABASE_URL` to a prepared PostgreSQL database; the
[PostgreSQL example](./examples/postgres/README.md) shows how to bootstrap one.

```ts
import { ResonateClient, ResonateFunctions, Step, Workflow } from "@effect-resonate/core"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { Config, Effect, Layer, Redacted, Schema } from "effect"

const Uppercase = Step.make({
  name: "text.uppercase",
  version: 1,
  input: Schema.String,
  success: Schema.String,
  failure: Schema.Never
})

const Echo = Workflow.make({
  name: "text.echo",
  version: 1,
  input: Schema.String,
  success: Schema.String,
  failure: Schema.Never
})

const UppercaseLive = Uppercase.toLayer((input) => Effect.succeed(input.toUpperCase()))
const EchoLive = Echo.toLayer(async (context, input) => context.run(Uppercase, input))

const NetworkLive = Layer.unwrap(
  Config.Redacted("DATABASE_URL").pipe(
    Effect.map((url) => PostgresNetwork.layer({ connectionString: Redacted.value(url) }))
  )
)

const ClientLive = ResonateClient.layer({
  functions: ResonateFunctions.make(Uppercase, Echo),
  drainTimeout: "30 seconds"
}).pipe(Layer.provide(Layer.mergeAll(NetworkLive, UppercaseLive, EchoLive)))

const program = Effect.gen(function* () {
  // Reuse this ID for retries of this request; choose a new ID for new input.
  const handle = yield* ResonateClient.run("echo-1", Echo, "hello")
  return yield* handle.result()
}).pipe(Effect.provide(ClientLive))

console.log(await Effect.runPromise(program)) // HELLO
```

Keep a worker running to process durable executions after callers disconnect.
Step effects that write to an external system should use an idempotency key
because a retry can repeat the write. Workflow code should use the Resonate
context for durable operations; put arbitrary Effect and I/O work in steps.

For contract evolution, recovery with `ResonateClient.get`, and the client API,
see the [core guide](./packages/core/README.md). The
[Postgres provider guide](./packages/network-postgres/README.md) covers network
configuration and database requirements. The
[Resonate TypeScript documentation](https://docs.resonatehq.io/develop/typescript)
remains the reference for orchestration and retry semantics.

## Examples

- [PostgreSQL workflows](./examples/postgres/README.md): bootstrap a local
  database with the pinned `resonate.sql`, run a workflow, and evolve its step
  and workflow contracts while retaining V1 handlers.
- [In-memory workflow test](./examples/in-memory/README.md): exercise a typed
  workflow with Resonate's `LocalNetwork`, without PostgreSQL or Docker.

## Packages

- [`@effect-resonate/core`](./packages/core) provides the client Layer,
  versioned workflow and step contracts, and provider-neutral network service.
- [`@effect-resonate/network-postgres`](./packages/network-postgres) adapts the
  official SDK PostgreSQL network.
- [`@effect-resonate/testing`](./packages/testing) is private workspace support
  for provider conformance tests; consumers do not install it.

## Contributing

Install [mise](https://mise.jdx.dev/) and [direnv](https://direnv.net/), then
bootstrap a worktree with the Node.js 24 version tracked in `mise.toml`:

```sh
mise trust
mise install
direnv allow
bash scripts/worktree-up
```

The bootstrap installs the pnpm version pinned in `package.json`.

Run the package checks and tests before opening a PR:

```sh
pnpm check
pnpm test
pnpm format:check origin/main
```

`pnpm test` includes the Docker-backed Postgres integration suite. Use
`SKIP_POSTGRES_TESTS=true pnpm test` for a local run without Docker, or run
`pnpm test:unit` and `pnpm test:integration` separately. For a stacked PR, pass
its base branch to `pnpm format:check` instead of `origin/main`. Use
`pnpm format <base-ref>` to format changed files.

The [architecture guide](./docs/ARCHITECTURE.md) explains the durable execution
model. The [packaging guide](./docs/PACKAGING.md) describes package boundaries
and build output. See the [release guide](./docs/RELEASING.md) for Changesets,
CI, and npm staging.
