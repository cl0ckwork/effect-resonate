# Resonate API parity with Effect ergonomics

> Superseded where syntax differs by
> [`2026-09-20-001-thin-wrapper-simplification-spec.md`](./2026-09-20-001-thin-wrapper-simplification-spec.md),
> which restores upstream positional parameters and plain function-group values.

## Objective

Make the installed `@resonatehq/sdk/async` API the primary public vocabulary and
documentation source for `@effect-resonate/core`. The wrapper preserves Resonate
method names, namespaces, return semantics, records, options, and durable
behavior. It changes only the boundaries where Effect adds concrete value:
Promise-returning operations and synchronous operations that may throw become
`Effect`, acquisition/release becomes a scoped `Layer`, and SDK failures enter
one thin typed error channel.

Schema-first `Step`, `Workflow`, evolution, and handler Layers remain optional
typed ergonomics built on the parity surface. They do not replace, hide, or make
an upstream Resonate capability unreachable.

## Success criteria

1. Every public method on the installed async `Resonate` client, its public
   `promises` and `schedules` subclients, returned handles, and async `Context`
   has either the same public name/path or one explicitly documented Effect
   lifecycle substitution.
2. A user can start from the upstream async-engine documentation and translate
   calls mechanically: at the client boundary `await` becomes `yield*`, thrown
   failures become typed failures, and positional arguments become the
   repository's named request objects. Workflow Context calls retain upstream
   positional signatures and eager `DurablePromise` behavior.
3. `run`, `rpc`, and `get` return Effect-native handles; they do not silently
   wait for `.result()`.
4. Raw upstream records and option types are imported or inferred from public
   SDK exports instead of copied into wrapper-owned approximations.
5. Typed contract overloads validate only the values whose contract the caller
   explicitly supplied. Raw parity methods remain available.
6. Resonate remains the owner of durable execution, first-writer-wins behavior,
   retries, schedules, promise state, and context control flow.

## Scope and API mapping

The target is the installed async engine (`@resonatehq/sdk/async` 0.11.5), not
generator-only `beginRun` / `beginRpc` methods.

| Upstream surface | Effect surface |
| --- | --- |
| `new Resonate(options)` | scoped `ResonateClient.layer(options)` |
| `register` | `ResonateClient.register` plus optional definition-group preregistration |
| `setDependency` | `ResonateClient.setDependency`; Effect Layers remain preferred for Effect code |
| `run`, `rpc`, `get`, `schedule`, `options` | same names and semantics |
| `stop` | same idempotent operation; normal applications rely on Layer release |
| `handle.result()`, `handle.done()` | same methods returning `Effect` |
| `scheduleHandle.delete()` | same method returning `Effect` |
| `promises.get/create/createWithTask/resolve/reject/cancel/registerCallback/registerListener` | same `promises.*` namespace |
| `schedules.get/create/delete` | same `schedules.*` namespace |
| context `getDependency/run/rpc/detached/promise/sleep/options/panic/assert` | same names and eager durable semantics |
| context `date.now`, `math.random` | same namespaces and semantics |

Generator-only methods shown in the general SDK guide are not fabricated. The
wrapper documents that async `run` / `rpc` already return handles and async
context operations are eager.

Named request objects are the sole systematic syntax difference, following the
repository API rule. Request fields retain upstream names wherever possible.

The network instance remains an Effect dependency and is the sole constructor
option core excludes. Every other async-constructor option is accepted and
forwarded unchanged rather than curated by the wrapper. Resonate's upstream
precedence remains authoritative: an injected network owns transport behavior,
so connection fields may have no effect when that network is present.

The wrapper deliberately corrects one installed SDK 0.11.5 binding defect:
`ResonateFunc.options` is rebound to its owning client because the SDK returns
that method unbound. Its accepted options and returned value remain upstream
types; no new semantics are introduced.

## Walkthroughs

| ID | Story | Path | Observable result |
| --- | --- | --- | --- |
| W1 | Application invokes a registered workflow | `run` → handle → `result` | Both boundaries are Effects; result uses the supplied typed contract when present |
| W2 | Client invokes a remote workflow | `rpc` → handle → `done/result` | Targeting and handle behavior match async Resonate |
| W3 | Webhook creates and settles a latent promise | `promises.create` → `promises.resolve` | Returned upstream promise records retain first-writer-wins state |
| W4 | Operator creates and deletes a recurring schedule | `schedule` or `schedules.create` → inspect → delete | Upstream schedule record/handle semantics are preserved |
| W5 | Workflow fans out and spawns an independent root | context `run` + `rpc` + `detached` | Calls start eagerly and retain upstream durable IDs |
| W6 | SDK call throws after a request may have committed | Promise rejection → `ResonateSdkError` | Original cause and commit uncertainty remain inspectable |
| W7 | Scope closes without an explicit stop | Layer release → drain → SDK `stop` | Resources stop once; explicit prior `stop` remains idempotent |
| W8 | Caller uses raw SDK registration/records | `register` or a raw namespaced method | No schema protocol or wrapper-owned record shape is imposed |

## Invariants

### Safety

- S1: The wrapper never changes a Resonate operation from handle-returning to
  result-returning under the same method name. Enforced by public types and W1/W2.
- S2: Promise and schedule state transitions are delegated exactly once to the
  SDK; the wrapper does not emulate them. Enforced at the client adapter and
  exercised by W3/W4.
- S3: Async-context operations remain eager. No Effect runtime is inserted
  inside a workflow. Enforced by the context facade and exercised by W5.
- S4: SDK errors retain the original cause and operation/commit metadata without
  leaking it to default logs. Enforced by the SDK boundary and exercised by W6.
- S5: Layer release and explicit `stop` cannot double-stop the SDK/network.
  Enforced by the lifecycle gate and exercised by W7.

### Liveness

- L1: An admitted Effect step either completes during the drain interval or is
  fenced and interrupted before SDK shutdown.
- L2: A pending Resonate execution remains retrievable by ID after local Effect
  waiting is interrupted.

### Consistency

- C1: Public method names, namespace paths, option fields, return records, and
  handle semantics track the installed public async SDK.
- C2: Typed overloads are additive: supplying a definition/schema adds boundary
  validation without removing the raw parity operation.
- C3: The upstream SDK remains a peer dependency and the wrapper does not copy
  private protocol types or deep-import internal modules.
- C4: An SDK upgrade must pass compile-time key-parity assertions for the client,
  promise and schedule namespaces, returned handles, registered functions, and
  async Context before release. New upstream capabilities require an explicit
  mapping or documented lifecycle substitution rather than silent omission.

## Protocol

```text
Effect caller
  -> ResonateClient.<upstream method name>(named request)
  -> scoped async Resonate instance
  -> upstream Promise
  -> Effect success: upstream record / Effect-native handle
     Effect failure: thin ResonateSdkError with original cause

Effect-native handle
  -> .done() / .result()
  -> upstream handle Promise
  -> Effect success or typed contract decode

Async workflow
  -> WorkflowContext.<upstream context method name>
  -> upstream eager DurablePromise
  -> no Effect runtime crossing inside the workflow
```

## Failure taxonomy and trust boundaries

- SDK/network failures become only `ResonateSdkError`; upstream identity and
  request-commit uncertainty are preserved.
- Explicit `stop()` reports `ResonateSdkError`; failure of automatic scoped
  release is promoted to a defect so cleanup failure cannot look successful.
- Typed definition/schema overloads may additionally fail with the existing
  wrapper-owned input, protocol, or definition errors.
- Raw `promises.*` and `schedules.*` operations accept and return upstream public
  wire/record types without wrapper decoding.
- Typed promise helpers encode/decode only when the caller explicitly supplies
  a schema.
- Registration of raw SDK functions is an explicit escape hatch and does not
  claim Effect step supervision or schema validation.

## Resolved API-shape decision

Schema-first operations remain overloads of the Resonate-named methods rather
than moving behind a wrapper-owned `typed` namespace. Raw and typed `run` / `rpc`
overloads both return the same Effect-native handle shape; a typed overload only
adds input encoding and result decoding to that handle. Raw and typed promise
settlement overloads are discriminated by the presence of a schema. This keeps
the upstream method path canonical while making contract validation visibly
additive.
