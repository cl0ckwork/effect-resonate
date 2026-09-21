# Thin wrapper simplification plan

## Summary

Implement the settled portions of
[`docs/specs/2026-09-20-001-thin-wrapper-simplification-spec.md`](../specs/2026-09-20-001-thin-wrapper-simplification-spec.md):
raw client calls become positional SDK-parity Effects, version correctness moves
entirely to the runtime registry, function groups become plain immutable values,
`WorkflowContext` derives/delegates its raw surface, and original `Error`
defects pass directly to Resonate for retry classification and serialization.

## Requirements trace

- SC1–SC3, SC7: U2
- SC4: U1
- SC5: U1
- SC6: U3
- SC8: U1–U5 regression suite
- W1–W3, W7 / S1–S2 / C1: U2
- W4–W5 / S3 / C2–C3: U1
- W6 / S4 / C4: U3
- S5 / L2: U4
- W8: U5

## Protocol and decisions

Raw calls flow `positional arguments → thin Promise/throw adapter → upstream
SDK`; typed calls insert only schema encoding/decoding before or after that same
adapter. Workflows retain eager upstream `DurablePromise` calls. SDK retry,
replay, duplicate execution, timeouts, and cancellation are not reimplemented.

Key decisions:

- Derive raw parameters and records from public SDK types; do not retain named
  request compatibility overloads.
- Preserve typed overload inference with positional `(id, definition, value,
  options?)` shapes rather than a typed namespace.
- Keep runtime definition validation before network opening; remove only the
  duplicate template-literal arithmetic.
- Represent groups as frozen objects with frozen ordered arrays and ordinary
  `add`/`merge` methods.
- Derive the context interface from upstream and delegate unchanged members;
  retain adapters only for typed `run`, `rpc`, `detached`, and `promise`.
- Pass a single `Error` defect through unchanged; retain wrapper durable
  rejections only where core owns the failure representation.

## Implementation units

### U1 — Runtime-owned definitions and plain groups

Update `packages/core/src/Step.ts`, `Workflow.ts`, and
`ResonateFunctions.ts`; migrate group call sites and type tests. Remove static
numeric comparison constraints while preserving literal name/version inference.
Replace callable pseudo-classes with frozen group objects, preserving ordered
composition and exact handler requirements. Tests prove invalid dynamic and
literal values fail during acquisition, group immutability, add/merge ordering,
and Layer requirement inference.

### U2 — Positional client parity

Refactor `packages/core/src/ResonateClient.ts` and
`internal/ClientLive.ts` so raw method parameters derive from the installed SDK
and are forwarded positionally. Add positional typed overloads for definitions
and typed promise settlement. Migrate integration/type tests and README examples.
Tests cover zero/multiple function arguments, trailing upstream options, raw and
typed handles, all promise/schedule methods, first-writer-wins attachment, and
SDK error metadata.

### U3 — Derived workflow context

Refactor `packages/core/src/WorkflowContext.ts` and
`internal/WorkflowContextImpl.ts` to inherit the public async Context surface
and override only schema-aware operations. Keep eager `DurablePromise` behavior,
closed-context enforcement, exact version injection, and boundary decoding.
Type/runtime tests prove raw parity and typed calls, including malformed durable
outcomes and typed promise decoding.

### U4 — Documentation and release-shape verification

Update current README/spec/plan language and examples to remove named requests
and class groups. Run production and type-test compilation, all core and root
tests, ESLint, `zshy`, declaration inspection, `git diff --check`, and the packed
consumer test if present. Existing cancellation-safe shutdown, retry, replay,
timeout, and malformed-boundary tests must remain green.

### U5 — Upstream-owned Error defects

Remove the step adapter's prototype and `toJSON` compatibility graft. A single
Effect defect containing an `Error` is thrown unchanged so the SDK owns
`nonRetryableErrors` classification and persistence. Keep structured durable
rejections for wrapper contract failures, interruption, composite causes, and
non-`Error` defects. Tests prove exact error identity reaches the SDK, an
original constructor stops retries, and the typed workflow boundary still
normalizes an uncaught defect without promising child provenance.

## Risks and mitigations

- **Overload inference regresses:** keep public type assertions for function,
  string, typed workflow, zero-argument, and variadic calls.
- **Options become an ordinary last argument:** derive upstream tuple types and
  test exact trailing `Options` forwarding rather than detecting lookalikes.
- **Plain groups lose handler requirements:** retain a covariant definition
  union in the group type and assert the resulting Layer service requirements.
- **Context delegation changes `this`:** bind or close over upstream methods and
  test every public context method; do not rely on prototype copying.
- **Error persistence changes:** document that Resonate owns messages, stacks,
  reconstruction, and redaction for original `Error` defects; keep wrapper
  records free of raw causes.

## Open questions

No product decision remains open for this implementation.
