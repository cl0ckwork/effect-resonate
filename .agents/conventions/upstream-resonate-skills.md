# Upstream Resonate skills

For ordinary Resonate TypeScript work:

1. Use `resonate-async-await-engine-typescript` for the concrete SDK API.
2. Apply `.agents/conventions/durable-execution.md` for this wrapper's ownership
   boundary.

When translating Temporal code or concepts, first use
`resonate-migrate-from-temporal` to identify the corresponding Resonate pattern,
then follow the ordinary TypeScript route above for its implementation.

Local conventions govern when upstream guidance conflicts. This repository uses
`@resonatehq/sdk/async`; ignore generator-engine forms such as `yield*`,
`ctx.beginRun`, and `ctx.beginRpc`. Async fan-out starts eager `ctx.run` calls and
then awaits them with `Promise.all`.

The imported skills describe SDK 0.11.4, while this repository's compatible
range may resolve a newer patch. Verify uncertain APIs against the installed
`node_modules/@resonatehq/sdk` source and types before writing code.

The migration skill links to other language and pattern skills that are not
installed here. Treat those links as optional background. For TypeScript work,
use the async-engine skill, installed SDK source, and local durable-execution
convention instead of inferring or installing generator-oriented guidance.
