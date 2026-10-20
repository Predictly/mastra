import { describe, expect, it, vi } from 'vitest';

import { resolvePhaseSessionModel } from './phase-model.js';
import type { FactorySessionModelContext } from './phase-model.js';

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';

function context(overrides: Partial<FactorySessionModelContext> = {}): FactorySessionModelContext {
  return {
    orgId: 'org-1',
    factoryProjectId: PROJECT_ID,
    board: 'work',
    phase: 'execute',
    role: 'work',
    workItem: { title: 'Fix issue 1', metadata: { labels: ['effort:high'] } },
    parentWorkItem: null,
    defaultModelId: 'anthropic/claude-sonnet-4-6',
    modelScope: 'factory',
    ...overrides,
  };
}

function silence(method: 'info' | 'warn') {
  return vi.spyOn(console, method).mockImplementation(() => {});
}

describe('resolvePhaseSessionModel', () => {
  it('keeps the defaults, without logging, when neither a resolver nor a decision is in play', async () => {
    const info = silence('info');
    const warn = silence('warn');

    await expect(resolvePhaseSessionModel({ context: context() })).resolves.toEqual({
      modelId: undefined,
      thinking: undefined,
    });
    await expect(resolvePhaseSessionModel({ context: context(), decision: {} })).resolves.toEqual({
      modelId: undefined,
      thinking: undefined,
    });

    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    info.mockRestore();
    warn.mockRestore();
  });

  it('hands the resolver the phase context and runs on its choice', async () => {
    const resolver = vi.fn(({ role, workItem }: FactorySessionModelContext) =>
      role === 'work' && (workItem.metadata?.labels as string[]).includes('effort:high')
        ? { modelId: 'openai/gpt-5.6', thinking: 'high' as const }
        : undefined,
    );
    const ctx = context();

    await expect(resolvePhaseSessionModel({ context: ctx, resolver })).resolves.toEqual({
      modelId: 'openai/gpt-5.6',
      thinking: 'high',
    });

    expect(resolver).toHaveBeenCalledExactlyOnceWith(ctx);
  });

  it('keeps the defaults when the resolver returns nothing', async () => {
    await expect(resolvePhaseSessionModel({ context: context(), resolver: () => undefined })).resolves.toEqual({
      modelId: undefined,
      thinking: undefined,
    });
    await expect(resolvePhaseSessionModel({ context: context(), resolver: async () => ({}) })).resolves.toEqual({
      modelId: undefined,
      thinking: undefined,
    });
  });

  it('lets the decision win over the resolver, field by field', async () => {
    const resolver = vi.fn(() => ({ modelId: 'openai/gpt-5.6', thinking: 'low' as const }));

    // A decision that fills both fields never asks the resolver.
    await expect(
      resolvePhaseSessionModel({
        context: context(),
        decision: { modelId: 'anthropic/claude-opus-4-7', thinking: 'high' },
        resolver,
      }),
    ).resolves.toEqual({ modelId: 'anthropic/claude-opus-4-7', thinking: 'high' });
    expect(resolver).not.toHaveBeenCalled();

    // A partial decision keeps its own field and takes the rest from the resolver.
    await expect(
      resolvePhaseSessionModel({ context: context(), decision: { thinking: 'high' }, resolver }),
    ).resolves.toEqual({ modelId: 'openai/gpt-5.6', thinking: 'high' });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("ignores every choice, with one log line, when the run uses the session owner's scope", async () => {
    const info = silence('info');
    const resolver = vi.fn(() => ({ modelId: 'openai/gpt-5.6', thinking: 'high' as const }));

    await expect(
      resolvePhaseSessionModel({
        context: context({ modelScope: 'user', defaultModelId: undefined }),
        decision: { modelId: 'anthropic/claude-opus-4-7', thinking: 'low' },
        resolver,
      }),
    ).resolves.toEqual({ modelId: undefined, thinking: undefined });

    expect(resolver).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledExactlyOnceWith(
      "[Factory Start] Phase model choice ignored: the run uses the session owner's model scope",
      { factoryProjectId: PROJECT_ID, board: 'work', phase: 'execute', role: 'work' },
    );
    info.mockRestore();
  });

  it('falls back to the defaults, with a warning, when the resolver throws', async () => {
    const warn = silence('warn');

    await expect(
      resolvePhaseSessionModel({
        context: context(),
        resolver: async () => {
          throw new Error('policy table unavailable');
        },
      }),
    ).resolves.toEqual({ modelId: undefined, thinking: undefined });

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[Factory Start] Session model resolver failed; using the Factory defaults',
      {
        factoryProjectId: PROJECT_ID,
        board: 'work',
        phase: 'execute',
        role: 'work',
        error: 'policy table unavailable',
      },
    );
    warn.mockRestore();
  });

  it('drops a thinking level the resolver made up, keeping its model', async () => {
    const warn = silence('warn');

    await expect(
      resolvePhaseSessionModel({
        context: context(),
        resolver: () => ({ modelId: 'openai/gpt-5.6', thinking: 'ultra' as never }),
      }),
    ).resolves.toEqual({ modelId: 'openai/gpt-5.6', thinking: undefined });

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[Factory Start] Session model resolver returned an unknown thinking level; using the Factory default',
      { thinking: 'ultra', role: 'work' },
    );
    warn.mockRestore();
  });

  it('drops a thinking level the chosen model cannot run at, keeping the model', async () => {
    const warn = silence('warn');

    // Only GPT-5.6 and later accept `max`; an older OpenAI model would quietly run at `xhigh`.
    await expect(
      resolvePhaseSessionModel({ context: context(), decision: { modelId: 'openai/gpt-5.5', thinking: 'max' } }),
    ).resolves.toEqual({ modelId: 'openai/gpt-5.5', thinking: undefined });

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[Factory Start] Phase thinking level is not available on the model; using the Factory default',
      expect.objectContaining({ modelId: 'openai/gpt-5.5', thinking: 'max', role: 'work' }),
    );
    warn.mockRestore();
  });

  it('checks a thinking-only choice against the default model it will run on', async () => {
    const warn = silence('warn');

    await expect(
      resolvePhaseSessionModel({
        context: context({ defaultModelId: 'openai/gpt-5.5' }),
        decision: { thinking: 'max' },
      }),
    ).resolves.toEqual({ modelId: undefined, thinking: undefined });
    await expect(
      resolvePhaseSessionModel({ context: context({ defaultModelId: undefined }), decision: { thinking: 'max' } }),
    ).resolves.toEqual({ modelId: undefined, thinking: 'max' });

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
