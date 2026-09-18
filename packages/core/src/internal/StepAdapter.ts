import type { Info } from "@resonatehq/sdk/async"
import { Cause, type Context, Effect, Exit, Match, Result } from "effect"
import type { Type as DurableValue } from "../DurableValue.js"
import type * as Step from "../Step.js"
import type { StepContextService } from "../StepContext.js"
import { AdapterSupervisor, never } from "./AdapterSupervisor.js"
import * as DurableOutcome from "./DurableOutcome.js"
import * as DurableRejection from "./DurableRejection.js"
import { decodeWorkflowPayload, durableCodec } from "./SchemaBoundary.js"

const metadata = (context: Info): StepContextService => Object.freeze({
  id: context.id,
  parentId: context.parentId,
  originId: context.originId,
  branchId: context.branchId,
  timeoutAt: context.timeoutAt,
  attempt: context.attempt,
  version: context.version,
  name: context.func
})

const rejectedReason = <E>(cause: Cause.Cause<E>): "Defect" | "Interrupted" | "CompositeCause" | "Unknown" => {
  if (cause.reasons.length !== 1) {
    return cause.reasons.length === 0 ? "Unknown" : "CompositeCause"
  }
  return Match.valueTags(cause.reasons[0]!, {
    Fail: () => "Unknown" as const,
    Die: () => "Defect" as const,
    Interrupt: () => "Interrupted" as const
  })
}

type Disposition =
  | {
    readonly _tag: "Resolved"
    readonly value: DurableOutcome.DurableOutcome<DurableValue, DurableValue>
  }
  | {
    readonly _tag: "Rejected"
    readonly value: DurableRejection.DurableExecutionRejected
  }

const rejected = <
  Definition extends Step.Any
>(
  definition: Definition,
  executionId: string,
  reason: DurableRejection.DurableExecutionRejected["reason"]
): Disposition => ({
  _tag: "Rejected",
  value: DurableRejection.make(definition, executionId, reason)
})

const classify = <
  Definition extends Step.Any
>(
  definition: Definition,
  executionId: string,
  exit: Exit.Exit<Step.Step.Success<Definition>, Step.Step.Failure<Definition>>
): Disposition => Match.valueTags(exit, {
  Success: ({ value }) => {
    const encoded = DurableOutcome.encodeStepResult(definition, Result.succeed(value))
    return Result.isFailure(encoded)
      ? rejected(definition, executionId, "ContractViolation")
      : { _tag: "Resolved" as const, value: encoded.success }
  },
  Failure: ({ cause }) => {
    if (cause.reasons.length === 1 && Cause.isFailReason(cause.reasons[0]!)) {
      const encoded = DurableOutcome.encodeStepResult(
        definition,
        Result.fail(cause.reasons[0]!.error as Step.Step.Failure<Definition>)
      )
      return Result.isFailure(encoded)
        ? rejected(definition, executionId, "ContractViolation")
        : { _tag: "Resolved" as const, value: encoded.success }
    }
    return rejected(definition, executionId, rejectedReason(cause))
  }
})

export const make = <
  Definition extends Step.Any
>(
  definition: Definition,
  runPromise: <A>(
    effect: Effect.Effect<A, never, Step.Handler<Definition> | AdapterSupervisor>
  ) => Promise<A>
) => async (
  context: Info,
  ...arguments_: ReadonlyArray<unknown>
): Promise<DurableOutcome.DurableOutcome<DurableValue, DurableValue>> => {
  const program = Effect.gen(function*() {
    if (arguments_.length !== 1) {
      return rejected(definition, context.id, "ContractViolation")
    }
    const input = decodeWorkflowPayload(durableCodec(definition.input), arguments_[0])
    if (Result.isFailure(input)) {
      return rejected(definition, context.id, "ContractViolation")
    }

    const handlerTag = definition.handler as Context.Key<
      Step.Handler<Definition>,
      Step.HandlerService<
        Step.Step.Input<Definition>,
        Step.Step.Success<Definition>,
        Step.Step.Failure<Definition>
      >
    >
    const handler = yield* handlerTag
    const exit = yield* handler.execute(
      input.success as Step.Step.Input<Definition>,
      metadata(context)
    ).pipe(Effect.exit)
    return classify(definition, context.id, exit)
  }).pipe(AdapterSupervisor.supervise)

  const completion = await runPromise(program)

  return Match.valueTags(completion, {
    Fenced: () => never,
    Completed: ({ exit }) => Match.valueTags(exit, {
      Failure: ({ cause }) => {
        throw DurableRejection.make(definition, context.id, rejectedReason(cause))
      },
      Success: ({ value }) => Match.valueTags(value, {
        Rejected: ({ value }) => {
          throw value
        },
        Resolved: ({ value }) => value
      })
    })
  })
}
