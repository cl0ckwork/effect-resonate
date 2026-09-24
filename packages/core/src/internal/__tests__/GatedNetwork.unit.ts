import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect } from "effect"
import type { CompatibleNetwork } from "../../ResonateNetwork.js"
import * as GatedNetwork from "../GatedNetwork.js"

type ReceiveCallback = Parameters<CompatibleNetwork["recv"]>[0]
type Message = Parameters<ReceiveCallback>[0]

const executeMessage = (version: number): Message => ({
  kind: "execute",
  head: {},
  data: { task: { id: `task-${version}`, version } }
})

describe("GatedNetwork", () => {
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
    } as CompatibleNetwork
    const gated = GatedNetwork.make(network)
    gated.recv((message) => delivered.push(message))

    const initialization = gated.init()
    receive(executeMessage(1))
    await gated.initialized()

    assert.deepStrictEqual(initialized, ["init"])
    assert.deepStrictEqual(delivered, [])
    gated.open()
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
    } as CompatibleNetwork
    const gated = GatedNetwork.make(network)

    void gated.init().catch(() => undefined)

    assert.strictEqual(await gated.initialized().catch((cause) => cause), failure)
  })

  it("waits for pending initialization before stopping provider resources", async () => {
    const releaseInitialization = Effect.runSync(Deferred.make<void>())
    const events: Array<string> = []
    const network = {
      unicast: "test://worker",
      anycast: "test://any",
      match: (target: string) => target,
      init: () => Effect.runPromise(Deferred.await(releaseInitialization).pipe(
        Effect.tap(() => Effect.sync(() => events.push("initialized")))
      )),
      stop: async () => {
        events.push("stopped")
      },
      send: async () => ({}) as never,
      recv: () => undefined
    } as CompatibleNetwork
    const gated = GatedNetwork.make(network)

    const initialization = gated.init()
    const stopping = gated.stop()
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
    } as CompatibleNetwork
    const gated = GatedNetwork.make(network)
    gated.recv((message) => delivered.push(message))
    gated.open()
    receive(executeMessage(1))
    gated.close()
    receive(executeMessage(2))

    await Promise.all([gated.stop(), gated.stop()])

    assert.deepStrictEqual(delivered, [executeMessage(1)])
    assert.strictEqual(stops, 1)
  })
})
