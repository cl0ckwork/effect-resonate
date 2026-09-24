# Architecture and durable execution

This guide records the behavior contributors need to preserve when changing
`@effect-resonate/core` or a network provider. For package boundaries and build
output, see [PACKAGING.md](./PACKAGING.md). For application code, start with the
[core guide](../packages/core/README.md).

## Ownership

Resonate owns workflow orchestration, checkpoints, replay, timers, retries, and
distributed calls. A workflow is an async Resonate program. Its context methods
are eager and keep the upstream positional API; they do not return Effect
programs. Run application Effects in registered steps, where Effect owns
services, typed errors, resource scopes, tracing, and external integrations.
Do not suspend a workflow on arbitrary I/O or a long-lived Effect program and
then issue another durable context operation: the async SDK may close that
context when the pass suspends.

Core adapts the upstream async SDK. Raw calls retain SDK names, arguments,
records, and handle boundaries. A typed definition selects the additive schema
protocol; a raw call does not pass through wrapper codecs. The provider owns
its network resource through a Layer. The client Layer validates the complete
function group before opening that network, waits for exact-version
registration, and owns bounded shutdown of admitted step handlers. Resonate
owns the lifecycle of suspended workflow frames.

## Persisted contracts and identity

Workflow and step definitions are versioned persisted contracts. The function
group is a flat registry: each retained or in-flight version needs its own
definition and handler Layer. `evolve` records lineage and creates a distinct
contract; it does not register or implement ancestors. Change a step version
when its input, output, failure, or externally observable effect changes.
Change a workflow version when its durable call sequence, options, or selected
step versions change. An implementation refactor can keep its version only if
observable behavior stays the same.

Client acquisition rejects invalid or duplicate identities before delivery:
names must be nonempty, versions positive integers, and evolution lineage
acyclic and strictly increasing. Persisted calls resolve an exact version;
there is no implicit latest version. Root execution IDs are global logical
invocation IDs. The first durable record wins. Reuse the same ID and contract
to reconcile an uncertain activation, or use `get` to look it up. Use a new ID
for a new logical invocation. Typed calls check the persisted definition
identity, but a reused ID does not replace the original input.

## Failure boundaries

| Boundary                                    | Behavior                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checked Effect failure from a typed step    | Encode with the declared failure schema as a resolved durable outcome.                                                                                      |
| Defect or interruption                      | Reject the durable operation; never turn it into a declared domain failure. A single `Error` defect reaches the SDK unchanged for its retry classification. |
| SDK or network call                         | Fail the Effect with `ResonateSdkError` and retain the upstream cause. A failed activation response may still have committed.                               |
| Malformed persisted typed value or identity | Fail with a wrapper-owned input, protocol, or definition conflict error at the boundary.                                                                    |
| Cancelled waiter or durable timeout         | Keep the durable execution's own state. Neither proves an external effect stopped.                                                                          |

Typed boundary codecs are service-free and run only where core owns the value:
persisted workflow and step arguments, typed outcomes, typed external promise
values, and rejected root identity. JSON-compatible data is the default durable
representation. Raw SDK records and options remain upstream-owned.

An external write can succeed before its step checkpoint is recorded. Replay
may therefore execute the write again. `StepContext.id` is stable for the same
durable step across delivery attempts; pass it as an idempotency key when the
external system supports one. The wrapper cannot make a separate system's
write exactly once. A durable timeout can also be recorded before a late
external write finishes.

## Validation still to add

The PostgreSQL conformance suite covers provider behavior and worker recovery.
The wider acceptance matrix remains follow-up work: kill a worker after a
business side effect but before its checkpoint and assert one business row for
the repeated stable step ID; test bounded drain, lease expiry, and replay after
old-worker fencing; test a late external effect after durable timeout; and test
definition/version conflicts and a lost activation response against PostgreSQL.
These cases remain part of the PostgreSQL acceptance work.
