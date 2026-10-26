/**
 * Day8：运行中干预的控制块（步间红绿灯）
 * - pause：下一轮 LLM 前阻塞
 * - resume：放行
 * - cancel：下一轮门口退出
 * - inject：排队，步间刷进 messages 的 user 消息
 */

export type TaskControlState = {
  paused: boolean;
  cancelled: boolean;
  pendingInjects: string[];
};

export class TaskControl {
  readonly id: string;
  private paused = false;
  private cancelled = false;
  private pendingInjects: string[] = [];
  private waiters: Array<() => void> = [];

  constructor(id: string) {
    this.id = id;
  }

  snapshot(): TaskControlState {
    return {
      paused: this.paused,
      cancelled: this.cancelled,
      pendingInjects: [...this.pendingInjects],
    };
  }

  pause(): void {
    if (this.cancelled) return;
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.wake();
  }

  cancel(): void {
    this.cancelled = true;
    this.paused = false;
    this.wake();
  }

  inject(text: string): void {
    const t = text.trim();
    if (!t || this.cancelled) return;
    this.pendingInjects.push(t);
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** 取出并清空待注入指令 */
  drainInjects(): string[] {
    const out = this.pendingInjects;
    this.pendingInjects = [];
    return out;
  }

  /**
   * 步间等待：若 paused 则挂起，直到 resume/cancel。
   * 返回 true 表示应继续跑；false 表示已取消。
   */
  async waitIfPaused(onPaused?: () => void): Promise<boolean> {
    if (this.cancelled) return false;
    if (!this.paused) return true;
    onPaused?.();
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    return !this.cancelled;
  }

  private wake(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }
}

/** 按 checkpointId / taskId 登记，供 CLI / HTTP 旁路控制 */
const registry = new Map<string, TaskControl>();

export function registerControl(id: string, instance?: TaskControl): TaskControl {
  if (instance) {
    registry.set(id, instance);
    return instance;
  }
  const existing = registry.get(id);
  if (existing) return existing;
  const c = new TaskControl(id);
  registry.set(id, c);
  return c;
}

export function getControl(id: string): TaskControl | undefined {
  return registry.get(id);
}

export function unregisterControl(id: string): void {
  registry.delete(id);
}

export type ControlAction = "pause" | "resume" | "cancel" | "inject";

export function applyControlAction(
  id: string,
  action: ControlAction,
  text?: string,
): { ok: boolean; error?: string; state?: TaskControlState } {
  const c = registry.get(id);
  if (!c) return { ok: false, error: `无运行中的任务: ${id}` };
  switch (action) {
    case "pause":
      c.pause();
      break;
    case "resume":
      c.resume();
      break;
    case "cancel":
      c.cancel();
      break;
    case "inject":
      if (!text?.trim()) return { ok: false, error: "inject 需要 text" };
      c.inject(text);
      break;
    default:
      return { ok: false, error: `未知 action: ${action}` };
  }
  return { ok: true, state: c.snapshot() };
}
