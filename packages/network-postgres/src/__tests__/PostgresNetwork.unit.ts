import { describe, expect, it, vi } from "vitest"
import { Effect, Layer } from "effect"
import * as ResonateClient from "@effect-resonate/core/ResonateClient"
import { ResonateNetwork } from "@effect-resonate/core/ResonateNetwork"
import { ResonateSdkError } from "@effect-resonate/core/CoreExecutionError"
import { layer } from "../PostgresNetwork.js"

const state = vi.hoisted(() => ({
  nextFailure: undefined as "init" | "send" | "stop" | undefined,
  instances: [] as Array<{
    config: Record<string, unknown>
    initCalls: number
    stopCalls: number
    sendCalls: number
    fail?: "init" | "send" | "stop"
  }>
}))

vi.mock("@resonatehq/sdk/postgres", () => ({
  PostgresNetwork: class {
    readonly unicast = "poll://uni@default/test"
    readonly anycast = "poll://any@default"
    readonly observed: (typeof state.instances)[number]

    constructor(config: Record<string, unknown>) {
      this.observed = { config, initCalls: 0, stopCalls: 0, sendCalls: 0, fail: state.nextFailure }
      state.instances.push(this.observed)
    }

    match(target: string) {
      return `poll://any@${target}`
    }

    recv() {}

    async init() {
      this.observed.initCalls++
      const logger = this.observed.config.logger as {
        info(fields: Record<string, unknown>, message: string): void
        warn(fields: Record<string, unknown>, message: string): void
      } | undefined
      if (this.observed.fail === "init") {
        logger?.warn({ component: "network", error: "secret-password in driver error" }, "postgres listen error")
        throw new Error("secret-password in init failure")
      }
      logger?.info({ component: "network", connectionString: "secret-password" }, "postgres network initialized")
    }

    async send() {
      this.observed.sendCalls++
      if (this.observed.fail === "send") {
        throw new Error("secret-password in send failure")
      }
      return { kind: "mock" }
    }

    async stop() {
      this.observed.stopCalls++
      if (this.observed.fail === "stop") {
        throw new Error("secret-password in stop failure")
      }
    }
  }
}))

const provider = (config: Parameters<typeof layer>[0]) =>
  Effect.runPromise(ResonateNetwork.pipe(Effect.provide(layer(config))))

describe("PostgresNetwork Layer", () => {
  it("rejects blank connection strings and invalid timer intervals before construction", async () => {
    state.instances.length = 0
    for (const config of [
      null,
      { connectionString: "  " },
      { connectionString: "postgres://secret-password@host/db", tickMs: 0 },
      { connectionString: "postgres://secret-password@host/db", tickMs: Number.POSITIVE_INFINITY },
      { connectionString: "postgres://secret-password@host/db", tickMs: 2_147_483_648 }
    ]) {
      const service = await provider(config as Parameters<typeof layer>[0])
      const failure = await Effect.runPromise(Effect.flip(service.make))
      expect(failure).toBeInstanceOf(ResonateSdkError)
      expect(failure.operation).toBe("network.init")
      expect(failure.requestMayHaveCommitted).toBe(false)
      expect(String(failure)).not.toContain("secret-password")
      expect(String(failure.cause)).not.toContain("secret-password")
    }
    const hostile = {
      get connectionString(): string {
        throw new Error("secret-password in a getter")
      }
    }
    const hostileService = await provider(hostile)
    const hostileFailure = await Effect.runPromise(Effect.flip(hostileService.make))
    expect(String(hostileFailure.cause)).not.toContain("secret-password")
    expect(state.instances).toHaveLength(0)
  })

  it("creates a fresh SDK instance per acquisition and passes the logger through", async () => {
    state.instances.length = 0
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const config = {
      connectionString: "postgres://u:p@host/db?sslmode=require",
      group: "some/group",
      pid: "pid@1",
      tickMs: 50,
      logger
    }
    const service = await provider(config)
    config.connectionString = "changed"
    const first = await Effect.runPromise(service.make)
    const second = await Effect.runPromise(service.make)
    expect(first).not.toBe(second)
    expect(state.instances).toHaveLength(2)
    expect(state.instances[0]?.config).toMatchObject({
      connectionString: "postgres://u:p@host/db?sslmode=require",
      group: "some/group",
      pid: "pid@1",
      tickMs: 50
    })
    expect(state.instances[0]?.config.logger).toBe(logger)
    expect(state.instances[0]?.initCalls).toBe(0)
    expect(state.instances[0]?.stopCalls).toBe(0)
  })

  it("lets an SDK logger override receive the SDK's original messages and fields", async () => {
    state.instances.length = 0
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const service = await provider({ connectionString: "postgres://secret-password@host/db", logger })
    const network = await Effect.runPromise(service.make)
    await network.init()
    expect(state.instances[0]?.config.logger).toBe(logger)
    expect(logger.info).toHaveBeenCalledWith(
      { component: "network", connectionString: "secret-password" },
      "postgres network initialized"
    )
    state.instances[0]!.fail = "init"
    await network.init().catch(() => undefined)
    expect(logger.warn).toHaveBeenCalledWith(
      { component: "network", error: "secret-password in driver error" },
      "postgres listen error"
    )
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

  it("sanitizes failed client acquisition and releases the partially initialized network", async () => {
    state.instances.length = 0
    state.nextFailure = "init"
    const logs = vi.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      const ClientLive = ResonateClient.layer({ drainTimeout: "1 second" }).pipe(
        Layer.provide(layer({ connectionString: "postgres://secret-password@host/db" }))
      )
      const failure = await Effect.runPromise(Effect.flip(
        ResonateClient.ResonateClient.pipe(Effect.provide(ClientLive))
      ))
      expect(String(failure)).not.toContain("secret-password")
      expect(state.instances[0]?.initCalls).toBe(1)
      expect(state.instances[0]?.stopCalls).toBe(1)
      expect(JSON.stringify(logs.mock.calls)).not.toContain("secret-password")
    } finally {
      logs.mockRestore()
      state.nextFailure = undefined
    }
  })

  it("sanitizes SDK network rejections without attaching the raw cause", async () => {
    state.instances.length = 0
    const service = await provider({ connectionString: "postgres://host/db" })
    const network = await Effect.runPromise(service.make)
    const instance = state.instances[0]
    expect(instance).toBeDefined()
    if (instance === undefined) return

    instance.fail = "init"
    const initFailure: unknown = await network.init().catch((error: unknown) => error)
    expect(initFailure).toBeInstanceOf(Error)
    expect(String(initFailure)).toBe("Error: Postgres network init failed")
    expect((initFailure as Error).cause).toBeUndefined()
    instance.fail = "send"
    const sendFailure: unknown = await network.send({ kind: "mock" } as never).catch((error: unknown) => error)
    expect(String(sendFailure)).toBe("Error: Postgres network send failed")
    expect((sendFailure as Error).cause).toBeUndefined()
    instance.fail = "stop"
    const stopFailure: unknown = await network.stop().catch((error: unknown) => error)
    expect(String(stopFailure)).toBe("Error: Postgres network stop failed")
    expect((stopFailure as Error).cause).toBeUndefined()
    expect(instance.initCalls).toBe(1)
    expect(instance.sendCalls).toBe(1)
    expect(instance.stopCalls).toBe(1)
  })
})
