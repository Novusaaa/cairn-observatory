# Agent 事件接入指南

[← 返回 Cairn](../README.md) · [实现与边界](architecture.md)

Cairn 接收你的 Agent 后端产生的事件。把现有日志或回调映射到下面的结构，就可以复用同一套网络、事件环、输出流与数据视图。

## 先验证传输链路

```bash
npm start
```

在另一个终端运行：

```bash
npm run demo:sse
```

打开 `http://127.0.0.1:4173`，点击顶部 `SIMULATION`，选择 **Server-Sent Events**，填写 `http://localhost:8788/events`，点击 **Start observing**。

这个独立服务每 150 ms 发送一条测试事件，用来检查连接和字段映射。接入真实运行时，替换成你自己的事件源。

## 统一事件结构

```json
{
  "eventId": "evt-0001",
  "agentId": "researcher-01",
  "agentName": "Researcher 01",
  "type": "tool_result",
  "targetAgent": "analyst",
  "tool": "arxiv.search",
  "tokens": 1240,
  "latencyMs": 180,
  "status": "success",
  "content": "12 papers returned · 4 relevant sources",
  "timestamp": "2026-10-22T00:00:00.000Z"
}
```

`timestamp` 应填写事件发生时间；上面的值用于展示格式。实时图表按这个时间定位事件，未提供时使用接收时的当前时间。

| 字段 | 必填 | 含义与默认值 |
| :-- | :--: | :-- |
| `eventId` | 是 | 稳定、唯一的事件 ID，用于去重 |
| `agentId` | 是 | Agent 的稳定标识，映射为网络节点 |
| `agentName` | 否 | 显示名称，默认使用 `agentId` |
| `type` | 是 | 事件类型，决定主要的可视化行为 |
| `targetAgent` | 否 | 接收方 Agent ID，默认空字符串 |
| `tool` | 否 | 工具名称；子任务事件中也用作稳定任务标识 |
| `tokens` | 否 | 本次事件的 Token 数，非负，默认 `0` |
| `latencyMs` | 否 | 本次操作延迟，单位毫秒，非负，默认 `0` |
| `status` | 否 | 状态，默认 `running` |
| `content` | 否 | 事件内容；对象会转换为 JSON 文本，最多保留 6,000 个字符 |
| `timestamp` | 否 | ISO 时间字符串或毫秒时间戳，默认当前时间 |

`eventId`、`agentId`、`type` 缺失，时间无效，或数值字段为负数、非有限数时，事件会被忽略。额外字段不会进入固定结构。

## 事件如何映射到画面

| 事件或字段 | 画面中的变化 |
| :-- | :-- |
| `agentId` | 创建或更新 Agent 节点 |
| `targetAgent` | 创建消息关系，计入转交矩阵 |
| `tool` | 创建工具节点和关联连线 |
| `tool_call` | 高亮活动、写入日志与工具执行跨度 |
| `tool_result` / `output` | 触发水平输出光束，更新最新返回内容 |
| `output`，或工具名包含 `python` / `code` / `exec` 的返回 | 更新 CODE 视图 |
| `tokens` | 更新累计用量、每秒 Token 柱、连线权重和信号密度 |
| `latencyMs` | 更新延迟轨迹与执行耗时信息 |
| `status` | 更新 Agent 状态与事件标识 |
| `subtask` | 使用 `tool` 作为稳定任务标识，更新子任务节点和列表 |
| `paper` | 将 `content` 记入研究来源索引 |
| `error` 类型或 `error` 状态 | 进入错误列表 |

常用 `type`：`tool_call`、`tool_result`、`message`、`subtask`、`thinking`、`output`、`error`、`agent_start`、`agent_end`、`paper`。

支持的 `status`：`running`、`thinking`、`idle`、`success`、`complete`、`error`、`pending`。未知状态按 `running` 处理。

工具调用和返回尽量使用一致的 `agentId` 与 `tool`，并提供准确时间与耗时，便于执行跨度视图配对。计数中的输入/输出分类遵循事件类型：`tool_result`、`output`、`message` 归入输出，其余归入输入。

## SSE

服务端返回 `Content-Type: text/event-stream`，使用标准的默认 `message` 事件；每条 `data` 是一个 JSON 对象或事件数组，以空行结束。

```text
data: {"eventId":"evt-0001","agentId":"researcher-01","type":"tool_result","tool":"arxiv.search","tokens":1240,"latencyMs":180,"status":"success","content":"12 papers returned"}

```

上例省略了可选时间字段，因此使用接收时的当前时间。也可以添加 SSE 的 `id:` 字段，但应用的去重标识仍来自 JSON 中的 `eventId`。

跨域端点需要正确配置 CORS。SSE 使用浏览器原生重连；仓库中的 `scripts/demo-stream.mjs` 提供了一个可运行示例。

## WebSocket

在数据源入口选择 **WebSocket**，填写你的 `ws://` 或 `wss://` 地址。每条消息发送一个 JSON 事件或事件数组。

HTTPS 页面要求 HTTPS / WSS 端点；本地 HTTP 页面可以连接本地 HTTP / WS。WebSocket 断开后会显示提示，通过数据源入口重新连接。

## 浏览器 API

页面提供 `window.cairn`，可用于已有前端集成或调试。

```js
// 切换到 SSE 数据源，并开始新的本地观察会话。
window.cairn.connect('sse', 'http://localhost:8788/events');

// 向当前会话注入一个事件，也支持事件数组。
window.cairn.ingest({
  eventId: `manual-${Date.now()}`,
  agentId: 'researcher-01',
  agentName: 'Researcher 01',
  type: 'tool_result',
  targetAgent: 'analyst',
  tool: 'arxiv.search',
  tokens: 1240,
  latencyMs: 180,
  status: 'success',
  content: '12 papers returned · 4 relevant sources',
  timestamp: new Date().toISOString(),
});

window.cairn.pause();
window.cairn.resume();
window.cairn.setBudget(5_000_000);

// 查看会话状态，以及保留的固定字段事件。
console.log(window.cairn.state);
console.log(window.cairn.events);

// 清空当前会话，回到模拟数据源。
window.cairn.reset();
```

`ingest()` 只接收当前会话中的事件；默认模拟模式下手动注入的事件会与模拟事件一起展示。暂停期间不接收新事件。达到预算时，先提高预算，再调用 `resume()`。

## 合并、暂停与恢复

- 同一批内按 `agentId / targetAgent / type / tool / status` 合并，累计 Token 与事件数，保留最新内容。
- 最近的 2,000 条记录是**合并事件**。检查器、JSON 导出和 `cairn.events` 使用这个保留窗口。
- 手动、预算或页面隐藏引起的暂停，会停止本地观察并关闭实时连接。暂停期间的事件不缓存、不重放。
- 默认预算为 2M Token，80% 提示，100% 暂停本地消费。远端 Agent 的运行不受影响。

需要无损恢复时，由后端提供持久化、游标和补发机制。完整的队列与渲染上限见 [实现与边界](architecture.md)。
