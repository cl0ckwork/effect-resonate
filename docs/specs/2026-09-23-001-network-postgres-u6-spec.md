# U6: Postgres network provider

Status: implemented on the U6 stacked PR. Base: U5.

## Objective and boundary

Publish `@effect-resonate/network-postgres` as a separate ESM package that supplies core's `ResonateNetwork` service with the official SDK `PostgresNetwork`. The provider binds SDK construction to an Effect Layer. It does not reinterpret the SDK's configuration, messages, diagnostics, or network methods.

The caller supplies the official `PostgresNetworkConfig`, including an optional logger. Each `make` constructs a fresh, uninitialized network and passes that same config to the SDK. Core alone initializes and stops the network and handles partial acquisition and shutdown. The SDK owns its pool, listener, polling, SQL, and protocol behavior. The operator owns schema and `pg_cron` setup.

## Requirements

- **R1 Composition:** A shared provider Layer can serve multiple client acquisitions without sharing a network instance. Construction happens when core requests `make`, not when `layer()` is called.
- **R2 Error semantics:** If construction throws, the typed `ResonateSdkError` retains the original cause and labels the failure `network.init` with `requestMayHaveCommitted: false`. Once constructed, SDK method failures propagate unchanged through the network. The provider does not sanitize SDK errors or logger output.
- **R3 Lifecycle:** The provider never calls `init()` or `stop()`. Core's `NetworkGate` and client scope own readiness and release.
- **R4 Packaging:** The package builds and packs independently, peers on core, Effect, the SDK, and `pg`, and adds no Postgres dependency to core.

## Walkthroughs

| Path | Result |
| --- | --- |
| App provides config → client acquisition requests `make` twice | Two official SDK networks receive the caller's config; neither starts in the provider. |
| SDK constructor throws → `make` fails | Caller receives `ResonateSdkError` with the original cause. No network exists to release. |
| SDK `init()` or `send()` rejects | The original rejection reaches core and the caller with SDK diagnostics intact. |
| Core releases a client after initialization | Core stops that client's network once, including after partial acquisition. |

The production provider has no config parser, custom transport, SQL migration, retry policy, or logger adapter. U7 runs the U5 conformance scenarios against PostgreSQL.
