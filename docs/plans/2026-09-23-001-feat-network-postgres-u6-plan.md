# U6 implementation plan: Postgres network Layer

Source: `docs/specs/2026-09-23-001-network-postgres-u6-spec.md`. Stack base: U5 `8b74ae2`; branch `luke/feature/network-postgres-u6`.

## Summary and requirements trace

Add one independently packaged provider that supplies core's `ResonateNetwork` factory with a fresh, sanitized official SDK `PostgresNetwork`. R1 maps to U6.1, R2–R3 to U6.2, R4 to U6.3, and R5 to U6.1–U6.3. U7 owns the database-backed run of U5's reusable suite.

Walkthroughs W1–W6 and invariants S1–S3, L1, C1 from the spec are the acceptance checklist. The core ownership boundary is already implemented: `ClientLive` requests one network per acquisition, `NetworkGate` waits for init and serializes stop, and `Resonate.stop()` owns normal shutdown. U6 must not add provider branches to core.

The service retains a factory because a Layer may be shared while each client acquisition needs its own network. Core's module-level `ResonateNetwork.make({ factory })` helper is a second factory layer: it captures Effect requirements for a deferred factory, but U6's provider has none. Remove that helper and its `MakeOptions` type. Use `Layer.succeed` for U6; a future provider needing services can build its service with `Layer.effect` and capture those services explicitly. `CompatibleNetwork` currently aliases the SDK's `Network` type without adding behavior or a portability guarantee. Use the SDK `Network` type directly and remove that alias from core and its type tests.

## Key decisions

| Decision | Alternatives considered | Evidence and reason |
| --- | --- | --- |
| Use a factory backed by the official `PostgresNetwork` | Custom `pg` transport or prestarted pool | SDK 0.11.5 constructor is inert and its `init`/`stop` already own pool and listener. Core expects a fresh uninitialized network. |
| Keep one `ResonateNetwork` factory service, typed with SDK `Network` | Inject one SDK instance directly or add a provider-neutral wrapper interface | A shared Layer can serve multiple client acquisitions, so one injected instance would share lifecycle. The `CompatibleNetwork` alias is exactly the SDK type today and adds no useful contract. |
| Remove the module-level `ResonateNetwork.make` helper | Retain a generic `R`-capturing helper | It hides a Layer build and a second deferred acquisition behind the same name. U6 requires no Effect services; ordinary `Layer.succeed` expresses its wiring directly. The current test fixture with an `R` requirement can use `Layer.effect`. |
| Project config and guard only concrete local hazards | Parse URL syntax or constrain `group`/`pid` | SDK 0.11.5 stores config without validation; `pg` resolves the connection later. URL parsing could reject SDK-compatible inputs. A blank connection string is not a useful explicit database target, while invalid `tickMs` can cause timer churn or overflow. |
| Sanitize by wrapping official network operations | Return the raw SDK instance or only redact error display | The SDK async client logs `init` rejections using `err.message`; `PostgresNetwork` can log raw database messages through its optional logger. A safe top-level error with raw `cause` would still leak. |
| Pass the optional SDK `logger` through unchanged | Wrap or omit the override | A caller who supplies the SDK logger owns its diagnostic output. The SDK can include raw `err.message` in listen/drain logs; the provider documents this while keeping returned network errors sanitized. |

## Pseudocode and dataflow

```ts
// packages/network-postgres/src/PostgresNetwork.ts — illustrative API
// Small Schema checks for the two provider-owned hazards. They do not
// normalize connection strings or restrict SDK group/pid address forms.
const ConnectionString = Schema.String.check(Schema.isPattern(/\S/))
const PollInterval = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(2_147_483_647)
)

// Snapshot SDK fields, including the optional logger, without retaining caller config.
// Keep a safe Result so layer() is total.
function checkConfig(input: SdkPostgresNetworkConfig): Result.Result<SdkPostgresNetworkConfig, SafeConfigError> {
  const snapshot = {
    connectionString: input.connectionString,
    ...(input.group === undefined ? {} : { group: input.group }),
    ...(input.pid === undefined ? {} : { pid: input.pid }),
    ...(input.tickMs === undefined ? {} : { tickMs: input.tickMs }),
    ...(input.logger === undefined ? {} : { logger: input.logger })
  }
  // Decode connectionString and tickMs separately; map each failure to a
  // static field label. Never retain or render the Schema issue/input.
  // Return snapshot on success; pass group/pid/connectionString unchanged.
}

function safeError(operation: "construct" | "init" | "send" | "stop"): Error {
  // New Error with a fixed message and no raw cause/stack attachment.
}

function guardedNetwork(official: SdkPostgresNetwork): Network {
  return {
    unicast: official.unicast,
    anycast: official.anycast,
    match: (target) => official.match(target),
    recv: (callback) => official.recv(callback),
    init: () => official.init().catch(() => { throw safeError("init") }),
    send: (request) => official.send(request).catch(() => { throw safeError("send") }),
    stop: () => official.stop().catch(() => { throw safeError("stop") })
  }
}

export const layer = (input: SdkPostgresNetworkConfig): Layer.Layer<ResonateNetwork> => {
  const checked = checkConfig(input)
  return Layer.succeed(ResonateNetwork, ResonateNetwork.of({
    make: Effect.fromResult(checked).pipe(
      Effect.mapError((error) => safeSdkError("network.init", error)),
      Effect.flatMap((config) => Effect.try({
        try: () => guardedNetwork(new SdkPostgresNetwork(config)),
        catch: () => safeSdkError("network.init", safeError("construct"))
      }))
    )
  }))
}
```

Core's `ResonateNetworkService.make` currently permits only `ResonateSdkError`. Preserve that contract for U6 and keep the minimal check private. Map a failed check to a safe `ResonateSdkError` during client acquisition with `operation: "network.init"` and `requestMayHaveCommitted: false`. No public config parser or provider error taxonomy is needed. Guard any synchronous SDK method that can throw so the error boundary is complete.

### Effect semantics check

- The repo already has Effect at the workspace root and instructs agents to read `node_modules/effect/AGENTS.md`; U6 needs no setup or agent-file edits. Use the installed Effect 4 API, not remembered Effect 3 examples.
- Schema checks the two values the provider has reason to constrain. `Schema.decodeUnknownResult` keeps these checks pure in `Result`; `Effect.fromResult` crosses into the typed acquisition channel. Map schema issues to fixed field labels without printing or retaining their raw input. The public TypeScript config type is derived from the SDK.
- `ResonateNetwork` is already a `Context.Service`. Build its value directly with `Layer.succeed`; the service's `make` effect is repeatable, while the SDK network is not shared or memoized. Do not add a second provider service or another helper named `make`.
- Core already scopes initialization and release. Adding `Effect.acquireRelease` or a provider finalizer would create two shutdown owners. Promise `.catch` in `guardedNetwork` is limited to the required SDK `Network` Promise interface; constructor exceptions use `Effect.try`. No `Effect.runPromise` is needed.
- Keep expected configuration failure in the typed channel; preserve interruption and defects rather than catching all Effect causes. A sanitized SDK method rejection stays a rejected Promise so core retains the correct SDK operation and commit-uncertainty metadata.

## Implementation units

### U6.1 — Package and configuration surface

Files: `packages/core/src/ResonateNetwork.ts`, `packages/core/src/internal/NetworkGate.ts`, affected core/testing runtime and type tests, `packages/network-postgres/package.json`, `tsconfig.json`, `tsconfig.dev.json`, `tsconfig.types.json`, `src/PostgresNetwork.ts`, `src/index.ts`, `src/__tests__/PostgresNetwork.unit.ts`, `src/__tests__/PublicApi.types.ts`, `pnpm-lock.yaml`.

Replace core's `CompatibleNetwork` alias with the SDK's exported `Network` type. Remove the module-level `ResonateNetwork.make` helper and `MakeOptions` while retaining `ResonateNetworkService.make` as the one per-acquisition operation. Convert simple test providers to `Layer.succeed`; convert the `LocalFixture`-dependent test provider to `Layer.effect` so it captures its dependency at Layer construction. Follow core's `zshy` ESM export pattern for the provider; expose root and `./PostgresNetwork` imports. Declare peer ranges compatible with core and installed SDK (`pg` `^8.11.0`), with matching development dependencies including `@types/pg`. Implement the two minimal Schema guards with safe errors. Test blank strings, invalid intervals, secret-bearing input, input mutation after Layer creation, direct `logger` pass-through, SDK-compatible connection strings and address values passed through unchanged, defaults, and type-level input/output. Verification: core and provider typechecks plus focused unit tests pass.

### U6.2 — Official SDK adapter and ownership tests

Files: provider implementation and unit tests only. Build the official network lazily per `make`; pass validated options and any caller logger unchanged; return a thin delegate that sanitizes thrown/rejected errors without altering successful SDK data. Test fresh instances, no provider-side init/stop, constructor/init/send/stop errors with sentinel secrets, logger identity and original SDK diagnostics, init/stop race through core's existing gate, repeated stop, and missing-driver behavior using isolated module mocking or a small packed consumer fixture. Core already tests gate behavior; add provider tests only for its own boundary. Verification: no sentinel in returned error, `cause`, `String(error)`, or captured default logs; Layer composes with `ResonateClient.layer` without changing core.

### U6.3 — Independent packaging gate

Files: provider README, package export tests or `tests/package.test.mjs`, and lockfile. Pack core and provider separately and typecheck a temp consumer importing both root/subpath APIs. Inspect tarball and manifest: no bundled peers, no test files, no test-package dependency, no Postgres symbol or `pg` edge in core. Keep `packages/testing` private. Verification: `pnpm check`, `pnpm test`, and `pnpm --filter @effect-resonate/network-postgres pack` succeed without Docker; provider tests run without a database.

## Risks and implementation-time checks

- SDK 0.11.5 `init()` may leave partially opened resources on rejection. Core's armed partial-acquisition finalizer calls `NetworkGate.stop()` after init settles. Unit tests must prove the order; U7 tests real driver behavior.
- `send()` errors may follow a committed request. Preserve core's `requestMayHaveCommitted` classification; do not retry inside the provider.
- The SDK `PostgresNetwork` logs raw `err.message` for listen/drain errors when a logger is supplied. This is caller-owned output and must be documented; verify the provider still sanitizes errors returned to core.
- The full Postgres schema, missing-schema detection, `pg_cron`, recovery, cancellation, and U5 conformance remain U7 acceptance work.

No material architecture decision remains. Implementation should verify the installed Schema refinement API and whether mocking `pg` is reliable in this workspace; if not, test missing-driver behavior in the packed consumer without weakening the public contract.
