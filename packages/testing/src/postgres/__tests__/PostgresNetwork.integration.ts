import { it } from "@effect/vitest"
import { describe, expect } from "vitest"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import { ResonateSdkError } from "@effect-resonate/core/CoreExecutionError"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { Effect, Layer } from "effect"
import * as NetworkScenarios from "../../NetworkScenarios.js"
import * as RecoveryScenarios from "../../RecoveryScenarios.js"
import { PostgresTestEnv } from "../env.js"
import { itest } from "../itest.js"
import { controlDatabaseUrl } from "../PostgresItestLayer.js"

describe("PostgresNetwork with the U5 conformance scenarios", () => {
  itest("completes a registered workflow containing an Effect step", () =>
    NetworkScenarios.completion)
  itest("preserves first-writer-wins under duplicate activation", () =>
    NetworkScenarios.duplicateActivation)
  itest("keeps checked failures, defects, and malformed input distinct", () =>
    NetworkScenarios.failureClassification)
  itest("keeps durable execution alive after local cancellation", () =>
    NetworkScenarios.cancellation)
  itest("prevents late resolution from replacing a durable timeout", () =>
    NetworkScenarios.timeout)
  itest("supports repeated worker stop and restart", () =>
    NetworkScenarios.lifecycle)
  itest("rejects durable operations after an ordinary await", () =>
    NetworkScenarios.invalidNonDurableAwait)
  itest("reuses a checkpointed child after worker replacement", () =>
    RecoveryScenarios.replayRecovery)
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
    const { postgresPort } = yield* PostgresTestEnv
    yield* expectFailure({ connectionString: controlDatabaseUrl({ postgresPort }) })
  }).pipe(Effect.provide(PostgresTestEnv.layer)))

  it.live("reports a failed database login", () => Effect.gen(function*() {
    const { postgresPort } = yield* PostgresTestEnv
    yield* expectFailure({
      connectionString: controlDatabaseUrl({ postgresPort }).replace("effect_resonate_test_password", "wrong-password")
    })
  }).pipe(Effect.provide(PostgresTestEnv.layer)))
})
