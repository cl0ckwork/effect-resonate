import { LocalNetwork } from "@resonatehq/sdk"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import { ResonateSdkError } from "../CoreExecutionError.js"
import * as ResonateNetwork from "../ResonateNetwork.js"

describe("ResonateNetwork.layer", () => {
  it("constructs a fresh network for each make", async () => {
    const factory = vi.fn(() => new LocalNetwork())
    const service = await Effect.runPromise(
      ResonateNetwork.ResonateNetwork.pipe(Effect.provide(ResonateNetwork.layer(factory)))
    )

    const first = await Effect.runPromise(service.make)
    const second = await Effect.runPromise(service.make)

    expect(first).not.toBe(second)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("maps constructor failures to a typed network initialization error", async () => {
    const cause = new Error("network construction failed")
    const service = await Effect.runPromise(
      ResonateNetwork.ResonateNetwork.pipe(
        Effect.provide(
          ResonateNetwork.layer(() => {
            throw cause
          })
        )
      )
    )

    const failure = await Effect.runPromise(Effect.flip(service.make))
    expect(failure).toBeInstanceOf(ResonateSdkError)
    expect(failure.operation).toBe("network.init")
    expect(failure.cause).toBe(cause)
    expect(failure.requestMayHaveCommitted).toBe(false)
  })
})
