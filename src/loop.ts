import {
  CheckpointStore,
  newCheckpointId,
  type Checkpoint,
} from "./checkpoint.js";
import {
  TaskControl,
  registerControl,
  unregisterControl,
} from "./control.js";
import { estimateMessagesChars, trimMessages } from "./context.js";
import {
  emptyFacts,
  factsEnabled,
  refreshFacts,
  renderFactsCard,
  upsertFactsMessage,
  type TaskFacts,
} from "./facts.js";
import { appendAssistant, appendToolResult, chatStream } from "./llm.js";
import {
  fewShotDemoMessages,
  profileLoadsProjectRules,
  resolvePromptProfile,
} from "./prompts.js";
import { buildSystemPrompt, loadProjectRules } from "./rules.js";
import {
  TOOLS_NEED_APPROVAL,
  approvalSummary,
  type ApproveFn,
} from "./sandbox.js";
import { executeTool, toolDefs } from "./tools/index.js";
import type { AskUserFn } from "./tools/ask_user.js";
import { toolError } from "./tools/workspace.js";
import { summarizeText, type TraceRecorder } from "./trace.js";
import type { Message } from "./types.js";

const MAX_STEPS = 10;

export type LoopResult = {
  reply: string;
  steps: number;
  hitStepLimit: boolean;
  rulesLoaded: boolean;
  trimEvents: number;
  checkpointId?: string;
  cancelled?: boolean;
};

export type LoopOptions = {
  onStep?: (info: {
    step: number;
    kind:
      | "llm"
      | "tool"
      | "deny"
      | "trim"
      | "facts"
      | "checkpoint"
      | "paused"
      | "inject"
      | "cancelled";
    detail: string;
  }) => void;
  onToken?: (delta: string) => void;
  onApprove?: ApproveFn;
  /** ask_user 工具回调 */
  onAskUser?: AskUserFn;
  trace?: TraceRecorder;
  checkpoint?: {
    store: CheckpointStore;
    resumeId?: string;
  };
  /**
   * 运行中干预。不传则自动按 checkpointId 注册一份。
   * 外部可用 getControl(id) / applyControlAction 操作。
   */
  control?: TaskControl;
};

async function persist(
  store: CheckpointStore,
  cp: Checkpoint,
  onStep?: LoopOptions["onStep"],
): Promise<void> {
  const file = await store.save(cp);
  onStep?.({
    step: cp.steps,
    kind: "checkpoint",
    detail: `已保存 ${cp.id} (${cp.status}) → ${file}`,
  });
}

function flushInjects(
  messages: Message[],
  control: TaskControl | undefined,
  step: number,
  onStep?: LoopOptions["onStep"],
): void {
  if (!control) return;
  const injects = control.drainInjects();
  for (const text of injects) {
    messages.push({
      role: "user",
      content: `[运行中指令] ${text}`,
    });
    onStep?.({
      step,
      kind: "inject",
      detail: `已注入: ${text.slice(0, 120)}`,
    });
  }
}

/**
 * Agent Loop：裁剪 + 流式 + Trace + Checkpoint + 步间干预（pause/resume/cancel/inject）
 */
export async function runAgentLoop(
  workspace: string,
  userText: string,
  options: LoopOptions = {},
): Promise<LoopResult> {
  const { onStep, onApprove, onAskUser, onToken, trace, checkpoint } = options;
  const projectRules = await loadProjectRules(workspace);
  const promptProfile = resolvePromptProfile();
  const system = buildSystemPrompt(workspace, projectRules, {
    profile: promptProfile,
  });
  const rulesLoaded =
    Boolean(projectRules) && profileLoadsProjectRules(promptProfile);

  let messages: Message[];
  let steps = 0;
  let trimEvents = 0;
  let cpId: string | undefined;
  let userGoal = userText;
  let createdAt = new Date().toISOString();
  let facts: TaskFacts = emptyFacts(userText);
  const useFacts = factsEnabled();

  if (checkpoint?.resumeId) {
    const loaded = await checkpoint.store.load(checkpoint.resumeId);
    if (loaded.status === "done" || loaded.status === "cancelled") {
      return {
        reply: `(该 checkpoint 状态为 ${loaded.status}，无需续跑)`,
        steps: loaded.steps,
        hitStepLimit: false,
        rulesLoaded,
        trimEvents: loaded.trimEvents,
        checkpointId: loaded.id,
        cancelled: loaded.status === "cancelled",
      };
    }
    cpId = loaded.id;
    userGoal = loaded.userText;
    steps = loaded.steps;
    trimEvents = loaded.trimEvents;
    createdAt = loaded.createdAt;
    facts = loaded.facts ?? emptyFacts(loaded.userText);
    messages = loaded.messages.map((m) => ({ ...m }));
    if (messages[0]?.role === "system") {
      messages[0] = { role: "system", content: system };
    } else {
      messages.unshift({ role: "system", content: system });
    }
    onStep?.({
      step: steps,
      kind: "checkpoint",
      detail: `从 ${cpId} 续跑（已完成 ${steps} 轮）`,
    });
  } else {
    // Day10：fewshot 档在真实任务前插入示范对话（含 tool_calls 形状）
    const demos =
      promptProfile === "fewshot" ? fewShotDemoMessages() : [];
    messages = [
      { role: "system", content: system },
      ...demos,
      { role: "user", content: userText },
    ];
    if (useFacts) {
      facts = emptyFacts(userText);
      messages = upsertFactsMessage(messages, renderFactsCard(facts));
    }
    if (checkpoint) {
      cpId = newCheckpointId();
    }
  }

  // 控制通道 id：优先已有 checkpoint id，便于 CLI/SSE 用同一编号干预
  if (checkpoint && !cpId) cpId = newCheckpointId();
  const publicId = options.control?.id ?? cpId ?? newCheckpointId();
  const control = registerControl(
    publicId,
    options.control ?? new TaskControl(publicId),
  );

  const snap = (status: Checkpoint["status"], error?: string): Checkpoint => ({
    id: cpId!,
    status,
    workspace,
    userText: userGoal,
    steps,
    trimEvents,
    messages: messages.map((m) => ({
      ...m,
      tool_calls: m.tool_calls?.map((c) => ({
        ...c,
        function: { ...c.function },
      })),
    })),
    facts: useFacts ? facts : undefined,
    createdAt,
    updatedAt: new Date().toISOString(),
    error,
  });

  const finishCancelled = async (): Promise<LoopResult> => {
    onStep?.({
      step: steps,
      kind: "cancelled",
      detail: "任务已取消",
    });
    if (checkpoint && cpId) {
      await persist(checkpoint.store, snap("cancelled", "user cancelled"), onStep);
    }
    return {
      reply: "(任务已取消)",
      steps,
      hitStepLimit: false,
      rulesLoaded,
      trimEvents,
      checkpointId: publicId,
      cancelled: true,
    };
  };

  try {
    // 尽早告知控制 id
    onStep?.({
      step: steps,
      kind: "checkpoint",
      detail: `控制通道 id=${publicId}（pause/resume/cancel/inject）`,
    });

    while (steps < MAX_STEPS) {
      // ★ 步间门口：取消 / 暂停 / 注入
      if (control.isCancelled()) {
        return await finishCancelled();
      }
      const ok = await control.waitIfPaused(() => {
        onStep?.({
          step: steps,
          kind: "paused",
          detail: `已暂停 id=${publicId}，等待 resume/cancel`,
        });
      });
      if (!ok || control.isCancelled()) {
        return await finishCancelled();
      }
      flushInjects(messages, control, steps, onStep);

      steps += 1;

      // Day12：先刷新事实卡，再裁剪；裁剪后把卡重新钉回 system 后
      if (useFacts) {
        facts = await refreshFacts(facts, messages);
        messages = upsertFactsMessage(messages, renderFactsCard(facts));
        onStep?.({
          step: steps,
          kind: "facts",
          detail: `事实卡 notes=[${facts.notes.join("; ")}] paths=[${facts.paths.join(", ")}]`,
        });
      }

      const { messages: trimmed, stats } = await trimMessages(messages);
      if (stats.didTrim) {
        trimEvents += 1;
        const mode = stats.summarized
          ? "摘要"
          : stats.droppedMessages > 0
            ? "丢弃"
            : "截断";
        const detail = `上下文裁剪[${mode}] ${stats.beforeChars}→${stats.afterChars} chars（截断 tool=${stats.truncatedToolMessages}, 丢弃消息=${stats.droppedMessages}, summarized=${stats.summarized}）`;
        onStep?.({ step: steps, kind: "trim", detail });
        trace?.record({
          step: steps,
          kind: "trim",
          detail,
          trim: {
            beforeChars: stats.beforeChars,
            afterChars: stats.afterChars,
            truncatedToolMessages: stats.truncatedToolMessages,
            droppedMessages: stats.droppedMessages,
            summarized: stats.summarized,
          },
        });
        messages.length = 0;
        messages.push(...trimmed);
      }

      if (useFacts) {
        messages = upsertFactsMessage(messages, renderFactsCard(facts));
      }

      const contextChars = estimateMessagesChars(messages);
      const llmDetail = `第 ${steps} 轮调用模型…（上下文约 ${contextChars} chars）`;
      onStep?.({ step: steps, kind: "llm", detail: llmDetail });
      trace?.record({
        step: steps,
        kind: "llm",
        detail: llmDetail,
        contextChars,
      });

      const turn = await chatStream(messages, toolDefs, { onToken });
      appendAssistant(messages, turn);

      if (!turn.tool_calls.length) {
        const reply = turn.content?.trim() || "(模型没有返回文本)";
        if (checkpoint && cpId) {
          await persist(checkpoint.store, snap("done"), onStep);
        }
        return {
          reply,
          steps,
          hitStepLimit: false,
          rulesLoaded,
          trimEvents,
          checkpointId: publicId,
        };
      }

      for (const call of turn.tool_calls) {
        if (control.isCancelled()) {
          return await finishCancelled();
        }

        const name = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }

        const logArgs =
          name === "write_file"
            ? {
                path: args.path,
                content: `[${String(args.content ?? "").length} chars]`,
              }
            : name === "ask_user"
              ? { question: args.question }
              : args;

        if (TOOLS_NEED_APPROVAL.has(name) && onApprove) {
          const summary = approvalSummary(name, args);
          const approved = await onApprove({ tool: name, summary, args });
          if (!approved) {
            const denied = toolError(`用户拒绝了操作: ${summary}`);
            const detail = `拒绝 ${name} — ${summary}`;
            onStep?.({ step: steps, kind: "deny", detail });
            trace?.record({
              step: steps,
              kind: "deny",
              detail,
              tool: name,
              argsSummary: logArgs,
            });
            appendToolResult(messages, call.id, name, denied);
            continue;
          }
        }

        const toolDetail = `执行 ${name}(${JSON.stringify(logArgs)})`;
        onStep?.({ step: steps, kind: "tool", detail: toolDetail });

        const result = await executeTool(workspace, name, args, {
          askUser: onAskUser,
        });
        trace?.record({
          step: steps,
          kind: "tool",
          detail: toolDetail,
          tool: name,
          argsSummary: logArgs,
          resultSummary: summarizeText(result, 500),
        });
        appendToolResult(messages, call.id, name, result);
      }

      if (checkpoint && cpId) {
        await persist(checkpoint.store, snap("running"), onStep);
      }
    }

    if (checkpoint && cpId) {
      await persist(checkpoint.store, snap("done"), onStep);
    }
    return {
      reply: `已达到最大步数 ${MAX_STEPS}，停止循环。可缩小问题或提高 MAX_STEPS。`,
      steps,
      hitStepLimit: true,
      rulesLoaded,
      trimEvents,
      checkpointId: publicId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (checkpoint && cpId) {
      await persist(checkpoint.store, snap("failed", message), onStep);
    }
    throw err;
  }   finally {
    unregisterControl(publicId);
  }
}
