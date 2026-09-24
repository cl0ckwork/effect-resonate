import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect } from "effect"
import type { Network } from "@resonatehq/sdk"
import * as NetworkGate from "../NetworkGate.js"

type ReceiveCallback = Parameters<Network["recv"]>[0]
type Message = Parameters<ReceiveCallback>[0]

const executeMessage = (version: number): Message => ({
  kind: "execute",
  head: {},
  data: { task: { id: `task-${version}`, version } }
})

describe("NetworkGate", () => {
  it("captures SDK initialization and buffers delivery until opened", async () => {
    const initialized: Array<string> = []
    const delivered: Array<Message> = []
    let receive: ReceiveCallback = () => undefined
    const network = {
      unicast: "test://worker",
      anycast: "test://any",
      match: (target: string) => target,
      init: async () => {
        initialized.push("init")
      },
      stop: async () => undefined,
      send: async () => ({}) as never,
      recv: (callback: ReceiveCallback) => {
        receive = callback
      }
    } as Network
    const gate = NetworkGate.make(network)
    gate.recv((message) => delivered.push(message))

    const initialization = gate.init()
    receive(executeMessage(1))
    await gate.initialized()

    assert.deepStrictEqual(initialized, ["init"])
    assert.deepStrictEqual(delivered, [])
    gate.open()
    assert.deepStrictEqual(delivered, [executeMessage(1)])
    await initialization
  })

  it("surfaces the same initialization rejection awaited by the SDK", async () => {
    const failure = new Error("sentinel-secret")
    const network = {
      unicast: "test://worker",
      anycast: "test://any",
      match: (target: string) => target,
      init: async () => Promise.reject(failure),
      stop: async () => undefined,
      send: async () => ({}) as never,
      recv: () => undefined
    } as Network
    const gate = NetworkGate.make(network)

    void gate.init().catch(() => undefined)

    assert.strictEqual(await gate.initialized().catch((cause) => cause), failure)
  })

  it("waits for pending initialization before stopping provider resources", async () => {
    const releaseInitialization = Effect.runSync(Deferred.make<void>())
    const events: Array<string> = []
    const network = {
      unicast: "test://worker",
      anycast: "test://any",
      match: (target: string) => target,
      init: () =>
        Effect.runPromise(
          Deferred.await(releaseInitialization).pipe(
            Effect.tap(() => Effect.sync(() => events.push("initialized")))
          )
        ),
      stop: async () => {
        events.push("stopped")
      },
      send: async () => ({}) as never,
      recv: () => undefined
    } as Network
    const gate = NetworkGate.make(network)

    const initialization = gate.init()
    const stopping = gate.stop()
    await Promise.resolve()
    assert.deepStrictEqual(events, [])

    await Effect.runPromise(Deferred.succeed(releaseInitialization, undefined))
    await Promise.all([initialization, stopping])
    assert.deepStrictEqual(events, ["initialized", "stopped"])
  })

  it("closes delivery and stops the provider exactly once", async () => {
    const delivered: Array<Message> = []
    let stops = 0
    let receive: ReceiveCallback = () => undefined
    const network = {
      unicast: "test://worker",
      anycast: "test://any",
      match: (target: string) => target,
      init: async () => undefined,
      stop: async () => {
        stops += 1
      },
      send: async () => ({}) as never,
      recv: (callback: ReceiveCallback) => {
        receive = callback
      }
    } as Network
    const gate = NetworkGate.make(network)
    gate.recv((message) => delivered.push(message))
    gate.open()
    receive(executeMessage(1))
    gate.close()
    receive(executeMessage(2))

    await Promise.all([gate.stop(), gate.stop()])

    assert.deepStrictEqual(delivered, [executeMessage(1)])
    assert.strictEqual(stops, 1)
  })
})
