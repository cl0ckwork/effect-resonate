import { ResonateClient, ResonateNetwork } from "@effect-resonate/core"
import { LocalNetwork } from "@resonatehq/sdk"
import { Duration, Effect, Layer } from "effect"
import { expect, it } from "vitest"
import { Functions, NormalizeNameLive, Welcome, WelcomeLive } from "./workflow.js"

it("runs a typed workflow and reuses the first result for the same execution ID", async () => {
  // Each test gets an isolated in-memory Resonate network. No server or database is needed.
  const NetworkLive = Layer.succeed(
    ResonateNetwork.ResonateNetwork,
    ResonateNetwork.ResonateNetwork.of({ make: Effect.sync(() => new LocalNetwork()) })
  )
  const ClientLive = ResonateClient.layer({
    functions: Functions,
    drainTimeout: Duration.seconds(1)
  }).pipe(Layer.provide(Layer.mergeAll(NetworkLive, NormalizeNameLive, WelcomeLive)))

  const outputs = await Effect.runPromise(
    Effect.gen(function* () {
      const first = yield* ResonateClient.run("welcome-ada", Welcome, "  ada  ")
      const firstResult = yield* first.result()
      const repeated = yield* ResonateClient.run("welcome-ada", Welcome, "grace")
      return { firstResult, repeatedResult: yield* repeated.result() }
    }).pipe(Effect.provide(ClientLive))
  )

  expect(outputs).toEqual({
    firstResult: "Welcome, ADA!",
    repeatedResult: "Welcome, ADA!"
  })
})
