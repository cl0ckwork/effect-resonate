import { assert, describe, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import { schema } from "../DurableValue.js"

const accepts = (value: unknown): boolean => Result.isSuccess(Schema.decodeUnknownResult(schema)(value))

describe("DurableValue", () => {
  it("accepts every JSON primitive and empty/composite containers", () => {
    for (const value of [
      null,
      true,
      false,
      "",
      "value",
      0,
      -1.5,
      [],
      {},
      [null, true, "value", 1, [], {}],
      { nested: { array: [1, 2, 3] } }
    ]) {
      assert.isTrue(accepts(value))
    }
  })

  it("rejects values that JSON would lose or coerce", () => {
    const sparse = new Array(1)
    class RecordLike {
      readonly value = 1
    }

    for (const value of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1n,
      () => undefined,
      Symbol("value"),
      new Date(0),
      new RecordLike(),
      sparse,
      { missing: undefined }
    ]) {
      assert.isFalse(accepts(value))
    }
  })

  it("rejects cycles but permits repeated acyclic references", () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    const shared = { value: 1 }

    assert.isFalse(accepts(cyclic))
    assert.isTrue(accepts({ left: shared, right: shared }))
  })
})
