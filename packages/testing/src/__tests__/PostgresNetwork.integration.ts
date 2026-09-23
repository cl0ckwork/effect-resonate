import { it } from "@effect/vitest"
import { describe, expect } from "vitest"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import { ResonateSdkError } from "@effect-resonate/core/CoreExecutionError"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import { Effect, Layer } from "effect"
import {
  cancellation,
  completion,
  duplicateActivation,
  failureClassification,
  invalidNonDurableAwait,
  lifecycle,
  replayRecovery,
  timeout
} from "../index.js"
import { testEnv } from "../postgres/env.js"
import { itest } from "../postgres/itest.js"
import { controlDatabaseUrl } from "../postgres/layers.js"

describe("PostgresNetwork with the U5 conformance scenarios", () => {
  itest("completes a registered workflow containing an Effect step", () => completion)
  itest("preserves first-writer-wins under duplicate activation", () => duplicateActivation)
  itest("keeps checked failures, defects, and malformed input distinct", () => failureClassification)
  itest("keeps durable execution alive after local cancellation", () => cancellation)
  itest("prevents late resolution from replacing a durable timeout", () => timeout)
  itest("supports repeated worker stop and restart", () => lifecycle)
  itest("rejects durable operations after an ordinary await", () => invalidNonDurableAwait)
  itest("reuses a checkpointed child after worker replacement", () => replayRecovery)
})

const expectFailure = (connectionString: string) => Effect.gen(function*() {
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
    yield* expectFailure(controlDatabaseUrl(postgresPort))
  }))

  it.live("reports a failed database login", () => Effect.gen(function*() {
    const { postgresPort } = yield* testEnv
    yield* expectFailure(controlDatabaseUrl(postgresPort).replace("effect_resonate_test_password", "wrong-password"))
  }))
})
