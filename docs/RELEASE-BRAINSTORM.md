# Release & Packaging Brainstorm

This document captures the current packaging and release direction for `effect-resonate`.

It is intentionally a brainstorm, not a frozen policy. The goal is to choose a setup that is boring, correct, and easy to evolve as the library grows.

## Direction

Use **Effect's packaging philosophy**, but do not copy Effect's entire build pipeline.

Use **`zshy`** for compilation and package generation.

The high-level approach:

```text
source
  │
  ▼
TypeScript
  │
  ▼
zshy
(no JS bundling)
  │
  ├── dist/*.js
  └── dist/*.d.ts
  │
  ▼
publint + arethetypeswrong
  │
  ▼
Changesets
  │
  ▼
release PR
  │
  ▼
GitHub Actions
  │
  ▼
npm via OIDC trusted publishing
```

## Why `zshy`

`zshy` is a strong fit for this kind of library because it is designed around TypeScript package publishing rather than application bundling.

It gives us:

- TypeScript compiler-based output
- declaration generation
- package export-map generation
- correct ESM/CJS declaration pairing when needed
- a simple source-to-dist model
- no unnecessary runtime bundling

That matches what we want for an SDK-style library.

## What to copy from Effect

We should copy the parts of Effect's package design that are useful to consumers:

- unbundled modules
- explicit subpath exports
- tree-shakable output
- declarations alongside compiled JS
- peer dependencies for core runtime libraries
- Changesets-based release management
- strong package validation before publish

We should **not** copy Effect's more specialized build machinery unless we develop an actual need for it.

In particular, avoid introducing Babel transforms or custom pure-annotation pipelines up front.

## Module format

Start **ESM-only**.

The package is specifically for Effect users, and Effect v4 is ESM-first. Carrying CommonJS support from day one adds complexity without a clear consumer requirement.

If a real CJS use case appears later, `zshy` can support dual output correctly.

## Do not bundle Effect or Resonate

Both should remain peer dependencies.

Conceptually:

```json
{
  "peerDependencies": {
    "effect": "<compatible-v4-range>",
    "@resonatehq/sdk": "<compatible-range>"
  }
}
```

They should also appear in `devDependencies` for local development and tests.

Reasons:

- avoid duplicate Effect runtimes
- preserve Context/service identity
- avoid duplicate Resonate SDK copies
- keep the package small
- let applications own exact dependency resolution

While Effect v4 remains RC, keep its peer range intentionally narrow. Once Effect v4 is GA, move to an appropriate semver range such as `^4.0.0`.

Resonate is also currently pre-1.0, so its supported peer range should remain conservative.

## Package surface

Prefer Effect-style stable subpath entrypoints rather than making the root barrel the only API.

For example:

```ts
import * as Workflow from "@effect-resonate/core/Workflow"
import * as Step from "@effect-resonate/core/Step"
import * as ResonateNetwork from "@effect-resonate/core/ResonateNetwork"
```

The root entrypoint can still re-export common pieces:

```ts
import { Workflow, Step } from "@effect-resonate/core"
```

But the root should not become a dependency magnet.

A likely source layout:

```text
src/
  Client.ts
  Workflow.ts
  Step.ts
  Network.ts
  index.ts
```

with `zshy` producing a corresponding `dist/` module tree.

## Release management

Use **Changesets**.

Even though the repo is initially a single package, this gives us a clean path if the project later grows into multiple packages, for example:

```text
@effect-resonate/core
@effect-resonate/network-postgres
@effect-resonate/testing
@effect-resonate/network-http
```

Expected flow:

```text
feature PR
  │
  └── includes changeset
          │
          ▼
        main
          │
          ▼
      release PR
      - version bump
      - changelog
          │
          ▼
         merge
          │
          ▼
      npm publish
```

## Publishing

Use npm **trusted publishing via GitHub Actions OIDC** rather than a long-lived `NPM_TOKEN`.

Release workflow should use:

```yaml
permissions:
  contents: read
  id-token: write
```

Then publish from a GitHub-hosted runner using npm trusted publishing.

Benefits:

- no persistent npm publish secret
- short-lived credentials
- package provenance
- better supply-chain posture

## Validation before publish

The release gate should include at least:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm publint
pnpm attw --pack
```

Use:

- `publint`
- `@arethetypeswrong/cli`

These are especially valuable for this library because package export and declaration mistakes are easy to make and often only appear to consumers.

## Consumer fixture tests

Add small consumer fixtures that install the packed package rather than importing source directly.

For example:

```text
test/fixtures/
  node-esm/
  vite/
```

Each fixture should install a package created with `pnpm pack` and verify representative imports such as:

```ts
import * as Workflow from "@effect-resonate/core/Workflow"
import * as Step from "@effect-resonate/core/Step"
```

This validates the actual published artifact, not just the source tree.

## Pre-1.0 strategy

Start in the `0.x` range and explicitly treat minor versions as potentially breaking while the API is still settling.

For example:

```text
0.1.0
0.2.0
0.3.0
```

A useful policy:

> Until 1.0, minor releases may contain breaking changes.

Also support snapshot/canary releases for testing changes in real applications before merging or cutting a stable version.

This is especially useful because many important failures in this library will be type-inference and ergonomics issues that only show up in real consumer code.

## Initial recommendation

The initial setup should be:

- `pnpm`
- `zshy`
- ESM-only
- unbundled module output
- Effect + Resonate as peer dependencies
- Effect-style subpath exports
- Changesets
- `publint`
- `@arethetypeswrong/cli`
- GitHub Actions
- npm trusted publishing with OIDC and provenance

## Defer for now

Do not add these until there is evidence they are needed:

- CommonJS output
- Babel transforms
- custom tree-shaking annotations
- complicated monorepo release infrastructure
- bundling Effect or Resonate
- bespoke publish scripts

The bias should be toward a transparent TypeScript package whose emitted output closely mirrors the source structure.
