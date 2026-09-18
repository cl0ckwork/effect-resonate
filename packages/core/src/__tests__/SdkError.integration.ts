import { assert, describe, it } from "@effect/vitest"
import { Resonate } from "@resonatehq/sdk/async"
import * as SdkError from "../internal/SdkError.js"

describe("SdkError", () => {
  it("copies only available metadata from an actual SDK error", async () => {
    const resonate = new Resonate()

    try {
      await resonate.run("missing-function", "not.registered")
      assert.fail("expected SDK failure")
    } catch (cause) {
      const error = SdkError.fromCause({
        operation: "run",
        cause,
        requestMayHaveCommitted: false
      })

      assert.strictEqual(error.cause, cause)
      assert.strictEqual(error.code, "03")
      assert.strictEqual(error.type, "Registry")
      assert.strictEqual(error.href, "https://rn8.io/e/1103")
      assert.isFalse(error.retriable)
      assert.isUndefined(error.serverStatus)
    } finally {
      await resonate.stop()
    }
  })
})
