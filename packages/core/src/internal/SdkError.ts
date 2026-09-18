import { Predicate } from "effect"
import { ResonateSdkError } from "../CoreExecutionError.js"

export interface Options {
  readonly operation: ResonateSdkError["operation"]
  readonly cause: unknown
  readonly requestMayHaveCommitted: boolean
}

/** Preserves an SDK cause and copies only known diagnostic fields when present. */
export const fromCause = (options: Options): ResonateSdkError => {
  const metadata = Predicate.isObject(options.cause) ? options.cause : undefined
  const serverError = Predicate.isObject(metadata?.serverError)
    ? metadata.serverError
    : undefined

  return new ResonateSdkError({
    operation: options.operation,
    cause: options.cause,
    requestMayHaveCommitted: options.requestMayHaveCommitted,
    ...(Predicate.isString(metadata?.code) ? { code: metadata.code } : {}),
    ...(Predicate.isString(metadata?.type) ? { type: metadata.type } : {}),
    ...(Predicate.isString(metadata?.href) ? { href: metadata.href } : {}),
    ...(Predicate.isBoolean(metadata?.retriable) ? { retriable: metadata.retriable } : {}),
    ...(Predicate.isNumber(serverError?.code) && Number.isInteger(serverError.code)
      ? { serverStatus: serverError.code }
      : {})
  })
}
