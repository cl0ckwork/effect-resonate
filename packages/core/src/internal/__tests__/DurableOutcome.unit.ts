import { assert, describe, it } from "@effect/vitest"
import { Match, Result, Schema, SchemaTransformation } from "effect"
import * as DurableOutcome from "../DurableOutcome.js"
import * as SchemaBoundary from "../SchemaBoundary.js"
import * as Step from "../../Step.js"
import * as Workflow from "../../Workflow.js"

const StepDefinition = Step.make({
  name: "inventory.reserve",
  version: 1,
  input: Schema.Struct({ sku: Schema.String }),
  success: Schema.Struct({ reservationId: Schema.String }),
  failure: Schema.Struct({ reason: Schema.String })
})

const WorkflowDefinition = Workflow.make({
  name: "checkout",
  version: 1,
  input: Schema.Struct({ orderId: Schema.String }),
  success: Schema.NumberFromString,
  failure: Schema.Struct({ reason: Schema.String })
})

const stepIdentity = DurableOutcome.identityOf(StepDefinition)
const executionId = "order-42"

const expectProtocolIssue = (value: unknown, issue: string): void => {
  const decoded = DurableOutcome.decodeStepResult(StepDefinition, value)
  assert.isTrue(Result.isFailure(decoded))
  if (Result.isFailure(decoded)) {
    assert.strictEqual(decoded.failure._tag, "@effect-resonate/core/DurableProtocolError")
    assert.strictEqual(decoded.failure.issue, issue)
  }
}

describe("DurableOutcome", () => {
  it("round-trips step success and checked failure", () => {
    const success = DurableOutcome.encodeStepResult(
      StepDefinition,
      Result.succeed({ reservationId: "reservation-1" })
    )
    const failure = DurableOutcome.encodeStepResult(
      Step.make({
        name: "inventory.fail",
        version: 1,
        input: Schema.Null,
        success: Schema.Never,
        failure: Schema.Struct({ reason: Schema.String })
      }),
      Result.fail({ reason: "unavailable" })
    )

    assert.isTrue(Result.isSuccess(success))
    assert.isTrue(Result.isSuccess(failure))
    if (Result.isSuccess(success)) {
      const decoded = DurableOutcome.decodeStepResult(StepDefinition, success.success)
      assert.isTrue(Result.isSuccess(decoded))
      if (Result.isSuccess(decoded)) {
        assert.deepStrictEqual(decoded.success, Result.succeed({ reservationId: "reservation-1" }))
      }
    }
  })

  it("round-trips workflow codecs without serializing Effect Result", () => {
    const encoded = DurableOutcome.encodeWorkflowResult(WorkflowDefinition, Result.succeed(42))
    assert.isTrue(Result.isSuccess(encoded))
    if (Result.isSuccess(encoded)) {
      Match.valueTags(encoded.success, {
        Success: ({ value }) => assert.strictEqual(value, "42"),
        Failure: () => assert.fail("expected workflow success"),
        InvalidInput: () => assert.fail("expected workflow success")
      })
      const decoded = DurableOutcome.decodeWorkflowResult(
        WorkflowDefinition,
        executionId,
        encoded.success
      )
      assert.deepStrictEqual(decoded, Result.succeed(Result.succeed(42)))
    }
  })

  it("round-trips step values through their declared codecs", () => {
    const TransformedStep = Step.make({
      name: "inventory.transformed",
      version: 1,
      input: Schema.Null,
      success: Schema.NumberFromString,
      failure: Schema.Never
    })
    const encoded = DurableOutcome.encodeStepResult(TransformedStep, Result.succeed(42))

    assert.isTrue(Result.isSuccess(encoded))
    if (Result.isSuccess(encoded)) {
      assert.deepStrictEqual(
        encoded.success,
        DurableOutcome.success(DurableOutcome.identityOf(TransformedStep), "42")
      )
      assert.deepStrictEqual(
        DurableOutcome.decodeStepResult(TransformedStep, encoded.success),
        Result.succeed(Result.succeed(42))
      )
    }
  })

  it("round-trips workflow input through its boundary codec", () => {
    const input = { orderId: "order-42" }
    const encoded = SchemaBoundary.encodeWorkflowInput(
      WorkflowDefinition.input,
      input,
      WorkflowDefinition.name,
      WorkflowDefinition.version
    )
    assert.deepStrictEqual(encoded, Result.succeed(input))
    if (Result.isSuccess(encoded)) {
      assert.deepStrictEqual(
        SchemaBoundary.decodeWorkflowInput(
          WorkflowDefinition.input,
          encoded.success,
          WorkflowDefinition.name,
          WorkflowDefinition.version
        ),
        Result.succeed(input)
      )
    }
  })

  it("round-trips workflow checked failures through the failure codec", () => {
    const encoded = DurableOutcome.encodeWorkflowResult(
      WorkflowDefinition,
      Result.fail({ reason: "declined" })
    )
    assert.isTrue(Result.isSuccess(encoded))
    if (Result.isSuccess(encoded)) {
      const decoded = DurableOutcome.decodeWorkflowResult(
        WorkflowDefinition,
        executionId,
        encoded.success
      )
      assert.deepStrictEqual(decoded, Result.succeed(Result.fail({ reason: "declined" })))
    }
  })

  it("classifies malformed headers, versions, identities, tags, and branches", () => {
    for (const value of [
      null,
      {},
      { protocolVersion: "1", definition: stepIdentity, _tag: "Success", value: 1 }
    ]) {
      expectProtocolIssue(value, "MalformedEnvelope")
    }

    expectProtocolIssue(
      { protocolVersion: 2, definition: stepIdentity, _tag: "Success", value: 1 },
      "UnsupportedProtocolVersion"
    )
    for (const definition of [
      { ...stepIdentity, kind: "Activity" },
      { ...stepIdentity, version: 0 },
      { ...stepIdentity, version: 1.5 }
    ]) {
      expectProtocolIssue(
        { protocolVersion: 1, definition, _tag: "Success", value: 1 },
        "InvalidDefinitionIdentity"
      )
    }
    expectProtocolIssue(
      { protocolVersion: 1, definition: stepIdentity, _tag: "Mystery", value: 1 },
      "InvalidOutcome"
    )
    for (const value of [
      { protocolVersion: 1, definition: stepIdentity, _tag: "Success" },
      { protocolVersion: 1, definition: stepIdentity, _tag: "Success", value: 1, error: "both" },
      { protocolVersion: 1, definition: stepIdentity, _tag: "Failure", value: 1, error: "both" },
      {
        protocolVersion: 1,
        definition: stepIdentity,
        _tag: "InvalidInput",
        issue: { _tag: "Other" }
      }
    ]) {
      expectProtocolIssue(value, "InvalidOutcome")
    }
  })

  it("rejects malformed JSON payloads", () => {
    expectProtocolIssue(
      { protocolVersion: 1, definition: stepIdentity, _tag: "Success", value: new Date(0) },
      "PayloadDecodeFailed"
    )
  })

  it("checks identity before decoding a payload", () => {
    const secret = "secret-wrong-contract"
    const decoded = DurableOutcome.decodeWorkflowResult(WorkflowDefinition, executionId, {
      protocolVersion: 1,
      definition: { kind: "Workflow", name: "another-workflow", version: 1 },
      _tag: "Success",
      value: secret
    })

    assert.isTrue(Result.isFailure(decoded))
    if (Result.isFailure(decoded)) {
      assert.strictEqual(decoded.failure._tag, "@effect-resonate/core/DefinitionConflict")
      assert.notInclude(JSON.stringify(decoded.failure), secret)
    }
  })

  it("maps invalid-input outcomes to a sanitized workflow error", () => {
    const decoded = DurableOutcome.decodeWorkflowResult(
      WorkflowDefinition,
      executionId,
      DurableOutcome.invalidInput(DurableOutcome.identityOf(WorkflowDefinition))
    )

    assert.isTrue(Result.isFailure(decoded))
    if (Result.isFailure(decoded)) {
      Match.valueTags(decoded.failure, {
        "@effect-resonate/core/DefinitionConflict": () =>
          assert.fail("expected invalid workflow input"),
        "@effect-resonate/core/DurableProtocolError": () =>
          assert.fail("expected invalid workflow input"),
        "@effect-resonate/core/InvalidWorkflowInput": (error) => {
          assert.strictEqual(error.workflowName, "checkout")
          assert.strictEqual(error.workflowVersion, 1)
          assert.strictEqual(error.issue, "SchemaMismatch")
        }
      })
    }
  })

  it("redacts workflow schema decode and encode details", () => {
    const decodeSecret = "secret-decode-input"
    const encodeSecret = "secret-encode-input"
    const decoded = SchemaBoundary.decodeWorkflowInput(
      WorkflowDefinition.input,
      { orderId: 1, secret: decodeSecret },
      WorkflowDefinition.name,
      WorkflowDefinition.version
    )
    const encoded = DurableOutcome.encodeWorkflowResult(
      WorkflowDefinition,
      Result.succeed(encodeSecret as unknown as number)
    )

    assert.isTrue(Result.isFailure(decoded))
    assert.isTrue(Result.isFailure(encoded))
    assert.notInclude(JSON.stringify(decoded), decodeSecret)
    assert.notInclude(JSON.stringify(encoded), encodeSecret)
  })

  it("redacts thrown codec defects and stacks", () => {
    const secret = "secret-codec-defect"
    const ThrowingCodec = Schema.String.pipe(
      Schema.decodeTo(
        Schema.String,
        SchemaTransformation.transform({
          decode: () => {
            throw new Error(secret)
          },
          encode: () => {
            throw new Error(secret)
          }
        })
      )
    )
    const ThrowingWorkflow = Workflow.make({
      name: "throwing-workflow",
      version: 1,
      input: Schema.String,
      success: ThrowingCodec,
      failure: Schema.String
    })

    const decoded = DurableOutcome.decodeWorkflowResult(
      ThrowingWorkflow,
      executionId,
      DurableOutcome.success(DurableOutcome.identityOf(ThrowingWorkflow), "encoded")
    )
    const encoded = DurableOutcome.encodeWorkflowResult(ThrowingWorkflow, Result.succeed("decoded"))

    assert.isTrue(Result.isFailure(decoded))
    assert.isTrue(Result.isFailure(encoded))
    assert.notInclude(JSON.stringify(decoded), secret)
    assert.notInclude(JSON.stringify(encoded), secret)
  })

  it("reports step schema encoding failures without retaining values", () => {
    const secret = "secret-step-output"
    const encoded = DurableOutcome.encodeStepResult(
      StepDefinition,
      Result.succeed(
        new (class SecretValue {
          readonly value = secret
        })() as never
      )
    )

    assert.isTrue(Result.isFailure(encoded))
    if (Result.isFailure(encoded)) {
      assert.strictEqual(encoded.failure._tag, "@effect-resonate/core/DurableProtocolError")
      assert.strictEqual(encoded.failure.issue, "PayloadEncodeFailed")
      assert.notInclude(JSON.stringify(encoded.failure), secret)
    }
  })
})
