import type { Network } from "@resonatehq/sdk"

type ReceiveCallback = Parameters<Network["recv"]>[0]
type Message = Parameters<ReceiveCallback>[0]

export interface NetworkGate extends Network {
  /** The exact initialization started by the Resonate constructor. */
  readonly initialized: () => Promise<void>
  /** Releases buffered SDK deliveries after registration is complete. */
  readonly open: () => void
  /** Rejects future deliveries and drops messages buffered during acquisition. */
  readonly close: () => void
}

/** Wraps an official SDK network without replacing its protocol behavior. */
export const make = (network: Network): NetworkGate => {
  const buffered: Array<Message> = []
  let callback: ReceiveCallback | undefined
  let state: "Closed" | "Open" | "Waiting" = "Waiting"
  let initialization: Promise<void> | undefined
  let stopping: Promise<void> | undefined

  const deliver = (message: Message): void => {
    if (state === "Closed") {
      return
    }
    if (state === "Open" && callback !== undefined) {
      callback(message)
      return
    }
    buffered.push(message)
  }

  const init = (): Promise<void> => {
    if (initialization === undefined) {
      if (state === "Closed") {
        return Promise.reject(new Error("Cannot initialize a stopped Resonate network"))
      }
      initialization = network.init()
    }
    return initialization
  }

  const stop = (): Promise<void> => {
    if (stopping === undefined) {
      state = "Closed"
      buffered.length = 0
      stopping = (initialization ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => network.stop())
    }
    return stopping
  }

  return {
    unicast: network.unicast,
    anycast: network.anycast,
    match: network.match.bind(network),
    send: network.send.bind(network),
    recv: (next) => {
      callback = next
      network.recv(deliver)
    },
    init,
    stop,
    initialized: () =>
      initialization ??
      Promise.reject(new Error("Resonate did not initialize its network during construction")),
    open: () => {
      if (state !== "Waiting") {
        return
      }
      state = "Open"
      const pending = buffered.splice(0)
      for (const message of pending) {
        callback?.(message)
      }
    },
    close: () => {
      state = "Closed"
      buffered.length = 0
    }
  }
}
