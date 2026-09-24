import { assert, describe, it } from "@effect/vitest"
import { ResonateSdkError } from "../CoreExecutionError.js"

describe("CoreExecutionError", () => {
  it("preserves Resonate error identity and the original cause", () => {
    const cause = new Error("upstream failure")
    const error = new ResonateSdkError({
      operation: "run",
      cause,
      code: "99",
      type: "Server",
      href: "https://rn8.io/e/1199",
      retriable: true,
      serverStatus: 503,
      requestMayHaveCommitted: true
    })

    assert.strictEqual(error._tag, "@effect-resonate/core/ResonateSdkError")
    assert.strictEqual(error.cause, cause)
    assert.strictEqual(error.code, "99")
    assert.strictEqual(error.type, "Server")
    assert.strictEqual(error.href, "https://rn8.io/e/1199")
    assert.isTrue(error.retriable)
    assert.strictEqual(error.serverStatus, 503)
    assert.isTrue(error.requestMayHaveCommitted)
  })
})
