# `@effect-resonate/testing`

Private provider-conformance tests for effect-resonate network implementations.

The package owns reusable test scenarios. A provider supplies two Effect services:

- `ResonateNetwork`: the network implementation under test.
- `NetworkHarness`: test-only setup, observations, timing, and supported capabilities.

Each scenario is an `Effect` requiring those services. This keeps the scenarios
provider-neutral while allowing each provider to own its Layer and lifecycle.

## Usage

```ts
import { it } from "@effect/vitest"
import { completion, duplicateActivation, makeNetworkHarnessLayer } from "@effect-resonate/testing"
import { Effect, Layer } from "effect"
import { NetworkLive } from "./NetworkLive.js"

const HarnessLive = makeNetworkHarnessLayer({
  name: "example",
  setupTimeout: "10 seconds",
  acquire: Effect.succeed({
    timing: {
      pollInterval: "50 millis",
      scenarioTimeout: "10 seconds"
    },
    capabilities: {},
    observe: ({ executionIds }) =>
      Effect.succeed({
        phase: "ready",
        activeWorkers: 0,
        executions: executionIds.map((id) => ({ id, state: "unknown" }))
      })
  })
})

const TestLive = Layer.merge(NetworkLive, HarnessLive)

it.live("completion", () => completion.pipe(Effect.provide(TestLive)))
it.live("duplicate activation", () => duplicateActivation.pipe(Effect.provide(TestLive)))
```

Use `it.live` because network and SDK timing must use the live Effect clock.
Register each scenario separately so failures identify the behavior that broke.

## Scenarios

- `completion`
- `duplicateActivation`
- `failureClassification`
- `cancellation`
- `timeout`
- `lifecycle`
- `invalidNonDurableAwait`
- `replayRecovery`

Only register capability-dependent scenarios that the harness declares support
for. All polling is bounded by the harness timing configuration, and failures
use sanitized diagnostics.

The package's own integration tests run these scenarios against the Resonate SDK
`LocalNetwork` fixture.

```sh
pnpm --filter @effect-resonate/testing test
```
