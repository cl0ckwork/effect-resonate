# U6: Postgres network provider

Status: proposed for the U6 stacked PR. Base: U5 commit `8b74ae2`.

## Objective and success criteria

Publish `@effect-resonate/network-postgres` as a separate, bundler-free ESM package. Its Layer supplies core's public `ResonateNetwork` service by constructing the official SDK 0.11.5 `PostgresNetwork`. U6 proves configuration, ownership, error redaction, and packaging without claiming Postgres protocol conformance.

- **R1 Configuration:** preserve the official SDK configuration semantics. Before constructing a network, reject a blank `connectionString` and a `tickMs` that is not a positive, finite timer interval. Errors identify the field without including its value. Let `pg` and the SDK interpret valid-looking connection strings, `group`, and `pid`.
- **R2 Composition:** one client Layer acquisition requests one fresh network. The provider does not call `init()` or `stop()`; core remains the sole lifecycle owner.
- **R3 Error boundary:** constructor and network method failures exposed to core and its default logs contain safe operation data, not connection strings, driver messages, raw stacks, or other raw values. An optional caller-supplied SDK logger is passed through unchanged and receives SDK diagnostics.
- **R4 Packaging:** the provider depends on core's public subpath and peers on core, Effect, Resonate, and `pg`; core has no provider or `pg` import. Its packed ESM and declarations resolve independently.
- **R5 Verification:** focused unit and type tests prove R1–R4. U7 runs U5's shared scenarios through an IntegreSQL-backed Postgres composition.

## Scope and ownership

The public input follows the official `PostgresNetworkConfig` fields. The provider snapshots those fields when constructing its Layer, checks only the two local hazards in R1, and creates a fresh official network on each `make`. An optional logger is passed to the SDK by reference, so the caller's logger receives the original SDK fields and messages. The provider does not normalize or parse the connection string or invent restrictions for `group` and `pid`. Core wraps the network in `NetworkGate`, waits for readiness, and calls `Resonate.stop()` on release. The operator owns the `resonate` schema and `pg_cron`; the SDK owns pooling, SQL, listen/notify, polling, lease behavior, and protocol messages.

No SQL, migration, custom pool, retry policy, test container, or conformance adapter belongs in U6. A missing `pg` module, unavailable database, or missing schema is detected during core's client acquisition via network initialization. They are runtime failures, not configuration parse failures.

## Walkthroughs

| ID | Story and path | Observable result | Invariants |
| --- | --- | --- | --- |
| W1 | App supplies a valid URL → provider Layer → client asks `make` → SDK constructs network → core initializes and later stops it | One usable network; exactly one core-owned shutdown | S2, C1 |
| W2 | App supplies `postgres://user:secret@host/db` with `tickMs: 0` → construct Layer → acquire client | A safe configuration failure identifies `tickMs`; no network is constructed or secret exposed | S1, S3 |
| W2a | App supplies a nonblank connection string with driver-specific URL options → construct Layer → initialize | The provider passes it unchanged to the SDK; `pg` decides whether it can connect | S1, S2 |
| W3 | URL is valid but `pg` is missing, credentials fail, or schema is absent → `init` rejects | Client acquisition fails with a sanitized SDK boundary error; core's partial-acquisition finalizer stops the network | S2, S3, L1 |
| W4 | Core releases while SDK initialization is pending → gate waits for init settlement → stop | The network is stopped once after initialization settles; no usable client escapes failed acquisition | S2, C1 |
| W5 | A database operation fails after acquisition → provider method boundary → core SDK error | Caller gets a safe cause and operation label; no raw driver diagnostics enter core's default logs | S3 |
| W5a | SDK emits a listen error through an optional caller logger → app logger | App logger receives the SDK's original event and error fields | S3 |
| W6 | App acquires two clients from the same provider Layer → `make` twice | Distinct network instances; neither client closes the other's network | C1 |

## Invariants and enforcement

- **S1 Known local configuration hazards do not reach the SDK.** Layer construction snapshots the input and checks blank connection strings and invalid timer intervals; otherwise it passes the SDK fields through unchanged. Exercised by W2 and W2a.
- **S2 The provider never starts or stops its own network.** Core's `ClientLive`/`NetworkGate` own initialization, partial-acquisition cleanup, and release. Exercised by W1, W3, W4.
- **S3 Provider-owned error surfaces and core's default logs never include secrets or raw driver text.** Boundary mapping creates fresh safe errors. A caller-supplied SDK logger receives raw SDK diagnostics by design; its output is caller-owned. Exercised by W2, W3, W5, W5a.
- **L1 Failed acquisition eventually releases its already-created network after pending initialization settles.** Core finalization enforces this subject to upstream `init()` settling. Exercised by W3–W4.
- **C1 Every successful client acquisition owns a distinct SDK network, and release applies to that instance only.** Provider factory and core scope enforce this. Exercised by W1, W4, W6.

The main counterexamples are (a) retaining caller-owned mutable configuration, which changes later acquisitions unexpectedly; (b) constructing one SDK instance at Layer creation and reusing it across clients; (c) rejecting a connection form that `pg` supports; and (d) returning a safe top-level error while retaining a raw `cause`. The design excludes each. A caller who supplies an SDK logger explicitly opts into its original diagnostic fields, which can contain `err.message`.

## Protocol and failure taxonomy

```mermaid
flowchart LR
  Config[Caller config] --> Check[Snapshot and minimal guards]
  Check -->|invalid| Invalid[Safe config error]
  Check -->|valid| Factory[ResonateNetwork factory]
  Factory --> SDK[Official PostgresNetwork]
  SDK --> Safe[Sanitizing network boundary]
  Safe --> Gate[Core NetworkGate]
  Gate --> Client[Async Resonate client]
  Client --> DB[(Postgres)]
  Client -->|release| Gate
  Gate -->|stop once| Safe
```

Minimal configuration failure flows through core's existing `ResonateSdkError` acquisition channel with a safe static cause. Construction, initialization, send, and stop failures also become safe causes for core's `ResonateSdkError`; core retains its operation and `requestMayHaveCommitted` semantics. For `send`, an error does **not** prove no commit: callers use stable IDs and lookup as documented by core. Cancellation and drain behavior remain core-owned. This boundary does not infer retryability or classify PostgreSQL SQLSTATE into domain failures. A hang in upstream init/stop is an upstream/runtime timeout concern; U7 tests operational recovery.

## Decisions and deferred verification

Keep the SDK's accepted connection-string and address forms. Require a nonblank connection string because the provider requires an explicit database target; accept a finite positive integer `tickMs` no greater than Node's maximum timer delay. Leave all defaults to the SDK. Do not copy credentials into error fields.

No product or durability question blocks planning. During implementation, verify the exact installed Effect Schema parser signatures and test-runner mocking behavior against local packages. U7 must prove actual connection failure, missing schema, runtime recovery, and all declared U5 capabilities against Postgres; U6 unit mocks cannot establish those database semantics.

Sources: `packages/core/src/ResonateNetwork.ts`, `packages/core/src/internal/ClientLive.ts`, `packages/core/src/internal/NetworkGate.ts`, `packages/testing/src/NetworkHarness.ts`, `docs/PACKAGING.md`, and `docs/plans/2026-09-15-001-feat-core-async-postgres-plan.md` (U5–U7). SDK contract checked against installed `@resonatehq/sdk` 0.11.5 `dist/src/network/postgres.{d.ts,js}`.
