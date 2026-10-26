import type { ToolDefinition } from "../types.js";
import { toolError, toolJson } from "./workspace.js";

export const askUserToolDef: ToolDefinition = {
  type: "function",
  function: {
    name: "ask_user",
    description:
      "向用户提问并等待回答。用于关键决策、需求不清、或需要用户在几个选项里二选一。不要用它闲聊。",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "要问用户的问题（简洁明确）",
        },
      },
      required: ["question"],
    },
  },
};

export type AskUserFn = (question: string) => Promise<string>;

export async function askUser(
  question: string,
  askFn: AskUserFn | undefined,
): Promise<string> {
  const q = question.trim();
  if (!q) return toolError("question 为空");
  if (!askFn) {
    return toolError("当前运行环境未提供 ask_user 回调（无法向用户提问）");
  }
  try {
    const answer = await askFn(q);
    return toolJson({ ok: true, question: q, answer: answer.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(message);
  }
}
