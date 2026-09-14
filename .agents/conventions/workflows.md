# Agent workflows

Use the smallest workflow that fits the task:

- `er-spec` defines requirements and durable-execution invariants for ambiguous,
  cross-cutting, or API-design work. It writes reviewable specs under
  `docs/specs/`.
- `er-plan` turns an approved spec or concrete request into an executable plan
  under `docs/plans/`.
- `er-review` reviews a working tree, branch, commit, or PR. Select only the
  reviewer agents relevant to the diff.

Skip specification work for obvious local changes. Do not begin implementation
while product or durability semantics needed by the plan remain unresolved.
