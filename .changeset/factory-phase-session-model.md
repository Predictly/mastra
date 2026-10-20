---
'@mastra/factory': minor
---

Factory can now choose the model and thinking level per phase instead of running every phase on the project default. Addresses [#23516](https://github.com/mastra-ai/mastra/issues/23516).

- `resolveSessionModel` on `MastraFactoryConfig` is the project-wide policy. The Factory calls it each time it prepares a phase session (a new card, a phase transition, a restart) with the card's board, phase and role, the card (labels in `metadata.labels`), the card it was opened from, the project default and the run's model scope. Return `{ modelId?, thinking? }`, or `undefined` to keep the defaults.
- An `invokeSkill` rule decision can carry `model` and `thinking` for the one run it starts. Validation rejects a `thinking` value that is not a thinking level.

Precedence is decision, then `resolveSessionModel`, then the project default, field by field. A choice applies only when the run resolves to the Factory's model scope; under the owner's scope it is ignored with a log line. A resolver that throws, a refused model, or a level the model cannot run at falls back to the defaults with a warning and never fails the run.

```ts
new MastraFactory({
  storage,
  resolveSessionModel: ({ role, workItem }) => {
    const labels = Array.isArray(workItem.metadata?.labels) ? workItem.metadata.labels : [];
    if (role === 'triage' || role === 'review') return { modelId: 'anthropic/claude-haiku-4-5', thinking: 'low' };
    if (role === 'work' && labels.includes('effort:high')) return { modelId: 'openai/gpt-5.6', thinking: 'high' };
    return undefined;
  },
});
```
