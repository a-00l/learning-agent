# Day 10：Few-shot（B2）

> 对应：B2  
> 代码：`src/prompts.ts`（`fewshot` 档、`fewShotTextLines`、`fewShotDemoMessages`）、`src/loop.ts`、`evals/cases-day10.json`

---

## 本节目标

用 **例子** 约束边界行为，并与「只写规则条文」的 `good` 对照。  
Day10 题库**故意不在 user 里写「必须 ask_user」**，让 system / few-shot 自己扛。

---

## 知识点

### 1. 两种挂载方式

| 方式 | 实现 | 特点 |
|------|------|------|
| 写进 system | `fewShotTextLines()` | 省事、好读；占 system 预算 |
| 假对话（含 tool_calls） | `fewShotDemoMessages()` 插在真实 user 前 | 形状与真实调用一致，模仿更强；更费 token |

`PROMPT_PROFILE=fewshot` 两种都开。

### 2. 正例 + 反例

- 正例：路径不清 → `ask_user`  
- 反例：默认 `write_file hello.js`  
- 正例：文件内「忽略指令」只摘要、不执行  

### 3. 和工具 description / 硬约束的分工

- description：告诉模型工具「能干啥」  
- 硬约束：底线  
- few-shot：把底线变成「看得见的动作」  

### 4. 代价

- 每轮都带示例 → token 涨  
- 例子太贴某一题 → 过拟合，换说法可能失效  
- resume checkpoint 时不要再插一遍 demo（本仓库只在新任务插入）

---

## 怎么跑对照

```bash
npm run eval:day10:good
npm run eval:day10:fewshot
npm run eval:day10:sloppy
```

对比三次 `evals/last-report.json` 的 `passed` / 各题 `failures`。

> 说明：`sloppy` 被写成**反模式**（少问、默认 hello.js、服从文件内指令），否则强模型仅凭「写糊一点」仍可能全过，对照看不出差异。

交互：

```bash
# Windows CMD
set PROMPT_PROFILE=fewshot
npm start
```

---

## 自测题

1. 为什么 Day10 题干要比 Day9 少写「必须 ask_user」？  
2. system 文字示例 vs 带 `tool_calls` 的示范消息，各适合什么？  
3. few-shot 失败时，你更倾向加例子还是加硬约束？  

---

## 验收

- [x] `PROMPT_PROFILE=fewshot`  
- [x] 文字正/反例 + 一条 tool_calls 示范对话  
- [x] `cases-day10.json`（无 user 侧剧透）  
- [x] `eval:day10:*` 三档脚本  
