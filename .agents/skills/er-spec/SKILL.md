---
name: er-spec
description: Define requirements and durable-execution invariants for a non-trivial effect-resonate feature before implementation. Use for ambiguous features, API design, or changes spanning Effect and Resonate boundaries; skip for obvious local edits.
---

# Effect Resonate Spec

Produce a concise specification in `docs/specs/YYYY-MM-DD-NNN-<name>-spec.md`.
Choose the next sequence number for the date. The specification defines behavior;
it does not prescribe file-by-file implementation.

## Establish the problem

Read the user's source material and inspect the relevant repository code and
design documents. State material assumptions. Resolve an assumption with code or
documentation when possible; ask the user only when it changes public behavior,
data ownership, durability semantics, or scope.

Treat these as architecture invariants:

- Resonate workflows own durable orchestration and use `ctx.run`, `ctx.rpc`,
  `ctx.sleep`, `ctx.promise`, and related durable operations.
- Registered steps or activities own arbitrary Effect programs.
- A workflow must not run an arbitrary long-lived Effect program and then
  continue issuing durable Resonate operations.
- Durable values are JSON-compatible by default. Add schemas at trust boundaries
  and codecs only for deliberate persistence or wire representations.
- The package remains a small wrapper over `@resonatehq/sdk/async`, with Effect
  and Resonate as peer dependencies and stable module entrypoints.

When Effect behavior is involved, read `node_modules/effect/AGENTS.md` completely
before reasoning about APIs. If it is unavailable, record that limitation and use
the installed `node_modules/effect/src` rather than guessing.

## Write the spec

Include only sections that help settle the feature:

1. **Objective** and testable **Success Criteria**.
2. **Assumptions** and explicit **Scope Boundaries**.
3. Concrete **Walkthroughs** covering success, retries or duplicate execution,
   malformed input, partial failure, and recovery when applicable.
4. **Invariants** grouped into safety, liveness, and consistency. State where
   each invariant is enforced and which walkthrough exercises it.
5. **Protocol / Dataflow** from caller through workflow and step boundaries to
   completion. Use Mermaid when more than one boundary or branch is involved.
6. **Failure Taxonomy** distinguishing typed domain failures, defects,
   retryable infrastructure failures, timeouts, and cancellation as applicable.
7. **Trust Boundaries** and the exact values that require runtime validation.
8. **Open Questions**, separating decisions needed before planning from facts
   that implementation can discover safely.

Before handing off, try to construct a counterexample for every invariant and
confirm each success criterion is observable. Cite repo-relative source paths and
the design documents that constrain the result.

Return the saved path, the core protocol decision, and any unresolved question
that blocks planning. Recommend `er-plan <spec path>` when the spec is ready.
