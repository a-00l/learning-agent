# Day 3：F1 项目规则 + F2 沙箱审批

> 对应学习路径：F1、F2（部分）  
> 代码：`src/rules.ts`、`src/sandbox.ts`、`src/loop.ts`、`src/cli.ts`、`playground/AGENTS.md`

---

## 本节目标

让 Agent **听话**（项目约定进 system）且 **不敢乱来**（副作用要人批 + 代码门卫）。

---

## 知识点

### 1. AGENTS.md 不是插件，是「每次都在场的文本」

- `rules.ts` 启动时读 `workspace/AGENTS.md`
- 拼进 `system` 消息末尾
- 模型每一轮请求都能看见 → 行为被约束

对照实验：改 `AGENTS.md` 里的日志文案风格，再让它改 `hello.js`，观察输出是否跟着变。

### 2. 规则优先级（你代码里的拼接顺序）

本节约定：

1. 内置系统说明（身份、工具用法）  
2. **项目规则 AGENTS.md**（明确写「优先于用户随意风格偏好」）  
3. 用户本轮话（`user`）

规则靠 **prompt 约束君子**；真正挡事故还要靠沙箱。

### 3. 两道门：策略门卫 vs 人工审批

| 层 | 在哪 | 挡什么 |
|----|------|--------|
| 路径/名单门卫 | `sandbox.ts` → `checkWriteAllowed` / `checkCommandAllowed` | 越界、写 `.env`、写 `AGENTS.md`、黑名单命令 |
| 人工审批 | `loop` + `cli` 的 `onApprove` | `write_file` / `run_terminal` 执行前问 y/N |

只读工具（`read_file` / `grep`）不审批，否则体验太差。

### 4. 拒绝也要回灌给模型

用户按 `N` 时：

```json
{ "ok": false, "error": "用户拒绝了操作: 写入文件 hello.js（…）" }
```

以 `role: tool` 塞回 messages，模型可以改方案或改口询问——**不是静默跳过**。

### 5. 门卫从工具文件抽到 sandbox

Day2 白名单写在 `run_terminal.ts` 里。  
Day3 抽到 `sandbox.ts`，工具只负责「做事」，策略集中在一处，方便以后加「仅允许改 src/」等策略。

---

## 架构增量

```
cli.ts
  ├─ onApprove(y/N) ──────────────┐
  └─ runAgentLoop                 │
         │                        ▼
         ├─ loadProjectRules ──► system 拼 AGENTS.md
         ├─ LLM ↔ tool_calls
         └─ 若 write/terminal：先审批 → 再 executeTool
                                    │
                                    ▼
                              sandbox 检查
                              （禁写名单 / 命令白名单）
```

---

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/rules.ts` | 读 AGENTS.md、拼 system |
| `src/sandbox.ts` | 审批集合、禁写、命令白名单 |
| `src/loop.ts` | 加载规则 + 审批钩子 |
| `src/cli.ts` | 终端里问 `[approve?] … [y/N]` |
| `playground/AGENTS.md` | 示范项目规则 |

---

## 建议练习

1. 正常批准：改 `hello.js` 并 `node` 验证，观察是否遵守 AGENTS.md 文案风格。  
2. 故意拒绝一次写文件：看模型如何反应。  
3. 让它改 `.env` 或 `AGENTS.md`：应被沙箱拒绝（即使你按了 y）。  
4. 临时删掉 / 改名 `AGENTS.md`，看 CLI 结尾 `rules=off`。

---

## 自测题

1. 若只在 prompt 写「不要删文件」、没有白名单，安全吗？为什么？  
2. 用户拒绝 `write_file` 后，messages 里多了什么？loop 会不会直接结束？  
3. 为什么禁止 Agent 改 `AGENTS.md`？（提示：规则自修改）  
4. `onApprove` 不传时行为是什么？适合什么场景？

---

## 验收标准

- [x] 工作区有 `AGENTS.md` 时会进 system，CLI 显示 `rules=on`
- [x] `write_file` / `run_terminal` 前询问 y/N
- [x] 拒绝时以 tool error 回灌，不中断整个 loop
- [x] 禁写 `.env` / `AGENTS.md`；命令白名单集中在 `sandbox.ts`

---

## 和下节的衔接

下一节建议：**D1 上下文裁剪** 或 **H1 trace 落盘**。  
长任务多了之后，没有裁剪会爆窗口，没有 trace 很难调审批/规则是否生效。
