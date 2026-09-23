import { describe, expect, it, vi } from "vitest"
import { Effect, Layer } from "effect"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import { ResonateNetwork } from "@effect-resonate/core/ResonateNetwork"
import { ResonateSdkError } from "@effect-resonate/core/CoreExecutionError"
import { layer } from "../PostgresNetwork.js"

const state = vi.hoisted(() => ({
  constructorFailure: undefined as Error | undefined,
  methodFailure: undefined as Error | undefined,
  instances: [] as Array<{
    config: Record<string, unknown>
    initCalls: number
    stopCalls: number
  }>
}))

vi.mock("@resonatehq/sdk/postgres", () => ({
  PostgresNetwork: class {
    readonly unicast = "poll://uni@default/test"
    readonly anycast = "poll://any@default"
    readonly observed: (typeof state.instances)[number]

    constructor(config: Record<string, unknown>) {
      if (state.constructorFailure !== undefined) throw state.constructorFailure
      this.observed = { config, initCalls: 0, stopCalls: 0 }
      state.instances.push(this.observed)
    }

    match(target: string) { return `poll://any@${target}` }
    recv() {}

    async init() {
      this.observed.initCalls++
      if (state.methodFailure !== undefined) throw state.methodFailure
    }

    async send() {
      if (state.methodFailure !== undefined) throw state.methodFailure
      return { kind: "mock" }
    }

    async stop() {
      this.observed.stopCalls++
      if (state.methodFailure !== undefined) throw state.methodFailure
    }
  }
}))

const provider = (config: Parameters<typeof layer>[0]) =>
  Effect.runPromise(ResonateNetwork.pipe(Effect.provide(layer(config))))

describe("PostgresNetwork Layer", () => {
  it("constructs a fresh official network for each make and passes SDK config through", async () => {
    state.instances.length = 0
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const config = { connectionString: "postgres://u:p@host/db", tickMs: 50, logger }
    const service = await provider(config)
    const first = await Effect.runPromise(service.make)
    const second = await Effect.runPromise(service.make)
    expect(first).not.toBe(second)
    expect(state.instances).toHaveLength(2)
    expect(state.instances[0]?.config).toBe(config)
    expect(state.instances[1]?.config.logger).toBe(logger)
    expect(state.instances[0]?.initCalls).toBe(0)
    expect(state.instances[0]?.stopCalls).toBe(0)
  })

  it("preserves a constructor failure as the typed acquisition cause", async () => {
    const cause = new Error("driver construction failed")
    state.constructorFailure = cause
    try {
      const service = await provider({ connectionString: "postgres://host/db" })
      const failure = await Effect.runPromise(Effect.flip(service.make))
      expect(failure).toBeInstanceOf(ResonateSdkError)
      expect(failure.operation).toBe("network.init")
      expect(failure.cause).toBe(cause)
      expect(failure.requestMayHaveCommitted).toBe(false)
    } finally {
      state.constructorFailure = undefined
    }
  })

  it("does not replace SDK network method failures", async () => {
    const cause = new Error("driver failed")
    const service = await provider({ connectionString: "postgres://host/db" })
    const network = await Effect.runPromise(service.make)
    state.methodFailure = cause
    try {
      await expect(network.init()).rejects.toBe(cause)
      await expect(network.send({ kind: "mock" } as never)).rejects.toBe(cause)
      await expect(network.stop()).rejects.toBe(cause)
    } finally {
      state.methodFailure = undefined
    }
  })

  it("lets core initialize and stop the official network once", async () => {
    state.instances.length = 0
    const ClientLive = ResonateClient.layer({ drainTimeout: "1 second" }).pipe(
      Layer.provide(layer({ connectionString: "postgres://host/db" }))
    )
    await Effect.runPromise(ResonateClient.ResonateClient.pipe(Effect.provide(ClientLive)))
    expect(state.instances).toHaveLength(1)
    expect(state.instances[0]?.initCalls).toBe(1)
    expect(state.instances[0]?.stopCalls).toBe(1)
  })
})
