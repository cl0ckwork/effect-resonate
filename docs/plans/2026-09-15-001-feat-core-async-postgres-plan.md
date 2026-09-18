# Network-neutral async core with Postgres provider durability plan

Source: `docs/specs/2026-09-15-001-core-async-postgres-spec.md`

## Summary

Implement the first public `@effect-resonate/core` API as inert `Step` and
`Workflow` definitions, typed durable contexts, and a scoped `ResonateClient`
backed by `@resonatehq/sdk/async`. The implementation keeps orchestration and
replay in Resonate, runs Effect programs only inside registered step adapters,
validates every persistence/trust boundary, and exposes only a provider-neutral
`ResonateNetwork` contract. A separate Postgres network package implements that
contract with the official SDK provider. A private testing package supplies
reusable network conformance scenarios, and a private IntegreSQL-backed app
composes the Postgres runtime evaluation.

Core and the Postgres provider remain separate bundler-free ESM packages. Core
has no Postgres or `pg` edge. The provider package owns `pg`; production
packages do not ship the shared runtime test suite or its infrastructure.

## Requirements trace

| Requirement | Implementation units | Observable proof |
| --- | --- | --- |
| SC1 — Typed definitions | U1, U3, U4 | Public/type tests define, register, and invoke workflows without SDK imports. |
| SC2 — Real Postgres completion | U7 | A worker executes a step, sleeps, restarts, and a fresh client decodes the result. |
| SC3 — Recovery | U4, U5, U7 | Shared post-checkpoint, sleeping, crash-window, and drain-expiry scenarios pass through the Postgres composition. |
| SC4 — Duplicate activation | U2, U4, U7 | Same-ID concurrent/conflicting calls share the first execution; identity mismatch is rejected. |
| SC5 — Side-effect crash window | U3, U7 | Re-entry observes one stable step ID and a target uniqueness constraint leaves one row. |
| SC6 — Failure distinction | U2, U3, U4, U7 | Checked failure, defect, malformed input, timeout, and outage have distinct observations. |
| SC7 — Managed lifecycle | U4–U7 | Core lifecycle contracts and provider/runtime readiness, drain, release, and recovery tests. |
| SC8 — Durable-value contract | U1, U2, U3 | Negative type tests and table-driven JSON/envelope/schema boundary tests. |
| SC9 — Durable workflow discipline | U3, U5 | Context docs/types plus an SDK-backed closed-context rejection scenario. |
| SC10 — Packaging | U6, U8 | Core has no Postgres edge; provider/test/app manifests and packed consumers prove the boundaries. |
| SC11 — Context surface | U1, U3, U5, U7 | Shared boundary scenarios cover run/rpc, sleep, promises, time/random, and metadata. |

## Walkthroughs and invariants

The implementation must preserve walkthroughs W1–W15 and invariants S1–S9,
L1–L3, and C1–C5 from the source spec. The spec's path/diagram coverage is the
acceptance map; implementation tests may combine setup, but must retain a named
test or assertion for every walkthrough.

Installed-source discoveries refine enforcement without changing those
requirements:

- SDK 0.11.5's async `Resonate` constructor calls `network.init()` without
  awaiting it and logs rejection. A wrapper-owned gated `Network` must memoize
  that initialization promise so Layer acquisition can await it, while holding
  deliveries until registration and readiness finish.
- SDK registry lookup selects the latest version when none is supplied. Every
  wrapper registration and root/child call must instead pass the referenced
  definition's explicit positive version through `resonate.options(...)` or
  `ctx.options(...)`.
- Async `ctx.run`, `ctx.rpc`, `ctx.sleep`, `ctx.promise`, `ctx.date.now`, and
  `ctx.math.random` are eager `DurablePromise`s. Facade methods must preserve
  eager creation and must not wrap them in an Effect runtime or ordinary async
  scheduling.
- `ResonateClient.layer({ functions, drainTimeout })` retains the group's handler services
  and `ResonateNetwork` in its Layer requirements. Handler Layers are acquired
  once through ordinary composition, and the scoped client captures that Effect
  context for SDK callbacks. An internal `AdapterSupervisor` uses `FiberSet.run`
  without building a nested `ManagedRuntime`. A
  domain failure is recognized only when the failed Exit's `Cause.reasons`
  contains exactly one `Fail` and no defect/interruption.
- The core gate must memoize initialization and shutdown and contain acquisition
  races for every SDK-compatible network. Provider-specific lifecycle facts
  stay in provider tests. For the first provider, `PostgresNetwork.init()` is
  not idempotent and `stop()` can race acquisition; composition tests prove the
  generic core gate contains those behaviors without a Postgres branch.
- SDK delivery callbacks are fire-and-forget. Closing intake alone cannot
  cancel a callback already handed to the SDK, so adapter admission must also be
  gated. An adapter denied after release begins returns one shared, never-settling
  parked promise without capturing per-delivery state; stopping the network
  releases the SDK's callback references. A started step is supervised by the
  scoped worker `FiberSet`. Drain expiry moves the supervisor to abandoned,
  fences its Exits from checkpointing, and starts `FiberSet.clear` inside a
  second scoped interruptor set so the interruption request cannot block network
  shutdown.
  Layer release waits for every admitted fiber to settle, including interrupt
  finalizers, before provided application resources release; therefore the
  configured duration bounds the graceful-drain phase, not arbitrary
  uninterruptible user code. Lease recovery—not a shutdown-generated rejection—
  is the only durable continuation.

Preconditions are: unique `(name, version)` registrations, positive integer
versions, service-free workflow and step codecs, JSON-compatible encoded durable values,
globally unique root IDs unless intentional attachment is desired, and a Layer
that supplies every function handler plus its transitive requirements. Postconditions are: each admitted adapter
uses the one acquired Layer context; every resolved persisted outcome has
a valid identity-bearing envelope; and release creates no new durable outcome.

## Protocol / dataflow

```text
Effect caller
  -> Workflow input decode + encode
  -> ResonateClient.run(id, exact workflow version)  [activation may commit]
  -> gated SDK Network -> selected provider
  -> workflow adapter: tuple check -> schema decode -> async workflow body
       -> WorkflowContext.run/rpc(exact Step version)
       -> step adapter: captured Layer context -> AdapterSupervisor -> scoped FiberSet
            -> Success Exit ---------> Step Success envelope
            -> one Fail reason ------> Step Failure envelope
            -> defect/interruption --> sanitized rejected durable operation
       -> sleep/promise/time/random remain SDK DurablePromises
       -> workflow Result branch -> schema encode -> Workflow envelope
  -> provider checkpoint / suspend / lease recovery / replay
  -> final identity check -> branch schema decode -> Effect success or E
```

- Replay re-enters workflow code, while SDK child IDs and exact versions recover
  checkpointed outcomes. A checkpointed step is decoded, not rerun.
- Duplicate root activation uses SDK conflict-to-listener behavior. The first
  persisted definition/input wins; the final envelope identity is checked before
  either payload schema is selected.
- An uncheckpointed step can run again with the same `StepContext.id`; external
  exactly-once behavior requires target-system idempotency.
- Effect retry is local to one admitted adapter. Resonate retry is explicit in
  the workflow/root options and is per in-process pass; neither has a wrapper
  default. Checked failure envelopes are resolved and therefore not retried.
- Interrupting a caller cancels only the Effect wait. If activation dispatch may
  already have committed, the caller recovers with the supplied ID via identical
  `run` or input-free `attach`.
- A durable timeout settles independently of running Effect code. A late adapter
  may still commit an external effect, but its late checkpoint cannot replace
  the timed-out state.
- Release transitions `open -> closing -> draining -> stopped -> settled ->
  disposed`. Partial acquisition finalizes in reverse order. Drain expiry marks
  remaining tokens abandoned and requests interruption before stopping the
  Resonate instance, which is the single owner of network/heartbeat shutdown.
  Core then awaits admitted adapter promises before disposing the runtime. A
  separate once-only network finalizer exists only until ownership transfers to
  a successfully constructed Resonate instance.

## Key decisions

### Public API is definition-first and SDK-free

Add stable core modules `DurableValue`, `CoreExecutionError`, `Step`,
`StepContext`, `Workflow`, `WorkflowContext`, `ResonateFunctions`,
`ResonateNetwork`, and `ResonateClient`. `Step.make` requires
`{ name, version, input, success, failure }`;
`Workflow.make` requires `{ name, version, input, success, failure }`.
Versions are required rather than silently defaulted because persisted dispatch
must never select "latest". Definitions are inert durable contracts. Each
module also exposes `evolve(previous, { version, input, success, failure })` to
preserve the stable function name while creating a strictly newer contract,
distinct handler service, and explicit lineage. Evolution never inherits an
implementation or implicitly registers an ancestor. Step contract or observable
side-effect changes require evolution; workflow contract or durable-composition
changes require evolution. Semantics-preserving implementation refactors do not.
Each definition exposes `toLayer(handler)`: step handlers are `Effect<A, E, R>` and
workflow handlers remain Resonate async functions. Handler Layers capture their
requirements while contract-only imports carry no implementation dependencies.
`ResonateFunctions.make(...functions)` follows Effect's `RpcGroup.make`
shape: it creates a first-class immutable, flat function group, retains ordered
duplicates for validation, and supports class-style declarations, `add`, and
`merge`. Definition constructors and group composition are total and
non-throwing. The client Layer validates dynamic identities and duplicate exact
pairs in its typed acquisition error channel before exposing the service.

`WorkflowContext.run/rpc` accept a `Step`, input, and visible invocation options
and return SDK-compatible awaitables of `Result<A, E>`. The context also exposes
durable `sleep`, schema-decoded external `promise`, replay-stable time/random,
and readonly wrapper metadata. `StepContext` exposes the readonly invocation
metadata, including the stable step ID. `ResonateClient` exposes typed
`resolvePromise`, plus JSON-safe `rejectPromise` and `cancelPromise`, so external
promises are usable without an SDK escape hatch. Detached workflows, schedules,
and arbitrary SDK access remain absent per scope.

Alternatives rejected: string-based definitions lose type/identity evidence;
implicit version 1 allows accidental version drift; Effect-authored workflows
would create a second interpreter and make ordinary awaits look durable.

### One owned outcome protocol at persistence boundaries

Use an internal protocol-version-1 discriminated schema with common
`{ protocolVersion, definition: { kind, name, version } }` metadata and exactly
one of `Success.value`, `Failure.error`, or `InvalidInput.issue`. Validate the
common envelope and definition identity before decoding branch payloads.
Reconstruct Effect `Result` only in memory. A recursive runtime JSON schema
accepts only null, booleans, strings, finite numbers, arrays, and plain records;
it rejects unsupported prototypes, undefined fields, sparse arrays, and cycles
before SDK encoding.

Alternatives rejected: serializing Effect `Result` leaks runtime structure;
throwing checked errors conflates domain and execution failure; plain
`JSON.stringify` silently loses/coerces values and does not reject class
instances consistently.

### Layer owns readiness, registration, admission, and shutdown

`ResonateClient.layer` accepts an object containing a `ResonateFunctions`
contract group and a finite drain duration. Its Layer requirements retain
the group's exact handler services and `ResonateNetwork`; applications satisfy
those requirements with ordinary `Layer.provide`. Its scoped constructor
validates the group, acquires the internal `AdapterSupervisor`, captures the
already-acquired Effect context for SDK callbacks, and constructs the SDK with the
gated official Network, registers all exact versions, awaits network readiness,
then opens delivery and exposes the client service. The same state machine makes release
idempotent and fences late completions. A semaphore makes admission plus fiber
registration atomic with closing the supervisor, so draining cannot miss an
accepted step.

The drain duration is a grace-period bound, not a promise that arbitrary user
code or its finalizers can be forcibly terminated. After expiry, core fences
durable completion and interrupts admitted fibers, then waits for their
`FiberSet` to empty before allowing the enclosing Layer scope to release
handler and application resources. Admission
denials use a shared parked promise with no delivery-specific closure, and
network shutdown must release all upstream callback references. Tests assert
that tracked and parked per-delivery counts are zero after release.

Use an Effect service/Layer rather than a singleton or nested application
runtime so application services are shared and scoped. Use the SDK Network contract rather
than implementing provider messages. Use a wrapper logger that emits only
allowlisted metadata and sanitized messages because upstream network errors can
contain connection details.

### Providers compose outside core

`@effect-resonate/core` owns the provider-neutral service contract and gate; it
does not export Postgres symbols or depend on provider packages. The separate
`@effect-resonate/network-postgres` package validates redacted configuration,
wraps `@resonatehq/sdk/postgres`, owns `pg`, and maps provider acquisition
failures to sanitized errors. A future provider plugs into the same core Layer
without modifying core.

`ResonateNetwork.make` is the provider-author seam: it accepts an SDK-compatible
network factory plus sanitized acquisition-error mapping and returns the Layer
that provides the `ResonateNetwork` service required by `ResonateClient.layer`.
This is the only exported core surface allowed to mention the SDK network shape,
and it derives that shape from the public async `Resonate` constructor type
rather than an unexported deep SDK module. Workflow, step, context, and client
signatures remain SDK-free.

Alternatives rejected: putting the first provider in core makes one backend
structurally special and contaminates core's dependency graph; reimplementing
the SQL transport would duplicate upstream lease, queue, and timeout semantics;
installing schema at runtime violates operator ownership.

### Reusable conformance scenarios are separate from runtime composition

Use Vitest plus `@effect/vitest` for package tests and an injectable protocol
`Network` fake for deterministic core contract/lifecycle cases. A private
`@effect-resonate/testing` workspace package owns black-box scenario functions
parameterized by a network/runtime harness. Provider unit tests stay beside the
provider. `apps/postgres-e2e` is the concrete composition root: it wires core,
the Postgres provider, shared scenarios, worker processes, SQL fixtures, and
IntegreSQL. This prevents test infrastructure from leaking into either
production package and lets future network apps run the same suite.

IntegreSQL initializes a template keyed by the complete fixture hash and leases
a fresh database per test. Since `pg_cron` exists in only one database per
cluster, the app schedules timeout processing into each leased database with
`cron.schedule_in_database(...)`, then unschedules it and closes every
connection before returning the lease.

## Implementation units

### U1 — Public definitions, durable values, contexts, and errors

Files: `packages/core/src/DurableValue.ts`,
`packages/core/src/CoreExecutionError.ts`, `packages/core/src/Step.ts`,
`packages/core/src/StepContext.ts`, `packages/core/src/Workflow.ts`,
`packages/core/src/WorkflowContext.ts`,
`packages/core/src/ResonateFunctions.ts`, and corresponding
colocated `packages/core/src/**/__tests__/*.unit.ts`, `*.integration.ts`, and
`*.types.ts` files; establish the core test
toolchain in `packages/core/package.json`, package Vitest configuration if
needed, and `pnpm-lock.yaml`.

Dependencies: installed Effect `Schema`, `Result`, `Context`, `Layer`, and type utilities.
No SDK types appear in workflow, step, context, or client signatures; the
provider-author `ResonateNetwork` SPI is isolated in U4. Select compatible
`vitest` and `@effect/vitest` development versions here so PR1's runtime and
type tests execute through the package and root test scripts; later units reuse
those pinned versions.

Approach: define the readonly JSON type/schema, namespaced tagged errors for
wrapper-owned contracts, one thin `ResonateSdkError` that retains the original
cause plus allowlisted SDK metadata, opaque inert
contract definitions, per-contract handler Layers, a first-class RPC-style
definition group, required positive literal versions, service-free workflow and step codec constraints, typed
invocation options, and context service surfaces. Keep definition and group
construction total; defer runtime identity and duplicate validation to client
Layer acquisition in U4.
Keep raw payloads, schema AST/issues, causes/stacks, and connection strings out
of wrapper-owned contract errors, durable values, safe error projections, and
default logs. The in-memory `ResonateSdkError.cause` is the deliberate exception;
callers must opt in to inspecting or logging it.

Tests: accept empty arrays/objects and all JSON primitives at encoded boundaries;
reject `undefined`, non-finite numbers, bigint, functions, symbols, dates/classes,
sparse arrays, undefined properties, and cycles. Type tests reject
service-dependent durable codecs, missing/invalid versions, mismatched handler
inputs/results/errors, missing handler services, wrong invocation inputs, and
domain-error confusion; positive tests infer handler Layer requirements,
run/rpc/results, and metadata.

Verification: `pnpm --filter @effect-resonate/core typecheck` checks production
sources, while `pnpm --filter @effect-resonate/core test:types` demonstrates the
public definitions and negative cases without importing Resonate internals.

### U2 — Versioned outcome protocol and boundary codecs

Files: `packages/core/src/internal/DurableOutcome.ts`,
`packages/core/src/internal/SchemaBoundary.ts`,
`packages/core/src/internal/Redaction.ts`, and focused unit tests.

Dependencies: U1.

Approach: implement constructors/decoders for the three fixed outcomes, exact
definition comparison, branch exclusivity, workflow and step codec
encoding/decoding, final JSON validation, sanitized issue summaries, and mappings to
`Result`/`CoreExecutionError`. Decode identity before branch payload.

Tests: table-drive unknown versions/tags/kinds, invalid versions, wrong identity,
missing/extra/mutually exclusive payloads, malformed JSON, malformed schema
input, workflow encode/decode failures, and success/failure round trips. Inject
sentinel secrets in payloads/issues/causes and assert returned errors and default
logs omit them.

Verification: every accepted envelope round-trips; every malformed envelope
fails with a stable wrapper tag and never reaches a domain decoder incorrectly.

### U3 — SDK adapters and durable context facades

Files: `packages/core/src/internal/StepAdapter.ts`,
`packages/core/src/internal/WorkflowAdapter.ts`,
`packages/core/src/internal/WorkflowContextImpl.ts`,
`packages/core/src/internal/AdapterSupervisor.ts`, and SDK-backed contract tests.

Dependencies: U1–U2 and installed `@resonatehq/sdk/async` 0.11.5 APIs.

Approach: validate delivered tuples as `unknown`; construct immutable metadata;
install a scoped internal `AdapterSupervisor` service in the client Layer;
admit steps atomically with an Effect `Semaphore`; and capture the acquired
handler/application context for SDK callbacks so each step inherits shared
services plus a per-invocation `StepContext`. Compose schema decoding,
execution, Exit classification,
and durable encoding as one Effect program, crossing to Promise exactly once at
the SDK callback. Fence abandoned fibers and run interruption requests in a
second scoped `FiberSet`. Keep workflows owned by the Resonate async engine
rather than modeling their promises as Effect fibers. Delegate
workflow operations eagerly to SDK Context with exact versions and explicit
retry/timeout options. Decode external promise values with the supplied schema.
Carry non-domain durable rejection through a separate JSON record rather than a
thrown tagged `Error`, because the SDK error codec does not retain custom error
fields; reconstruct the public `ExecutionRejected` at the wrapper boundary.

Tests: success, checked failure, defect, interruption, composite Cause,
malformed input/output, repeat adapter execution, explicit Effect retry,
explicit/default Resonate retry, timeout, cancellation of local waiting, stable
metadata, typed rpc, durable sleep/promise, replay-stable date/random, and
halfway failures during create/settle. Deliberately await an ordinary timer then
call a durable operation and assert the SDK closed-context guard rejects it.
Keep supervisor, step-adapter, workflow-context, workflow-adapter, and SDK
contract suites separate. The supervisor suite covers heterogeneous results,
service-context inheritance, admission closure, abandonment, drain ordering,
uninterruptible cleanup, idempotence, and exactly-once finalization.

Verification: checked failures are resolved durable values; wrapper-owned
contract failures use specific tagged errors, SDK failures retain Resonate
identity through the thin `ResonateSdkError`, and replay uses the same IDs/versions.

### U4 — Registry and scoped `ResonateClient`

Files: `packages/core/src/ResonateNetwork.ts`,
`packages/core/src/ResonateClient.ts`,
`packages/core/src/internal/DefinitionRegistry.ts`,
`packages/core/src/internal/GatedNetwork.ts`,
`packages/core/src/internal/ClientLive.ts`, and lifecycle/client tests.

Dependencies: U1–U3, Effect Layer/Scope/runtime capture, and the public SDK
async `Resonate` constructor contract. Infer the compatible network option from
that public constructor; do not deep-import the SDK's unexported `Network` type.

Approach: validate/freeze the complete `ResonateFunctions` group; reject
invalid dynamic identities, non-increasing dynamic evolution lineage, and
duplicate exact pairs;
implement `ResonateNetwork.make` around a provider-supplied compatible network
factory and sanitized error mapper; require the group's handler services and
their transitive application Layers through normal Layer composition; capture
the acquired context once for SDK callbacks;
capture one network init promise; buffer delivery until all exact registrations
succeed; expose Effect `run`, input-free `attach`, and external-promise
resolve/reject/cancel operations; preserve execution ID and
`activationMayHaveCommitted` on dispatch failure; wait interruptibly without
canceling durable state; and wrap SDK failures once without reclassifying them,
preserving Resonate code/type/href/retriability/server status. Resolve values are encoded through a
caller-supplied service-free schema; reject/cancel diagnostics use the durable
JSON contract. Implement ordered, idempotent close with scoped step-fiber
admission, a grace-period drain bound, abandon fencing, `FiberSet` interruption, single-owner
`Resonate.stop()` (which stops the heartbeat and network), admitted-promise
settlement, after which ordinary Layer release disposes handler/application
resources. Use a separate once-only network finalizer
only for partial acquisition before the Resonate instance assumes ownership.

Tests: duplicate definitions and multiple versions; readiness failures at each
acquisition seam; first-writer-wins same/different input; workflow/version
identity conflict; response-loss recovery; attach not-found; interruption after
dispatch; no delivery before ready; normal drain, expired drain, late completion,
repeated release, finalizer ordering, and zero per-delivery references after
release. External-promise tests cover encoded resolution, rejection,
cancellation, malformed data, duplicate/late settlement, and timeout races.
Inject sentinel provider errors/logs to prove core redaction without naming a
concrete provider. Type tests prove the client Layer retains a
`ResonateNetwork` requirement until ordinary `Layer.provide` composition
supplies one.

Verification: the Layer is unavailable until fully ready, partial acquisition
leaves no resource active, and shutdown creates no durable settlement for
abandoned work.

### U5 — Shared provider-conformance package

Files: `packages/testing/package.json`, `packages/testing/tsconfig.json`,
`packages/testing/src/NetworkHarness.ts`,
`packages/testing/src/NetworkConformance.ts`,
`packages/testing/src/RecoveryScenarios.ts`, and focused self-tests using the
deterministic core test network.

Dependencies: U1–U4 and the test toolchain pinned in U1. Mark
`@effect-resonate/testing` private initially; it depends on core but no concrete
provider or database driver.

Approach: define black-box scenario functions around a small harness contract
that supplies a network Layer, isolated durable state, worker lifecycle/fault
controls, and bounded observation. Move portable assertions for completion,
duplicate activation, replay, failure classification, cancellation, timeout,
and lifecycle into this package. Keep provider setup, SQL, and implementation
details outside the scenario API.

Tests: run fast scenarios against the deterministic SDK-backed network;
self-test harness setup/cleanup failure, empty isolated state, repeated worker
start/stop, bounded polling, and sanitized diagnostics. The deliberately invalid
non-durable await remains a shared SDK-backed contract scenario.

Verification: a provider can import one public conformance entrypoint, supply
only the harness contract, and run the portable portions of SC3, SC4, SC6, SC7,
SC9, and SC11 without the shared package importing that provider. SC1/SC8 remain
core type/protocol tests; SC2 and the Postgres-specific portions of SC3–SC7 run
in U7; SC10 is proved by U6/U8 packaging checks.

### U6 — Postgres network provider package

Files: `packages/network-postgres/package.json`,
`packages/network-postgres/tsconfig.json`,
`packages/network-postgres/src/PostgresNetwork.ts`,
`packages/network-postgres/src/index.ts`, provider unit tests, `pnpm-lock.yaml`,
and workspace configuration.

Dependencies: U4; peer-depend on `@effect-resonate/core`, Effect, Resonate, and
`pg`; install them plus `@types/pg` for development. Match the SDK 0.11.5 `pg`
range. Core's manifest and sources remain unchanged by provider dependencies.

Approach: validate redacted provider configuration, construct the official
`@resonatehq/sdk/postgres` Network through `ResonateNetwork.make`, and supply
sanitized provider-error mapping. Do not initialize or stop the SDK network in
parallel with core; the generic gate owns that lifecycle. Do not install schema
or query Resonate's private tables in production code.

Tests: malformed/empty config, missing `pg`, failed connection, missing schema,
init/stop race, idempotent stop, and redacted upstream logs/errors. Contract
types prove the Layer composes with core without provider branches in core.

Verification: the provider builds and packs independently; core builds, tests,
and packs with no `Postgres`, `network-postgres`, or `pg` reference.

### U7 — IntegreSQL Postgres runtime evaluation app

Files: `apps/postgres-e2e/package.json` (private workspace package
`@effect-resonate/postgres-e2e`), `apps/postgres-e2e/tsconfig.json`,
`apps/postgres-e2e/src/harness.ts`, `apps/postgres-e2e/src/worker.ts`,
`apps/postgres-e2e/src/__tests__/postgres.e2e.ts`,
`apps/postgres-e2e/fixtures/resonate.sql`,
`apps/postgres-e2e/fixtures/UPSTREAM.md`, container/CI configuration, and root
scripts plus `pnpm-workspace.yaml` for the `apps/*` workspace boundary.

Dependencies: U5–U6, `@devoxa/integresql-client`, `pg`, pinned IntegreSQL
server `ghcr.io/allaboutapps/integresql:v1.1.0` by immutable digest, and a
digest-pinned Postgres 16+ image with `pg_cron`.

Approach: compose core, the Postgres provider, and shared scenarios. Hash the
vendored Resonate SQL, its upstream revision, Postgres image/extension config,
and business fixture; initialize/finalize one IntegreSQL template per runner;
close all template clients before finalization; and lease a fresh database per
test. Register a uniquely named `cron.schedule_in_database(...)` timeout job for
each lease from the cluster's cron control database, then unschedule it, stop all
workers/pools/listeners, and release the database. Use test-only barriers at the
side-effect/checkpoint, activation-response, adapter-block, and process-stop
seams.

Tests: W1–W9 and W11–W15 exactly as specified. W5 requires at least two adapter
entries with the same step ID and one unique business row. W8 separately covers
startup and post-activation outages. W13/W14 distinguish settled drain from
abandonment and prove lease recovery. W15 permits the late external write while
rejecting late checkpoint replacement. Add a version-deployment recovery case:
checkpoint a V1 step, stop its worker, deploy the retained V1 definitions beside
V2 definitions, resume the original execution on its exact workflow version,
and prove a new execution selects V2. Also restart an intentionally mixed-version
workflow after its V1 child checkpoint and prove its explicit compatibility
mapping supplies valid input to its V2 child. All waits poll public outcomes, have
deadlines, and print only sanitized IDs/states.

Verification: one documented
`pnpm --filter @effect-resonate/postgres-e2e test` command starts or connects to
IntegreSQL/Postgres, initializes or reuses the hashed template, leases isolated
databases, runs the bounded suite, and releases everything it owns.

### U8 — Documentation, packed consumers, and full acceptance gate

Files: `packages/core/README.md`, `packages/network-postgres/README.md`,
`packages/core/src/index.ts`, `tests/package.test.mjs`, root/package scripts, and
minimal packed-consumer fixtures generated in temporary directories.

Dependencies: U1–U7.

Approach: document the generic core composition first, then provider selection,
global ID/first-writer semantics, version deployment, durable-await discipline,
failure/retry/timeout/shutdown contracts, stable step idempotency key, and attach
recovery. Pack core and the provider independently. Extend ordinary checks with
unit, contract, conformance-self-test, and packaging tests; keep the IntegreSQL
runtime evaluation explicit.

Tests: compile every public core/provider entrypoint; run a core-only consumer
without `pg`; run a second consumer with the Postgres provider and `pg`; check
peer metadata, private test/app packages, absence of source-only imports, and
that neither production artifact bundles its peers or test infrastructure.

Verification: `pnpm check && pnpm test` passes without integration services, and
the explicit Postgres app command passes when its prerequisites are present.

## Pull request sequence

Land this as a four-PR stack, with the entire stack required before the feature
is publishable:

1. **Core types and durable protocol:** U1–U2.
2. **Core async runtime and lifecycle:** U3–U4.
3. **Reusable conformance plus Postgres provider:** U5–U6.
4. **IntegreSQL runtime evaluation and packaging gate:** U7–U8.

Each layer builds and tests independently. Later PRs may add tests against
earlier production code, but no earlier PR may add a Postgres import or temporary
provider branch to core merely to make the stack executable.

## Risks and mitigations

- **Constructor-started network work can escape acquisition.** The memoized gate
  owns readiness, buffering, stop-after-init, and failure tests at every seam.
- **Shutdown races can checkpoint interruption as durable rejection.** Close
  admission first and fence abandoned tokens before network/runtime teardown;
  W13/W14 assert both sides of the drain bound.
- **SDK errors are not a stable domain protocol.** Inspect durable settlement
  state where available, wrap failures once with their original cause and
  allowlisted upstream metadata, retain execution ID/unknown-commit status, and
  keep all `E` reconstruction envelope-based.
- **First-writer-wins hides conflicting root input.** The wrapper cannot compare
  an already-persisted SDK input through the public handle, so documentation and
  tests promise the original result, not input equality detection. Definition
  identity remains detectable in the final owned envelope.
- **Fault tests can become timing tests.** Use barriers, unique constraints,
  worker processes, observable handles, and bounded polling rather than sleeps
  as assertions.
- **IntegreSQL templates or cron jobs can leak across tests.** Hash every fixture
  and runtime pin, lease one database per test, give cron jobs run-scoped names,
  unschedule before releasing the lease, close every connection, and never query
  private tables from production code.
- **Error diagnostics can leak secrets through upstream messages.** Allowlist
  public fields, redact logging at the injected SDK logger, and retain sentinel
  acceptance tests across every boundary.

## Open questions

### Resolved by installed-source inspection

- Target SDK is exactly 0.11.5; async calls return handles at roots and eager
  durable promises in workflow contexts, with `Never` as the retry default.
- Exact version options are required because omitted/zero version lookup can
  select latest.
- Effect 4.0.0-rc.115 provides scoped `FiberSet` supervision plus
  `FiberSet.runtimePromise` / `Effect.runPromiseWith` callback bridges,
  `Context.Service`, `Layer.effect`, `Semaphore`, schema service requirement types, and inspectable
  `Cause.reasons` needed by the design.
- The official Postgres provider lazily imports `pg`, exposes `init()`/`stop()`,
  and uses one pool plus a dedicated LISTEN client and fallback timer.
- IntegreSQL's supported TypeScript client is
  `@devoxa/integresql-client` 2.1.2; the latest official server release is 1.1.0.
  Its template lifecycle requires all database connections to close before
  finalization and leases isolated databases from a fixture hash.
- `pg_cron` is installed in one control database per cluster and supports
  `cron.schedule_in_database(...)`, so each IntegreSQL lease can receive and
  later remove its own timeout-processing job.

### Implementation-time factual unknowns

- Select and record the exact `resonate-pg` revision compatible with SDK 0.11.5
  plus immutable digests for IntegreSQL 1.1.0 and the Postgres 16+ `pg_cron`
  image after running the U7 compatibility probe. These are fixture pins, not
  product/API decisions.
- Confirm compatible `vitest` and `@effect/vitest` versions against the pinned
  Effect RC when U1 adds the test toolchain; if the adapter package has no
  compatible release, use Vitest directly with `Effect.runPromise` while keeping
  the same test boundaries.
- Choose the smallest internal deterministic failpoint/barrier representation
  during U7. It must remain test-only and satisfy the named observable seams;
  no production hook or semantics are left open.

## Handoff checklist

- Every SC1–SC11 requirement maps to a unit and observable test.
- W1–W15 and S1–S9/L1–L3/C1–C5 remain enforceable by the units above.
- Workflows contain only Resonate durable orchestration; Effect execution and
  resource scopes remain inside registered adapters and the owning Layer.
- Registration, root calls, and child calls always carry exact name/version.
- Replay, retries, duplicate activation, cancellation, timeout, partial failure,
  crash windows, and bounded shutdown have explicit behavior and tests.
- Core remains network-neutral and bundler-free. The Postgres provider is a
  separate distribution/dependency boundary, owns `pg`, and composes through
  core without a reverse dependency.
- Shared conformance code is private and provider-neutral; the IntegreSQL app is
  the only Postgres runtime composition root and no production tarball ships its
  fixtures or fault harness.
- Remaining unknowns are factual fixture/tool compatibility checks, not product
  or durability decisions.
