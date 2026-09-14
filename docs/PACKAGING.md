# Packaging and repository topology

Status: current direction; revisit when the first package is ready to publish.

## Package namespace

Use `@effect-resonate/*` for published packages.

The initial and only package is:

```text
@effect-resonate/core
```

Do not use the `@effect/*` scope; that would imply official ownership by the Effect project.

## Monorepo from day one, one package until justified

The repository is a pnpm workspace so future runtime/testing integrations can be added without renaming the core package or migrating repository structure later.

```text
packages/
  core/       @effect-resonate/core
examples/     workspace consumers / integration examples
docs/         architecture notes
```

Being a monorepo is not a reason to split modules into packages. `Workflow`, `Step`, `ResonateClient`, `Network`, and similar concepts should remain module entrypoints inside `@effect-resonate/core`.

Create another npm package only when there is a concrete boundary such as:

- materially different or optional dependencies;
- a distinct runtime/environment;
- testing-only functionality that should not ship with production code;
- a package that is independently useful/versionable.

Likely future candidates are `@effect-resonate/testing` and provider/runtime-specific integrations if they grow beyond thin wrappers.

## Build model

Use `zshy` for package compilation.

Goals:

- bundler-free TypeScript library output;
- ESM-only initially;
- generated declaration files and package exports;
- preserve module boundaries for consumer tree-shaking;
- do not bundle Effect or Resonate.

`effect` and `@resonatehq/sdk` are peer dependencies and are also installed as development dependencies for local compilation/testing.

The initial `zshy` export map only exposes the root entrypoint. Add stable subpath exports such as `./Workflow` and `./Step` as those modules become real public APIs rather than publishing placeholder entrypoints.

## TypeScript

Pin the build to the TypeScript 5.x compiler line while `zshy` relies on the TypeScript JS compiler API. Revisit this when the toolchain supports TypeScript 7.

## Release process (planned, not yet wired)

When the API is ready for its first npm release:

1. add Changesets for package versioning/changelogs;
2. validate packed output with `publint` and `@arethetypeswrong/cli`;
3. publish from GitHub Actions using npm trusted publishing / OIDC rather than a long-lived `NPM_TOKEN`;
4. enable npm provenance;
5. add at least one workspace/fixture consumer that tests the packed artifact rather than importing source directly.

Avoid adding release automation before there is a package worth releasing.
