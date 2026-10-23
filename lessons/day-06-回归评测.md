# Day 6：最小回归评测（H1.2 / H1.3）

> 对应学习路径：H1.2、H1.3（起步）  
> 代码：`evals/cases.json`、`src/eval.ts`、`playground/eval_probe.js`

---

## 本节目标

有了 Trace 之后，用 **固定考题 + 自动判定** 做最小回归：改 prompt/工具后跑一遍，看是变好还是变坏。

---

## 知识点

### 1. 评测 ≠ 再聊一次天

| 聊天 | 评测 |
|------|------|
| 主观感觉「还行」 | 对同一批题，可重复跑 |
| 无标准 | 期望工具 / 禁止工具 / 回复关键字 |
| 人盯终端 | `PASS/FAIL` + 报告文件 |

### 2. 判定从 Trace 来（单步感）

- 从 events 里抽出 `kind === "tool"` 的工具名  
- `tools_any_of` / `tools_all_of` / `tools_none_of`  
- `reply_includes_any`：最终回复是否提到关键信息  

这就是 H1.2 的极简版：**不看模型内心独白，看它实际调了啥**。

### 3. 只读题 vs 写题

- 只读题：`onApprove = () => false` —— 万一模型乱写，直接拒绝  
- 写题：`auto_approve: true` —— 无人值守才能跑 CI  

### 4. 旁路仍是旁路

`eval.ts` 复用 `runAgentLoop` + `TraceRecorder`，不改工具实现。  
失败时打开对应 `trace=` 路径回放。

---

## 怎么跑

```bash
cd mini-cursor
npm run eval
```

报告：`evals/last-report.json`（已 gitignore）。

---

## 建议练习

1. 跑通 4 道题，看 PASS/FAIL  
2. 故意把某工具 description 改糊，再 eval，观察是否变红  
3. 在 `cases.json` 加一道自己的只读题  

---

## 自测题

1. 为什么用 Trace 里的 tool 事件做判定，而不是解析最终 reply 猜「有没有读文件」？  
2. 只读题把 `onApprove` 设为始终 `false`，对「模型调用了 write 但被拒」的 `tools_none_of` 判定有何影响？  
3. 这套评测的盲区是什么？（例如：调对工具但参数完全错）  

---

## 验收标准

- [x] `evals/cases.json` 至少 3 道固定题  
- [x] `npm run eval` 输出每题 PASS/FAIL 与合计  
- [x] 写出 `last-report.json`  
- [x] 写操作题可自动批准  

---

## 和下节的衔接

可加深：参数级断言、黄金轨迹对比、或转去做 **Checkpoint（G3/M5）**。
