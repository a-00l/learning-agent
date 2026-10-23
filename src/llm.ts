import type { AssistantTurn, Message, ToolCall, ToolDefinition } from "./types.js";

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export function loadConfig(): LlmConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY。请复制 .env.example 为 .env 并填入密钥。");
  }
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, ""),
    model: process.env.OPENAI_MODEL?.trim() || "deepseek-chat",
  };
}

function buildBody(
  cfg: LlmConfig,
  messages: Message[],
  tools: ToolDefinition[] | undefined,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  return body;
}

/** 非流式一次调用 */
export async function chat(
  messages: Message[],
  tools?: ToolDefinition[],
): Promise<AssistantTurn> {
  const cfg = loadConfig();
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildBody(cfg, messages, tools, false)),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: ToolCall[];
      };
    }>;
  };

  const msg = data.choices?.[0]?.message;
  if (!msg) {
    throw new Error("LLM 返回缺少 choices[0].message");
  }

  return {
    content: msg.content ?? null,
    tool_calls: msg.tool_calls ?? [],
  };
}

export type ChatStreamHandlers = {
  /** 文本 delta（打字机）；tool_calls 组装期间可能没有文本 */
  onToken?: (delta: string) => void;
};

/**
 * OpenAI 兼容 SSE 流式调用：边收边拼 content / tool_calls，最后返回完整 AssistantTurn。
 */
export async function chatStream(
  messages: Message[],
  tools?: ToolDefinition[],
  handlers: ChatStreamHandlers = {},
): Promise<AssistantTurn> {
  const cfg = loadConfig();
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(buildBody(cfg, messages, tools, true)),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let content = "";
  // index → partial tool call
  const toolMap = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    let json: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }

    const delta = json.choices?.[0]?.delta;
    if (!delta) return;

    if (delta.content) {
      content += delta.content;
      handlers.onToken?.(delta.content);
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const cur = toolMap.get(idx) ?? { id: "", name: "", arguments: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        toolMap.set(idx, cur);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const line of parts) flushLine(line);
  }
  if (buffer.trim()) flushLine(buffer);

  const tool_calls: ToolCall[] = [...toolMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => ({
      id: t.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: "function" as const,
      function: { name: t.name, arguments: t.arguments },
    }))
    .filter((t) => t.function.name);

  return {
    content: content || null,
    tool_calls,
  };
}

export function appendAssistant(messages: Message[], turn: AssistantTurn): void {
  messages.push({
    role: "assistant",
    content: turn.content,
    ...(turn.tool_calls.length ? { tool_calls: turn.tool_calls } : {}),
  });
}

export function appendToolResult(
  messages: Message[],
  toolCallId: string,
  name: string,
  result: string,
): void {
  messages.push({
    role: "tool",
    tool_call_id: toolCallId,
    name,
    content: result,
  });
}
