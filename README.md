# effect-resonate

An Effect-facing integration for [Resonate](https://resonatehq.io/) durable
execution. It keeps Resonate's async TypeScript SDK as the orchestration API and
uses Effect for typed application failures, dependency layers, and scoped
resource ownership.

The core, Postgres provider, and Postgres conformance suite are implemented;
the public npm packages have not yet had their first release.

## Packages

- [`@effect-resonate/core`](./packages/core) provides the client Layer,
  versioned workflow and step contracts, schema-aware durable boundaries, and
  the provider-neutral network service.
- [`@effect-resonate/network-postgres`](./packages/network-postgres) adapts the
  official SDK PostgreSQL network to that service.
- [`@effect-resonate/testing`](./packages/testing) is private workspace support
  for reusable provider conformance scenarios and their test harness.

Resonate owns durable orchestration, replay, timers, retries, and distributed
calls. Effect programs run in registered steps; workflow orchestration uses
Resonate's ordinary `async`/`await` context methods. JSON-compatible values are
the default durable data contract. Schemas and codecs are used at typed
workflow, step, and external-promise boundaries where values cross durable
storage or application trust boundaries.

See the [core guide](./packages/core/README.md) and
[Postgres provider guide](./packages/network-postgres/README.md) for setup and
usage.

## Development

Install Node.js and [direnv](https://direnv.net/), then bootstrap the worktree:

```sh
direnv allow
bash scripts/worktree-up
```

Run the checks and tests with:

```sh
pnpm check
pnpm test
```

`pnpm test` includes the Docker-backed Postgres integration suite. Set
`SKIP_POSTGRES_TESTS=true` to omit that suite when Docker is unavailable.

## Project documents

- [Packaging and package boundaries](./docs/PACKAGING.md)
- [Architecture exploration](./docs/BRAINSTORM.md)
- [Specifications](./docs/specs/)
- [Implementation plans](./docs/plans/)
- [Execution inspection direction](./docs/EXECUTION-INSPECTION.md)
- [Release process](./docs/RELEASING.md)
