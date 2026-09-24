# U6 implementation plan: Postgres network Layer

Source: `docs/specs/2026-09-23-001-network-postgres-u6-spec.md`. Stack base: U5; branch `luke/feature/network-postgres-u6`.

1. Keep core's `ResonateNetwork` service as a per-acquisition factory typed to the SDK `Network`. Core's `NetworkGate` remains the only owner of readiness and shutdown.
2. Package the official SDK `PostgresNetwork` as an Effect Layer. Its `make` uses `Effect.try` to construct a fresh instance and maps only constructor failure to `ResonateSdkError` with the original cause. Pass `PostgresNetworkConfig` directly to the SDK; return its network instance without method wrapping or config validation.
3. Unit test fresh instances, direct config and logger pass-through, original constructor and method failures, and core-owned init/stop. Packed-consumer tests cover root and subpath exports, so a separate source-level public API type fixture adds no useful evidence.
4. Build, typecheck, test, and pack the provider independently. Keep core free of provider and `pg` imports. U7 owns real Postgres conformance.

The SDK constructor is inert and stores configuration for later initialization. The Layer can be shared, but each client acquisition must receive its own SDK network. Constructor failures have a typed Effect boundary; network method failures retain the SDK's original diagnostics and core's existing operation classification.
