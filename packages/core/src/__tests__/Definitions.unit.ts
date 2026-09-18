import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Result, Schema } from "effect"
import * as ResonateFunctions from "../ResonateFunctions.js"
import * as Step from "../Step.js"
import * as Workflow from "../Workflow.js"

describe("Step.make", () => {
  it("creates an inert, frozen definition", () => {
    let executions = 0
    const definition = Step.make({
      name: "inventory.reserve",
      version: 1,
      input: Schema.Struct({ sku: Schema.String }),
      success: Schema.Struct({ reserved: Schema.String }),
      failure: Schema.Never
    })
    const implementation = definition.toLayer((input) => {
        executions += 1
        return Effect.succeed({ reserved: input.sku })
    })

    assert.strictEqual(executions, 0)
    assert.isTrue(Object.isFrozen(definition))
    assert.strictEqual(definition.name, "inventory.reserve")
    assert.strictEqual(definition.version, 1)
    assert.isTrue(Layer.isLayer(implementation))
  })

  it("defers validation of dynamic identities to Layer acquisition", () => {
    const dynamicVersion: number = Number.NaN
    const definition = Step.make({
      name: " ",
      version: dynamicVersion,
      input: Schema.Null,
      success: Schema.Null,
      failure: Schema.Never
    })

    assert.strictEqual(definition.name, " ")
    assert.isTrue(Number.isNaN(definition.version))
  })
})

describe("Step.evolve", () => {
  it("creates a distinct implementation contract with stable identity lineage", () => {
    const V1 = Step.make({
      name: "payments.charge",
      version: 1,
      input: Schema.Struct({ amount: Schema.Number }),
      success: Schema.Struct({ chargeId: Schema.String }),
      failure: Schema.Struct({ reason: Schema.String })
    })
    const input = Schema.Struct({ amount: Schema.Number, currency: Schema.String })
    const success = Schema.Struct({ chargeId: Schema.String, captured: Schema.Boolean })
    const failure = Schema.Struct({ reason: Schema.String, retryable: Schema.Boolean })
    const V2 = Step.evolve(V1, { version: 2, input, success, failure })

    assert.strictEqual(V2.name, V1.name)
    assert.strictEqual(V2.version, 2)
    assert.strictEqual(V2.previous, V1)
    assert.strictEqual(V2.input, input)
    assert.strictEqual(V2.success, success)
    assert.strictEqual(V2.failure, failure)
    assert.notStrictEqual(V2.handler, V1.handler)
    assert.isTrue(Object.isFrozen(V2))
  })

  it("keeps every evolved version explicitly registerable", () => {
    const V1 = Step.make({
      name: "inventory.reserve",
      version: 1,
      input: Schema.String,
      success: Schema.String,
      failure: Schema.Never
    })
    const V2 = Step.evolve(V1, {
      version: 2,
      input: Schema.Struct({ sku: Schema.String }),
      success: Schema.String,
      failure: Schema.Never
    })

    assert.deepStrictEqual(ResonateFunctions.make(V1, V2).functions, [V1, V2])
  })
})

describe("Workflow.make", () => {
  it("creates an inert, frozen definition", () => {
    let executions = 0
    const definition = Workflow.make({
      name: "checkout",
      version: 1,
      input: Schema.Struct({ orderId: Schema.String }),
      success: Schema.Struct({ accepted: Schema.Boolean }),
      failure: Schema.Struct({ reason: Schema.String })
    })
    const implementation = definition.toLayer(async () => {
        executions += 1
        return Result.succeed({ accepted: true })
    })

    assert.strictEqual(executions, 0)
    assert.isTrue(Object.isFrozen(definition))
    assert.strictEqual(definition.name, "checkout")
    assert.strictEqual(definition.version, 1)
    assert.isTrue(Layer.isLayer(implementation))
  })

})

describe("Workflow.evolve", () => {
  it("creates a distinct implementation contract with stable identity lineage", () => {
    const V1 = Workflow.make({
      name: "checkout",
      version: 1,
      input: Schema.Struct({ orderId: Schema.String }),
      success: Schema.Struct({ accepted: Schema.Boolean }),
      failure: Schema.Struct({ reason: Schema.String })
    })
    const input = Schema.Struct({ orderId: Schema.String, paymentMethodId: Schema.String })
    const success = Schema.Struct({ accepted: Schema.Boolean, receiptId: Schema.String })
    const failure = Schema.Struct({ reason: Schema.String, retryable: Schema.Boolean })
    const V2 = Workflow.evolve(V1, { version: 2, input, success, failure })

    assert.strictEqual(V2.name, V1.name)
    assert.strictEqual(V2.version, 2)
    assert.strictEqual(V2.previous, V1)
    assert.strictEqual(V2.input, input)
    assert.strictEqual(V2.success, success)
    assert.strictEqual(V2.failure, failure)
    assert.notStrictEqual(V2.handler, V1.handler)
    assert.isTrue(Object.isFrozen(V2))
  })
})

describe("ResonateFunctions.make", () => {
  const Reserve = Step.make({
    name: "inventory.reserve",
    version: 1,
    input: Schema.Struct({ sku: Schema.String }),
    success: Schema.Struct({ reserved: Schema.String }),
    failure: Schema.Never
  })
  const Checkout = Workflow.make({
    name: "checkout",
    version: 1,
    input: Schema.Struct({ orderId: Schema.String }),
    success: Schema.String,
    failure: Schema.String
  })

  it("retains ordered functions without executing them", () => {
    const functions = ResonateFunctions.make(Reserve, Checkout)

    assert.deepStrictEqual(functions.functions, [Reserve, Checkout])
    assert.deepStrictEqual(functions.functions.map((fn) => fn.kind), ["Step", "Workflow"])
    assert.isTrue(Object.isFrozen(functions.functions))
  })

  it("supports RpcGroup-style class declarations and immutable composition", () => {
    class CheckoutFunctions extends ResonateFunctions.make(Reserve, Checkout) {}

    const extended = CheckoutFunctions.add(Reserve)
    const merged = ResonateFunctions.make(Reserve).merge(ResonateFunctions.make(Checkout))

    assert.deepStrictEqual(CheckoutFunctions.functions, [Reserve, Checkout])
    assert.deepStrictEqual(extended.functions, [Reserve, Checkout, Reserve])
    assert.deepStrictEqual(merged.functions, [Reserve, Checkout])
  })

  it("preserves duplicates for typed validation during Layer acquisition", () => {
    const functions = ResonateFunctions.make(Reserve, Reserve)

    assert.strictEqual(functions.functions.length, 2)
  })
})
