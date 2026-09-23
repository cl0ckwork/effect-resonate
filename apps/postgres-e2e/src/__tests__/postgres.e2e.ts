import { beforeAll, describe, expect, it } from "vitest"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import { ResonateSdkError } from "@effect-resonate/core/CoreExecutionError"
import * as PostgresNetwork from "@effect-resonate/network-postgres"
import {
  cancellation,
  completion,
  duplicateActivation,
  failureClassification,
  invalidNonDurableAwait,
  lifecycle,
  replayRecovery,
  timeout
} from "@effect-resonate/testing"
import { Effect, Layer } from "effect"
import { controlUrl, initializeTemplate, scenarioLayer, withDatabase } from "../harness.js"

let templateHash: string

beforeAll(async () => {
  templateHash = await initializeTemplate()
}, 90_000)

const run = (scenario: typeof completion) =>
  withDatabase(templateHash, (url) => Effect.runPromise(
    scenario.pipe(Effect.provide(scenarioLayer(url)))
  ))

describe("PostgresNetwork with the U5 conformance scenarios", () => {
  it("completes a registered workflow containing an Effect step", () =>
    run(completion))

  it("preserves first-writer-wins under duplicate activation", () =>
    run(duplicateActivation))

  it("keeps checked failures, defects, and malformed input distinct", () =>
    run(failureClassification))

  it("keeps durable execution alive after local cancellation", () =>
    run(cancellation))

  it("prevents late resolution from replacing a durable timeout", () =>
    run(timeout))

  it("supports repeated worker stop and restart", () =>
    run(lifecycle))

  it("rejects durable operations after an ordinary await", () =>
    run(invalidNonDurableAwait))

  it("reuses a checkpointed child after worker replacement", () =>
    run(replayRecovery))
})

describe("real Postgres acquisition failures", () => {
  const expectFailure = async (connectionString: string) => {
    const ClientLive = ResonateClient.layer({ drainTimeout: "1 second" }).pipe(
      Layer.provide(PostgresNetwork.layer({ connectionString }))
    )
    const failure = await Effect.runPromise(Effect.flip(
      ResonateClient.ResonateClient.pipe(Effect.provide(ClientLive))
    ))
    expect(failure).toBeInstanceOf(ResonateSdkError)
    expect(String(failure)).not.toContain("postgres_test_password")
    expect(String(failure.cause)).not.toContain("postgres_test_password")
  }

  it("reports a missing Resonate schema without exposing connection details", () =>
    expectFailure(controlUrl))

  it("reports a failed database login without exposing its password", () =>
    expectFailure(controlUrl.replace("postgres_test_password", "secret-password")))
})
