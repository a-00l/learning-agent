/** Chat / Tool Calling 共用类型（对齐 OpenAI Chat Completions 形状） */

export type Role = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON 字符串 */
    arguments: string;
  };
};

export type Message = {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** 一轮 LLM 调用的结果（可能带文本，也可能带 tool_calls） */
export type AssistantTurn = {
  content: string | null;
  tool_calls: ToolCall[];
};
