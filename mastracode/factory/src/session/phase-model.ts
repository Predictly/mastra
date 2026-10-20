import { getAvailableThinkingLevelsForModel, isThinkingLevelSetting } from '@mastra/code-sdk/thinking';
import type { ThinkingLevelSetting } from '@mastra/code-sdk/thinking';
import { getModelReasoningOptions } from '@mastra/core/llm';

import type { EffectiveModelScope } from '../storage/domains/projects/base.js';
import type { CreateWorkItemInput, WorkItemRow } from '../storage/domains/work-items/base.js';

/** What a {@link FactorySessionModelResolver} knows about the phase session being prepared. */
export interface FactorySessionModelContext {
  orgId: string;
  factoryProjectId: string;
  /** The installed board the card is on. */
  board: string;
  /** The phase the session is prepared for; undefined when the card's stage is not a single declared phase. */
  phase: string | undefined;
  /** The role the board seats in that phase, such as `triage`, `plan`, `work` or `review` on the built-in boards. */
  role: string;
  /**
   * The card the session works on: its stored row, or the create input of a
   * card that does not exist yet. Source-tracked cards carry their labels in
   * `metadata.labels`.
   */
  workItem: WorkItemRow | CreateWorkItemInput;
  /** The card this one was opened from, such as the issue behind a pull request the Factory opened. */
  parentWorkItem: WorkItemRow | null;
  /** The Factory project's default model; what the session starts on when the resolver chooses none. */
  defaultModelId: string | undefined;
  /** The scope this run resolves its model and credentials from. A choice only applies under `factory`. */
  modelScope: EffectiveModelScope;
}

/** A model and thinking level for one phase session. Leave a field out to keep the Factory's default. */
export interface FactorySessionModelChoice {
  modelId?: string;
  thinking?: ThinkingLevelSetting;
}

/**
 * Chooses the model and thinking level a phase session runs on, each time the
 * Factory prepares one. `undefined` keeps the Factory's defaults.
 */
export type FactorySessionModelResolver = (
  context: FactorySessionModelContext,
) => FactorySessionModelChoice | undefined | Promise<FactorySessionModelChoice | undefined>;

export interface ResolvedPhaseSessionModel {
  /** The model the session starts on; undefined keeps the scoped default. */
  modelId: string | undefined;
  /** The thinking level the session's runs use; undefined keeps the Factory's stored default. */
  thinking: ThinkingLevelSetting | undefined;
}

const NONE: ResolvedPhaseSessionModel = { modelId: undefined, thinking: undefined };

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Choose the model and thinking level for a phase session: the rule decision's
 * own fields first, then the host's resolver, then the Factory's defaults.
 *
 * A choice applies only when the run resolves to the Factory's model scope. Under
 * the owner's scope it is dropped with a log line: it could name a model the
 * owner holds no credentials for, and the run would fail on provider auth. A
 * resolver that throws, or a level the chosen model cannot run at, falls back to
 * the defaults with a warning; a bad policy never stops a run.
 */
export async function resolvePhaseSessionModel(args: {
  context: FactorySessionModelContext;
  /** The decision's own choice, already validated. */
  decision?: FactorySessionModelChoice;
  resolver?: FactorySessionModelResolver;
}): Promise<ResolvedPhaseSessionModel> {
  const { context, decision, resolver } = args;
  const decided: FactorySessionModelChoice = {
    ...(nonEmpty(decision?.modelId) ? { modelId: nonEmpty(decision?.modelId) } : {}),
    ...(isThinkingLevelSetting(decision?.thinking) ? { thinking: decision.thinking } : {}),
  };
  const inPlay = Boolean(decided.modelId || decided.thinking || resolver);
  if (!inPlay) return NONE;
  if (context.modelScope !== 'factory') {
    console.info("[Factory Start] Phase model choice ignored: the run uses the session owner's model scope", {
      factoryProjectId: context.factoryProjectId,
      board: context.board,
      phase: context.phase,
      role: context.role,
    });
    return NONE;
  }

  let resolved: FactorySessionModelChoice | undefined;
  // The resolver only fills what the decision left open.
  if (resolver && !(decided.modelId && decided.thinking)) {
    try {
      resolved = (await resolver(context)) ?? undefined;
    } catch (error) {
      console.warn('[Factory Start] Session model resolver failed; using the Factory defaults', {
        factoryProjectId: context.factoryProjectId,
        board: context.board,
        phase: context.phase,
        role: context.role,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const resolvedThinking = resolved?.thinking;
  if (resolvedThinking !== undefined && !isThinkingLevelSetting(resolvedThinking)) {
    console.warn(
      '[Factory Start] Session model resolver returned an unknown thinking level; using the Factory default',
      {
        thinking: resolvedThinking,
        role: context.role,
      },
    );
  }

  const modelId = decided.modelId ?? nonEmpty(resolved?.modelId);
  const thinking = decided.thinking ?? (isThinkingLevelSetting(resolvedThinking) ? resolvedThinking : undefined);
  const runModelId = modelId ?? context.defaultModelId;
  if (thinking && runModelId) {
    const available = getAvailableThinkingLevelsForModel(runModelId, getModelReasoningOptions(runModelId));
    if (!available.includes(thinking)) {
      console.warn('[Factory Start] Phase thinking level is not available on the model; using the Factory default', {
        modelId: runModelId,
        thinking,
        available,
        role: context.role,
      });
      return { modelId, thinking: undefined };
    }
  }
  return { modelId, thinking };
}
