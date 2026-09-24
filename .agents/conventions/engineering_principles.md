# Engineering Principles

**BLUF**: State invariants before code — reached by walking concrete cases, not asserted cold — trace protocols end-to-end, guard every trust boundary, prefer immutability, design for failure explicitly, and prove pre/postconditions before implementing. Internalize these before reading any other convention doc.

## Start with Invariants, Not Implementation

State the invariants in plain English before writing code. If you can't state them, you don't understand the problem yet — "tests + vibes" isn't enough; a missing invariant becomes a 3-day heisenbug in production.

- **Safety** (must NEVER happen): balance goes negative, order charged twice, deleted record returned to client, credentials appear in logs.
- **Liveness** (must EVENTUALLY happen): queued message processed or dead-lettered, failed payment retried or reported, orphaned resource cleaned up.
- **Consistency** (must ALWAYS be true): ledger entries sum to zero, every child record has a valid parent, cache and source agree within N seconds.

Write these down, review them, then write code that makes them true. How you reach ones worth stating — and make them land for a human reader — is below.

## Walk It Before You State It

**Walkthroughs exist for the human reading the spec, not the machine executing it.**

An invariant is compressed jargon. "A place must never carry two references to the same `place_id`" is precise and nearly unreadable until you've watched `Songbirds` get matched twice. The walkthrough is the decompression — it bridges domain language and the reader's mental model, so the invariant lands as a picture instead of a sentence to be re-parsed every read.

Two consequences:

- **Write the walkthroughs first.** Stating invariants cold produces confident, wrong universals. Walk the real cases, then propose invariants against them.
- **Judge a walkthrough by whether a newcomer gets it.** A row that restates the invariant in system terms has failed its only job.

### Walkthroughs do not derive invariants

A walkthrough is existential ("this happened"); an invariant is universal ("this always / never happens"). No finite set of the former proves the latter.

| Use of a walkthrough         | Sound? | What you get                                                   |
| ---------------------------- | ------ | -------------------------------------------------------------- |
| Build the reader's model     | Yes    | The invariant becomes memorable, not just correct              |
| Ground the vocabulary        | Yes    | You cannot state a rule about "picks" until you've written one |
| Falsify a proposed invariant | Yes    | One counterexample kills it — this is the whole game           |
| Anchor the invariant         | Yes    | It becomes testable by construction                            |
| **Derive** the invariant     | **No** | Induction. Three happy paths do not prove "never"              |

So the loop is **propose → falsify**, not derive. Once you've proposed an invariant, actively try to construct a walkthrough that violates it. If you succeed, either the invariant was false or you just found a requirement you would have shipped without.

### The walkthrough table

One table. Every row is a **path through the decision tree**, not a data variation.

| #   | Story                                              | Path                         | Result                                  | Invariants | SC   |
| --- | -------------------------------------------------- | ---------------------------- | --------------------------------------- | ---------- | ---- |
| W1  | Overture record, venue unknown to us               | miss → 0 candidates → create | 1 place, 1 ref                          | S5, C7     | SC12 |
| W2  | Overture record for a venue Google already gave us | miss → match → attach        | **1 place, 2 refs**                     | S2, C2, S9 | SC11 |
| W4  | The same blog post ingested twice                  | ref **hit**                  | zero writes to `places`                 | L5, C7     | SC10 |
| W9  | Two records claim the same Google `place_id`       | ref hit → ref hit            | **MUST NOT OCCUR** — unique idx rejects | S2         | —    |

- **Story** — narrative. Something that happened, in concrete nouns (`Songbirds`, not "a short-named venue"). Not an As-a / I-want template: the actor is often a pipeline, and a persona adds ceremony without clarity.
- **Path** — a trace through the decision tree, as arrow-separated branch labels.
- **Result** — the observable outcome. Bold the surprising one; that's where a reader's model breaks.
- **Invariants** — which invariants this row exercises. Each invariant carries `Exercised by: W#` in return.
- **MUST NOT OCCUR rows** are how safety invariants get walked. Safety claims unreachability, so no legitimate row can exercise it.

**A MUST NOT OCCUR row confirms; it does not falsify.** Showing one attack bounce off the guard proves the guard holds _for that attack_ — it is not proof the state is unreachable, and treating one such row as "safety covered" is the same induction the table above rules out. So write one row per plausible **attack vector** (concurrent insert, soft-delete then recreate, a second source claiming the same id), not one row per invariant. Normal rows corroborate indirectly — W2's "1 place, 2 refs" quietly depends on the same uniqueness guarantee — but only a MUST NOT OCCUR row tests the guard head-on.

The real falsification event is a row where the forbidden state **does** land. That is not a table entry to accept; it means the invariant is false and the design needs fixing.

### Two checks this buys you

1. **W ↔ invariant.** Every invariant is exercised by ≥1 row; every row cites ≥1 invariant. An invariant no row walks is dead or untested. A row citing nothing is a test fixture, not a walkthrough.
2. **Path ↔ diagram.** Every arrow-token in a `Path` cell exists as an edge in the protocol diagram, and every edge appears in ≥1 `Path`. An unwalked edge is a dead branch or a missing scenario; a path token with no edge means the diagram is stale.

**Liveness escapes both.** No finite walkthrough demonstrates _eventually_. Liveness invariants derive from the failure taxonomy — what can stall, crash, or partially apply — not from the table. Expect them to be under-covered by construction; that's the seam, not a defect.

**But state the bound, and only genuinely unbounded claims get the exemption.** Most "eventually" claims are secretly bounded — a retry cap, a dead-letter deadline, an SLA — and a bounded claim _is_ walkable ("queued 8h → dead-letters"), so it owes the same coverage as anything else. The exemption belongs to liveness alone: it is not a label a safety or consistency invariant can adopt to skip the check, and an invariant that reaches for it should be read as a safety invariant in disguise.

### When to stop

A row earns its place if it adds a new **edge**, a new **invariant**, or a deliberate **contrast** with an adjacent row ("same, but the venue is short-named"). Nothing else. A row that varies data without varying path is a test fixture.

Add new behaviour by adding a row first.

**A table growing faster than the decision tree is a design smell, not a documentation problem.** Past ~12 rows for one protocol, suspect the protocol.

### Scale it down

Walkthroughs are mandatory only where a decision tree exists — branching resolution, state machines, multi-source writes, lifecycle transitions. A single-path change needs one row or none. A two-line spec is still legal.

## Think in Protocols, Not Implementations

Protocols are the invariant form of a system. Trace the full protocol before writing code:

1. Where does this data/request originate?
2. What transformations occur (validation, enrichment, state changes)?
3. Where does it terminate?
4. What are the failure modes (retry, fallback, compensation)?
5. What invariants must hold throughout?

The protocol is the specification; the code is just one program that meets it. Style is a preference, correctness is a requirement — code that meets the spec is correct even if it offends your taste.

## Guard the Borders

Every system boundary is a trust boundary — defend it rigorously.

**Inputs** (`External World → [Validation Boundary] → Your Domain`):

- Parse, don't validate — transform `unknown` into known types, don't just check-and-cast.
- Fail fast — clear errors at the boundary; don't let bad data propagate.
- Be explicit — unknown payloads are `unknown`, never `any`.

**Outputs** (`Your Domain → [Transformation Boundary] → External World`):

- Don't leak internals — map to explicit response shapes.
- Consider exposure — internal IDs? timestamps? relationships? error details?
- Version contracts — external consumers depend on your shape.

## Prefer Immutability

Mutation is a bug factory — every reassignment is a place state can diverge from expectations. It isn't always wrong (perf-critical paths, framework internals), but it should be the exception you justify, not the default you reach for.

- `const` over `let` — if you reach for `let`, reconsider; prefer pattern matching, switch, if/else, or function enclosure.
- Build, don't mutate — construct complete objects in one expression rather than filling an empty one in.
- Pure functions by default — same input, same output, no side effects; testable, composable, easy to reason about.
- Avoid `try/catch` that forces mutation — `let x; try { x = ... } catch { ... }` is hard to read; prefer error channels or function returns.
- Explicit data flow — if a value changes, it should be obvious where and why, not buried in a reassignment three branches deep.

## Match Parameter Style to API Ownership

- Use an options object for functions whose API we design. This keeps our arguments named as the function evolves.
- When our function wraps a third-party API, preserve that API's calling style and argument order. This includes Resonate, Vitest, and other SDKs. A caller should be able to follow the upstream documentation through our wrapper.
- For example, a Vitest helper should read `itest(name, effect, options?)`, like `it(name, effect, options?)`; do not replace it with `itest({ name, run })` just to follow the options-object preference.

## Design for Failure

Everything fails. Design the failure modes explicitly, not as an afterthought. Before writing code, answer:

- Is this operation **idempotent**? Can it be safely retried?
- What's the **blast radius**? Does one failure cascade?
- Is there a **fallback**? Cached data, default value, graceful degradation?
- How do you **communicate failure** — to users, to operators, to dependent systems?

| Type      | Example                  | Response                       |
| --------- | ------------------------ | ------------------------------ |
| Transient | Network blip, rate limit | Retry with backoff             |
| Permanent | Not found, invalid input | Fail fast, clear error         |
| Partial   | Batch with some errors   | All-or-nothing or best-effort? |

**Compensation**: when operations span multiple systems, how do you undo partial work? Saga pattern, compensation events, manual intervention?

## Prove Your Thinking, Not Just Your Code

Formal methods aren't just for proving systems correct — use them to prove your thinking correct. Before implementation, state:

- **Preconditions** — what must be true before this runs?
- **Postconditions** — what must be true after this runs?
- **Invariants** — what must remain true throughout?

If you can't answer these clearly, you're not ready to write code.

## The Whiteboard Test

Before implementing any feature, you should be able to draw it on a whiteboard and answer:

1. What are the **states**? (entities, their lifecycles)
2. What are the **transitions**? (events that change state)
3. What are the **invariants**? (what must always/never be true)
4. What are the **failure modes**? (what happens when things break)
5. What are the **boundaries**? (where does trust change)

If you can't draw it clearly, you can't build it correctly.

## Summary: The Pre-Implementation Checklist

Before writing code, answer:

- [ ] Have I **walked the concrete cases**? (would a newcomer understand the invariants from them)
- [ ] What are the **safety invariants**? (must never happen)
- [ ] What are the **liveness invariants**? (must eventually happen)
- [ ] What are the **consistency invariants**? (must always be true)
- [ ] What's the **protocol**? (states, transitions, boundaries)
- [ ] What are the **preconditions**? (what must be true before)
- [ ] What are the **postconditions**? (what must be true after)
- [ ] What are the **failure modes**? (transient, permanent, partial)
- [ ] What are the **trust boundaries**? (where to validate)
- [ ] Is the code **immutable by default**? (no `let`, no object mutation, pure functions)
- [ ] Can I **draw this on a whiteboard**?
- [ ] Is every invariant **exercised by a walkthrough** — or declared liveness-derived?
