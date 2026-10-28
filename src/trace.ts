import fs from "node:fs/promises";
import path from "node:path";

export type TraceEventKind = "llm" | "tool" | "deny" | "trim" | "error";

export type TraceEvent = {
  t: string;
  step: number;
  kind: TraceEventKind;
  detail: string;
  tool?: string;
  argsSummary?: unknown;
  resultSummary?: string;
  contextChars?: number;
  trim?: {
    beforeChars: number;
    afterChars: number;
    truncatedToolMessages: number;
    droppedMessages: number;
    summarized?: boolean;
  };
};

export type TraceMeta = {
  workspace: string;
  model: string;
  userText: string;
  tracesDir: string;
};

export type TraceResult = {
  reply: string;
  steps: number;
  hitStepLimit: boolean;
  rulesLoaded: boolean;
  trimEvents: number;
};

/** 截断长文本，避免把 big.txt 整份写进 trace */
export function summarizeText(text: string, max = 400): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `…[truncated, original_chars=${text.length}]`;
}

function stampId(d = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `-${pad(d.getMilliseconds(), 3)}`
  );
}

/**
 * H1：一次用户问题 = 一条轨迹（旁路记录，不改变 Agent 决策）。
 */
export class TraceRecorder {
  readonly id: string;
  readonly filePath: string;
  private readonly startedAt: string;
  private readonly meta: TraceMeta;
  private readonly events: TraceEvent[] = [];

  constructor(meta: TraceMeta) {
    this.meta = meta;
    this.startedAt = new Date().toISOString();
    this.id = stampId();
    this.filePath = path.join(meta.tracesDir, `${this.id}.json`);
  }

  record(event: Omit<TraceEvent, "t"> & { t?: string }): void {
    this.events.push({
      ...event,
      t: event.t ?? new Date().toISOString(),
    });
  }

  async finish(result: TraceResult): Promise<string> {
    await fs.mkdir(this.meta.tracesDir, { recursive: true });
    const payload = {
      id: this.id,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      workspace: this.meta.workspace,
      model: this.meta.model,
      userText: this.meta.userText,
      events: this.events,
      result,
    };
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
    return this.filePath;
  }
}

/** 终端快速回放：只打印时间线，不跑 Agent */
export async function printTraceFile(filePath: string): Promise<void> {
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw) as {
    id: string;
    userText: string;
    model: string;
    workspace: string;
    events: TraceEvent[];
    result?: TraceResult;
  };

  console.log(`trace ${data.id}`);
  console.log(`model: ${data.model}`);
  console.log(`workspace: ${data.workspace}`);
  console.log(`user: ${data.userText}`);
  console.log("--- events ---");
  for (const e of data.events) {
    const extra =
      e.kind === "tool" && e.tool
        ? ` ${e.tool}${e.resultSummary ? ` → ${summarizeText(e.resultSummary, 120)}` : ""}`
        : "";
    console.log(`  [${e.kind}] step=${e.step} ${e.detail}${extra}`);
  }
  if (data.result) {
    console.log("--- result ---");
    console.log(`  steps=${data.result.steps} trims=${data.result.trimEvents}`);
    console.log(`  reply: ${summarizeText(data.result.reply, 300)}`);
  }
}
