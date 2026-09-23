import type { Network } from "@resonatehq/sdk"
import { PostgresNetwork, type PostgresNetworkConfig } from "@resonatehq/sdk/postgres"
import { ResonateSdkError } from "@effect-resonate/core/CoreExecutionError"
import { ResonateNetwork } from "@effect-resonate/core/ResonateNetwork"
import { Effect, Layer, Predicate, Result, Schema } from "effect"

const ConnectionString = Schema.String.check(Schema.isPattern(/\S/))
const PollInterval = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(2_147_483_647)
)

const configurationError = (field: "configuration" | "connectionString" | "tickMs"): ResonateSdkError =>
  new ResonateSdkError({
    operation: "network.init",
    cause: new Error(`Invalid Postgres network configuration: ${field}`),
    requestMayHaveCommitted: false
  })

const checkConfig = (input: PostgresNetworkConfig): Result.Result<PostgresNetworkConfig, ResonateSdkError> => {
  if (!Predicate.isObject(input)) {
    return Result.fail(configurationError("configuration"))
  }
  return Result.try({
    try: (): PostgresNetworkConfig => {
      const { connectionString, group, pid, tickMs, logger } = input
      return {
        connectionString,
        ...(group === undefined ? {} : { group }),
        ...(pid === undefined ? {} : { pid }),
        ...(tickMs === undefined ? {} : { tickMs }),
        ...(logger === undefined ? {} : { logger })
      }
    },
    catch: () => configurationError("configuration")
  }).pipe(
    Result.flatMap((snapshot) => Schema.decodeUnknownResult(ConnectionString)(snapshot.connectionString).pipe(
      Result.mapError(() => configurationError("connectionString")),
      Result.flatMap(() => snapshot.tickMs === undefined
        ? Result.succeed(snapshot)
        : Schema.decodeUnknownResult(PollInterval)(snapshot.tickMs).pipe(
          Result.mapError(() => configurationError("tickMs")),
          Result.map(() => snapshot)
        ))
    ))
  )
}

const safeError = (operation: "construct" | "init" | "send" | "stop" | "match" | "recv"): Error =>
  new Error(`Postgres network ${operation} failed`)

const safeNetwork = (network: PostgresNetwork): Network => ({
  unicast: network.unicast,
  anycast: network.anycast,
  match: (target) => {
    try {
      return network.match(target)
    } catch {
      throw safeError("match")
    }
  },
  recv: (callback) => {
    try {
      network.recv(callback)
    } catch {
      throw safeError("recv")
    }
  },
  init: () => Promise.resolve().then(() => network.init()).catch(() => { throw safeError("init") }),
  send: (request) => Promise.resolve().then(() => network.send(request)).catch(() => { throw safeError("send") }),
  stop: () => Promise.resolve().then(() => network.stop()).catch(() => { throw safeError("stop") })
})

/** Supplies a fresh official SDK network for each client Layer acquisition. */
export const layer = (input: PostgresNetworkConfig): Layer.Layer<ResonateNetwork> => {
  const checked = checkConfig(input)
  return Layer.succeed(ResonateNetwork, ResonateNetwork.of({
    make: Effect.fromResult(checked).pipe(
      Effect.flatMap((config) => Effect.try({
        try: () => safeNetwork(new PostgresNetwork(config)),
        catch: () => new ResonateSdkError({
          operation: "network.init",
          cause: safeError("construct"),
          requestMayHaveCommitted: false
        })
      }))
    )
  }))
}
