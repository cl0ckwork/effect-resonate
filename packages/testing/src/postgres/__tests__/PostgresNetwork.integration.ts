import { it } from "@effect/vitest"
import { describe, expect } from "vitest"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import { ResonateSdkError } from "@effect-resonate/core/CoreExecutionError"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { Effect, Layer } from "effect"
import * as NetworkScenarios from "../../NetworkScenarios.js"
import * as RecoveryScenarios from "../../RecoveryScenarios.js"
import { testEnv } from "../env.js"
import { itest } from "../itest.js"
import { controlDatabaseUrl } from "../layers.js"

describe("PostgresNetwork with the U5 conformance scenarios", () => {
  itest({
    name: "completes a registered workflow containing an Effect step",
    run: () => NetworkScenarios.completion
  })
  itest({
    name: "preserves first-writer-wins under duplicate activation",
    run: () => NetworkScenarios.duplicateActivation
  })
  itest({
    name: "keeps checked failures, defects, and malformed input distinct",
    run: () => NetworkScenarios.failureClassification
  })
  itest({
    name: "keeps durable execution alive after local cancellation",
    run: () => NetworkScenarios.cancellation
  })
  itest({
    name: "prevents late resolution from replacing a durable timeout",
    run: () => NetworkScenarios.timeout
  })
  itest({
    name: "supports repeated worker stop and restart",
    run: () => NetworkScenarios.lifecycle
  })
  itest({
    name: "rejects durable operations after an ordinary await",
    run: () => NetworkScenarios.invalidNonDurableAwait
  })
  itest({
    name: "reuses a checkpointed child after worker replacement",
    run: () => RecoveryScenarios.replayRecovery
  })
})

const expectFailure = ({ connectionString }: { readonly connectionString: string }) => Effect.gen(function*() {
  const ClientLive = ResonateClient.layer({ drainTimeout: "1 second" }).pipe(
    Layer.provide(PostgresNetwork.layer({ connectionString }))
  )
  const failure = yield* Effect.flip(
    ResonateClient.ResonateClient.pipe(Effect.provide(ClientLive))
  )
  expect(failure).toBeInstanceOf(ResonateSdkError)
  if (!(failure instanceof ResonateSdkError)) throw failure
  expect(failure.operation).toBe("network.init")
  expect(failure.cause).toBeDefined()
})

describe("real Postgres acquisition failures", () => {
  it.live("reports a missing Resonate schema", () => Effect.gen(function*() {
    const { postgresPort } = yield* testEnv
    yield* expectFailure({ connectionString: controlDatabaseUrl({ postgresPort }) })
  }))

  it.live("reports a failed database login", () => Effect.gen(function*() {
    const { postgresPort } = yield* testEnv
    yield* expectFailure({
      connectionString: controlDatabaseUrl({ postgresPort }).replace("effect_resonate_test_password", "wrong-password")
    })
  }))
})
