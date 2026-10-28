import type { ToolDefinition } from "../types.js";
import { toolError, toolJson } from "./workspace.js";

export const askUserToolDef: ToolDefinition = {
  type: "function",
  function: {
    name: "ask_user",
    description:
      "向用户提问并等待回答。" +
      "适用：路径/目标不清（「那个文件」）、二选一决策、缺少关键参数。" +
      "不适用：闲聊、已经能用工具直接查清的事实问题。" +
      "缺信息时必须先 ask_user，禁止猜测路径后直接 write_file。",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "一个具体问题；可列出选项让用户回复编号或关键词",
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
