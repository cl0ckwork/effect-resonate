---
name: er-plan
description: Create an implementation-ready plan for effect-resonate from an approved spec or concrete request. Use when deciding code seams, sequencing, tests, and verification; do not use while product or durability semantics remain unresolved.
---

# Effect Resonate Plan

Write a compact plan to `docs/plans/YYYY-MM-DD-NNN-<type>-<name>-plan.md`, where
type is `feat`, `fix`, `refactor`, or `chore`. Use the next sequence number for
the date and repo-relative paths throughout.

## Ground the plan

Read the named spec or request, `.agents/AGENTS.md`, relevant design documents,
and the actual implementation. Search for an existing local pattern before
proposing a new abstraction.

Before planning Effect code, read `node_modules/effect/AGENTS.md` completely and
follow its required references. For unclear APIs, inspect the installed
`node_modules/effect/src`. For Resonate behavior, verify against the installed
`@resonatehq/sdk/async` types or official documentation.

Keep these ownership boundaries explicit:

- Resonate workflows own durable decisions and replay-safe orchestration.
- Registered steps or activities own Effect execution, services, layers,
  resource scopes, and typed failures.
- Public package modules own the user-facing API; persistence codecs and runtime
  schemas exist only at real boundaries.
- `packages/core` is the current distribution boundary. Add a package only for
  a real dependency, runtime, testing, or publication boundary.

## Plan format

Include:

- **Summary**: the resulting behavior and why it is needed.
- **Requirements Trace**: stable requirement IDs from the source or spec.
- **Walkthroughs and Invariants**: carry them forward by reference and record any
  implementation discovery that changes enforcement.
- **Protocol / Dataflow**: show workflow, step, serialization, and failure
  boundaries. Include replay, retries, duplicate execution, cancellation, and
  partial failure when they apply.
- **Key Decisions**: decision, alternatives considered, evidence, and rationale.
- **Implementation Units**: logical commit-sized sections named `U1`, `U2`, and
  so on. Each names files, dependencies, approach, patterns, meaningful test
  scenarios, and an observable verification outcome.
- **Risks and Mitigations**: only concrete risks supported by the proposed
  change.
- **Open Questions**: separate resolved findings from implementation-time
  unknowns. A product or architectural unknown cannot be deferred merely to
  make the plan appear complete.

Tests should prove public behavior and boundary semantics. Include cases for
empty or malformed values, repeat execution, retries, timeouts, cancellation,
and failures halfway through a protocol when those cases are possible. State
`Test expectation: none` with a reason for documentation-only or mechanical
units rather than inventing tests.

Before handoff, confirm the units preserve every source invariant, follow the
`@resonatehq/sdk/async` execution model, retain peer-dependency and bundler-free
packaging, and leave no material decision to the implementer without saying so.

Return the plan path, one sentence describing its implementation shape, and any
remaining implementation-time unknowns.
