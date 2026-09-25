import { ResonateClient, ResonateNetwork } from "@effect-resonate/core"
import { LocalNetwork } from "@resonatehq/sdk"
import { Duration, Effect, Layer } from "effect"
import { expect, it } from "vitest"
import { Functions, NormalizeNameLive, Welcome, WelcomeLive } from "./workflow.js"

it("runs a durable workflow from the published npm package", async () => {
  const NetworkLive = ResonateNetwork.layer({ make: () => new LocalNetwork() })
  const ClientLive = ResonateClient.layer({
    functions: Functions,
    drainTimeout: Duration.seconds(1)
  }).pipe(Layer.provide(Layer.mergeAll(NetworkLive, NormalizeNameLive, WelcomeLive)))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const run = yield* ResonateClient.run("npm-consumer-welcome-ada", Welcome, "  ada  ")
      return yield* run.result()
    }).pipe(Effect.provide(ClientLive))
  )

  expect(result).toBe("Welcome, ADA!")
})
