# Resonate API parity refactor plan

Source: `docs/specs/2026-09-18-001-resonate-api-parity-spec.md`

## Summary

Refactor `@effect-resonate/core` so the installed async Resonate SDK defines the
public vocabulary and behavior. Client, handle, promise, schedule, and workflow
context operations retain upstream names and namespaces. The wrapper adds
scoped Layer ownership, Effect return/error channels, named request objects,
and optional schema-aware overloads without substituting a parallel API.

## Requirements trace

| ID | Requirement |
| --- | --- |
| R1 | Mirror every public installed async client, subclient, handle, and Context capability or document its Effect lifecycle substitution. |
| R2 | Preserve upstream handle-returning `run` / `rpc` / `get` semantics. |
| R3 | Import or infer upstream public option and record types; do not copy protocol records. |
| R4 | Keep raw parity methods available when schema-first definitions add typed overloads. |
| R5 | Preserve eager async-context execution and never run an Effect runtime inside workflows. |
| R6 | Preserve one thin SDK failure wrapper with cause and commit uncertainty. |
| R7 | Keep Layer-owned readiness, draining, fencing, and idempotent shutdown. |
| R8 | Make upstream documentation mechanically reusable: method/namespace names stay canonical. |

## Walkthroughs and invariants

Implement and test W1–W8 and S1–S5/L1–L2/C1–C3 from the source spec. The
critical enforcement change is S1: `run` no longer awaits a result under the
activation method. Result decoding moves to the returned handle's `result()`.

Raw runtime registration has upstream timing semantics and may race work already
being delivered. Declarative `ResonateFunctions` preregistration remains the
safe atomic startup path: it completes before the gate opens. Documentation must
state that distinction without hiding raw `register`.

## Protocol / dataflow

```text
named request -> module accessor -> ResonateClient service
  -> same-name async SDK method
  -> Promise failure -> ResonateSdkError
  -> Promise success -> upstream record or wrapped handle

wrapped handle.result()
  -> raw registration: upstream value unchanged
  -> typed definition: exact durable-envelope identity + schema decode

workflow Context
  -> same-name facade method
  -> upstream eager DurablePromise
  -> raw overload: upstream value/rejection
  -> typed definition overload: wrapper durable envelope + Result
```

Interruption stops only the local Effect waiter. It does not cancel durable
state. Duplicate activation/settlement remains first-writer-wins in Resonate.
Partial activation failure retains `requestMayHaveCommitted`; recovery uses
`get` and the returned handle.

## Key decisions

1. **Same names, additive overloads.** A separate typed namespace was rejected
   because it would create a second documentation vocabulary. Raw requests use
   `func`/`args`; typed requests use `workflow`/`input`, but both use `run`/`rpc`
   and return handles.
2. **Effect-native handles.** Returning final results from `run` was rejected
   because the async SDK explicitly returns a handle. Handle methods preserve
   `.result()` / `.done()` names and return Effects.
3. **Namespaces are values on the service/module.** `promises.*` and
   `schedules.*` remain discoverable exactly where upstream exposes them.
4. **Public SDK types are authoritative.** Use root/async public exports or
   inference from `Resonate` properties. Do not deep-import SDK internals or
   recreate `PromiseRecord`, `TaskRecord`, `ScheduleRecord`, options, or retry
   types.
5. **Lifecycle substitution is narrow.** Layer acquisition replaces the
   constructor and normal Layer release replaces mandatory manual stop. Explicit
   `stop` remains available and shares the same once-only shutdown gate.
6. **Definitions are optional preregistration.** The current flat function group
   remains an atomic, schema-aware startup facility. Raw `register` remains
   available as an upstream parity escape hatch and makes no Effect supervision
   or schema claim.
7. **Named request objects remain.** This is the one systematic syntax
   difference from upstream positional calls and follows the established public
   API rule.
8. **Network configuration has one owner.** Connection selection and credentials
   remain inputs to the `ResonateNetwork` Layer. The client Layer accepts only
   constructor fields that the upstream SDK still applies when `network` is
   supplied.
9. **One narrow SDK compatibility correction.** Bind the installed SDK 0.11.5
   `ResonateFunc.options` helper to the owning client; preserve its public input
   and output types and remove this exception when upstream no longer needs it.
10. **SDK upgrades are parity-gated.** Compile-time key matrices for the client,
    namespaces, handles, registered functions, and Context must pass before an
    SDK version change lands. Every new key is mapped or explicitly documented.

## Implementation units

### U1 — Public upstream-shaped types, handles, and service surface

Files: `packages/core/src/ResonateClient.ts`, optionally one focused public
handle module if declaration readability requires it, `packages/core/src/index.ts`,
and `packages/core/src/__tests__/PublicApi.types.ts`.

Define Effect-native `ResonateHandle` and schedule handle interfaces with
same-name methods. Expand `ResonateClientService` and module accessors to
`register`, `setDependency`, `run`, `rpc`, `get`, `schedule`, `options`, `stop`,
`promises.*` (including callback/listener registration), and `schedules.*`.
Infer raw request/result types from the public SDK. Add definition-aware
overloads without changing raw record shapes.

Tests prove every installed public method is represented, environment/error/
success types are exact, namespaces are discoverable, raw and typed overloads
resolve correctly, and generator-only `begin*` methods are absent.

Verification: the type suite fails if a mapped SDK method disappears or changes
incompatibly, while `zshy` emits no deep SDK import.

### U2 — ClientLive parity adapter and once-only lifecycle

Files: `packages/core/src/internal/ClientLive.ts`,
`packages/core/src/internal/GatedNetwork.ts`, SDK error helpers, and
`packages/core/src/__tests__/ResonateClient.integration.ts`.

Wrap Promise-returning SDK operations with `Effect.tryPromise`; wrap synchronous
methods with `Effect.try`. Preserve original return values and operation names.
Build handle adapters without eagerly calling `.result()`. Move current typed
workflow decoding into typed handle `result()`. Expose raw promise/schedule
subclients without applying the wrapper's codec; retain schema overloads as
explicit typed paths. Route explicit `stop` and scope finalization through one
idempotent shutdown owner.

Tests cover every operation, raw records, typed handles, not-found, malformed
typed values, first-writer-wins settlement, response loss followed by `get`,
local interruption, timeouts, explicit-stop-then-release, and failure at each
Promise boundary.

Verification: observable values and state match direct SDK calls except that
failures and waits live in Effect.

### U3 — Async Context parity

Files: `packages/core/src/WorkflowContext.ts`,
`packages/core/src/internal/WorkflowContextImpl.ts`, `packages/core/src/StepContext.ts`,
workflow/step adapters, and focused unit/integration/type tests.

Add the installed async `Info` metadata and `getDependency`. Mirror eager
`run`, `rpc`, `detached`, `promise`, both `sleep` forms, `options`, `panic`,
`assert`, `date.now`, and `math.random`. Preserve raw overload behavior and keep
definition/schema overloads additive. Never wrap a durable operation in an
Effect runtime or turn its eager DurablePromise into a lazy Effect.

Tests prove eager fan-out, detached lineage, options forwarding, dependency
lookup, panic/assert abort behavior, sleep forms, stable time/random, closed-pass
guards, and exact-version typed calls.

Verification: upstream async Context examples translate by replacing raw
functions with definitions only when the caller opts into schema typing.

### U4 — Registration and documentation migration

Files: definitions/function-group modules, `packages/core/README.md`, current
brainstorm/dependency/spec/plan documents, and a small consumer example.

Make declarative function groups optional preregistration rather than the only
way to reach `register`. Document the delivery-race difference between atomic
preregistration and raw late registration. Use canonical `get` and namespaced
promise calls instead of perpetuating earlier wrapper-specific helper designs;
because the package is unreleased, add no compatibility aliases unless a fixture
proves an external need. Link to upstream Resonate docs for operation semantics
and document only Effect translation, typed overloads, and lifecycle.

Tests compare one direct-SDK program with its Effect-wrapped equivalent and run
the packed consumer against public exports only.

Verification: a reader can follow the official async-engine docs and translate
each supported example mechanically without consulting a second conceptual API.

## Risks and mitigations

- **Raw registration bypasses schemas and Effect step supervision.** Keep it
  explicit, preserve upstream behavior, and recommend atomic definition-group
  preregistration for Effect-backed steps.
- **A broad public surface can drift with SDK patches.** Derive types from public
  SDK exports and maintain a compile-time parity matrix.
- **Explicit stop can conflict with Scope release.** One shutdown gate owns both
  paths and tests exactly-once network stop.
- **Raw and typed overloads can become ambiguous.** Use disjoint named fields
  (`func`/`args` versus `workflow`/`input`, raw value versus `schema`/`value`).
- **Context wrapping can accidentally destroy eagerness.** Context methods return
  DurablePromises directly; only ephemeral client Promises become Effects.
- **Tests or examples can accidentally collapse invocation and waiting.** Keep
  `const handle = yield* run(...); yield* handle.result()` explicit and retain
  recovery assertions at both boundaries.

## Open questions

No product or architecture question remains. During implementation, TypeScript
may require a small exported handle module to keep overload declarations and
generated `.d.ts` readable; that is a packaging detail, not a behavior choice.
