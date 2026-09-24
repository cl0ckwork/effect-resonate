# Execution inspection

Status: future feature / design note.

## Need

Provide an Effect-native way to inspect a Resonate workflow execution after it has started, similar in spirit to Temporal history inspection, without pretending Resonate has Temporal's append-only event-history model.

Resonate persists the current durable promise/task graph rather than an authoritative chronological workflow event log. Its SDK also produces per-execution-pass lifecycle traces, while chronological observability is better represented by OpenTelemetry.

The wrapper should expose those semantics clearly instead of inventing a fake Temporal-style history API.

## Proposed API direction

```ts
const execution = yield * ResonateClient.execution("checkout-123")

const graph = yield * execution.graph
const timeline = yield * execution.timeline
```

Potential node shape:

```ts
interface ExecutionNode {
  readonly id: string
  readonly parentId?: string
  readonly originId: string
  readonly operation: "workflow" | "run" | "rpc" | "sleep" | "promise"
  readonly state: "pending" | "resolved" | "rejected"
  readonly createdAt?: Date
  readonly completedAt?: Date
}
```

Names are illustrative, not API commitments.

## Semantics

### `graph`

Authoritative durable structure derived from Resonate promise/task state, likely by querying descendants with the workflow's `resonate:origin` and reconstructing parent/child relationships.

This should answer questions like:

- What durable operations belong to this workflow?
- Which operations are pending, resolved, or rejected?
- What is waiting on what?
- What are the parent/child relationships?

This is the closest analogue to `resonate tree <workflow-id>`.

### `timeline`

A convenience projection ordered from durable record timestamps and/or trace data.

It must be documented as a derived observability view, **not** an authoritative replay journal. Resonate does not persist a Temporal-style append-only event history.

### tracing

Correlate Effect spans with Resonate execution IDs / promise IDs so users can move from the durable graph to a detailed chronological trace in their OpenTelemetry backend.

Candidate attributes:

```text
resonate.execution.id
resonate.promise.id
resonate.parent.id
resonate.operation
```

## Resonate SDK trace model

The TypeScript SDK currently has internal lifecycle events such as:

```text
run
rpc
spawn
block
await
resume
suspend
return
dedup
```

The async engine exposes a lifecycle subset per `executeUntilBlocked` pass. These traces are useful implementation/observability signals, but they are not themselves persisted workflow history and should not be presented as such unless Resonate later exposes a durable trace/history API.

## Design constraints

- Do not call this `history` unless Resonate eventually provides an authoritative history abstraction.
- Do not manufacture a synthetic event log and imply replay semantics it does not have.
- Prefer Resonate's public query/tree APIs over reaching into a specific backend schema.
- Keep backend/network independence: HTTP/server, Postgres, and future providers should present the same inspection model where possible.
- Preserve enough raw IDs/tags for advanced debugging.
- Make inspection read-only in the initial implementation.

## Open questions

- What public SDK/server API is best for querying all promises by `resonate:origin`?
- Which timestamps are guaranteed across providers?
- Should graph nodes include persisted inputs/results by default or expose them lazily?
- Can the SDK's per-pass trace be surfaced through a supported API, or should we rely entirely on OpenTelemetry for chronological detail?
- How should retries/attempts appear in the graph versus the trace timeline?
- Should `Execution` be returned directly from `ResonateClient.run`, making later inspection discoverable from the normal API?

## Not required for v1

This should not block the first `Step` / `Workflow` implementation. Capture the execution identity and tracing metadata correctly in v1 so this inspection layer can be added later without changing workflow semantics.
