import fs from "node:fs/promises";
import path from "node:path";
import type { Message } from "./types.js";

export type CheckpointStatus = "running" | "done" | "failed" | "cancelled";

/** 可恢复状态：核心是 messages，不是往 user prompt 里贴摘要 */
export type Checkpoint = {
  id: string;
  status: CheckpointStatus;
  workspace: string;
  userText: string;
  steps: number;
  trimEvents: number;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  error?: string;
};

function stampId(d = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `cp-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `-${pad(d.getMilliseconds(), 3)}`
  );
}

export function newCheckpointId(): string {
  return stampId();
}

export class CheckpointStore {
  constructor(readonly dir: string) {}

  filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  async save(cp: Checkpoint): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true });
    const next: Checkpoint = { ...cp, updatedAt: new Date().toISOString() };
    const file = this.filePath(cp.id);
    await fs.writeFile(file, JSON.stringify(next, null, 2), "utf8");
    return file;
  }

  async load(id: string): Promise<Checkpoint> {
    const raw = await fs.readFile(this.filePath(id), "utf8");
    return JSON.parse(raw) as Checkpoint;
  }

  async list(): Promise<Array<Pick<Checkpoint, "id" | "status" | "userText" | "steps" | "updatedAt">>> {
    await fs.mkdir(this.dir, { recursive: true });
    const names = await fs.readdir(this.dir);
    const out: Array<Pick<Checkpoint, "id" | "status" | "userText" | "steps" | "updatedAt">> = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const cp = JSON.parse(await fs.readFile(path.join(this.dir, name), "utf8")) as Checkpoint;
        out.push({
          id: cp.id,
          status: cp.status,
          userText: cp.userText,
          steps: cp.steps,
          updatedAt: cp.updatedAt,
        });
      } catch {
        /* skip broken */
      }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }
}
