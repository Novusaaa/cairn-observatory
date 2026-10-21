# Cairn

全屏智能体运行观测界面。左侧消息网络、贯穿上下边缘的侧向 SVG 事件环、WebGL 炫彩输出束。底部 4 个数据区通过页签切换 8 类信息。无框架、无构建依赖。

## 本地运行

```powershell
cd D:\CodexProjects\cairn
npm start
```

访问 http://127.0.0.1:4173。默认使用明确标记的模拟研究事件。Space 暂停，R 重启模拟，F 全屏。点击节点、AGENTS 条目或转交矩阵单元可筛选；EVENT TRACE 打开虚拟滚动日志，支持搜索、类型过滤和 JSON 导出。左侧事件带从底部进入，向上滚动，在顶部渐隐；暂停会冻结事件带和主场景。

底部默认视图：TASKS 展示最近 15 秒的工具执行跨度；AGENTS 展示最近 30 秒的 source→target 转交矩阵；CODE 展示工具实际返回，变化行短暂高亮；METRICS 用实际时间戳绘制事件延迟和每秒 Token。悬停任务条、矩阵或延迟点可查看数值。SUBTASKS、ERRORS、PAPER、TOKENS 通过页签切换。装饰性的粒子吸引子、体素及虚构曲面已移除。

## 接入真实 Agent

点击顶部 SIMULATION，选择 WebSocket 或 SSE 并填写地址。每条消息发送一个 JSON 事件或事件数组；SSE 使用标准 `data: {...}\n\n` 的默认 message 事件。跨域 SSE 服务需配置 CORS。HTTPS 托管页使用 HTTPS/WSS 端点；本地 HTTP 预览可以连接本地 HTTP/WS。也可用 `window.cairn.connect('sse', url)` 或 `window.cairn.ingest(event)`。

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
  "timestamp": "2026-10-21T12:00:00.000Z"
}
```

固定字段：eventId、agentId、agentName、type、targetAgent、tool、tokens、latencyMs、status、content、timestamp。eventId、agentId、type 必填；数字字段非负；timestamp 为 ISO 字符串或时间戳，默认当前时间。推荐 type：tool_call / tool_result / message / subtask / thinking / output / error / agent_start / agent_end / paper。status：running / thinking / idle / success / complete / error / pending。工具返回需使用 tool_result 或 output；论文索引事件使用 paper；子任务使用 subtask，通过 tool 字段提供稳定子任务标识。

映射：agentId→节点；targetAgent→消息边和转交矩阵；tool→工具节点；subtask→子任务节点；tokens→边宽、粒子密度与 Token 柱；latencyMs→延迟轨迹；status→文字状态及原始事件；tool_result/output→水平射线。界面、文字、刻度使用黑白高对比，流动特效在蓝、紫、粉、橙、金、白中变化。

```powershell
npm run demo:sse
```

随后在本地页面选择 SSE，连接 `http://localhost:8788/events`，可验证独立服务器的真实推送链路。

## 资源边界

- 每秒最多 30 批视觉更新，批内按 agentId/targetAgent/type/tool/status 合并，累计 tokens 和事件数，保留最新内容。日志导出保留最近 2,000 条合并事件。
- 最多 500 个节点，超出的节点按聚合集群展示；最多 2,500 条边、1,200 个待处理合并键、4,500 条射线、23 个冲击波；eventId 去重窗口 10,000 条。
- 默认 2M Token 预算，80% 告警，100% 自动暂停本地消费；点击 TOKENS 预算文字修改。此功能不会停止远端 Agent。
- 页面隐藏自动暂停本地观察，返回自动恢复。手动/预算暂停会关闭实时连接；暂停期间的数据不缓存、不重放。生产接入若需要无损恢复，请由服务端实现持久化和游标补发。
- SSE 采用浏览器原生重连；WebSocket 断开在顶部提示，可通过数据源入口重连。原始 HTML 不会执行；输入文本按数据处理。

## 验证

`npm run check` 检查语法；`npm test` 验证固定 schema、去重与合并、30Hz 更新上限、500 节点聚合、内存上界及 Token 自动暂停。

## 设计与实现

以用户提供的 1920×1080、约 16 秒视频为构图参考：左侧连线汇入侧向巨大圆环，文字块沿弧面转动，右侧高速平行输出，底部贴合主场景。背景 #050508、文字与刻度 #fff；流动信号随机炫彩。界面用 Segoe UI，数字用 Bahnschrift，原始代码与字节矩阵使用等宽字体；无远程字体依赖。底部默认 4 区、每区 2 个页签；≤800px 调整为 2 列，≤520px 改为单列，避免压缩文字。

网络、执行跨度、路由矩阵和事件冲击波使用 Canvas，事件文字环使用 SVG；数千条射线使用小型 WebGL 着色器一次提交绘制，支持 Canvas 回退。GPU 输出替换了逐条创建渐变的实现，避免高密度输出卡顿。设备像素比上限 1.25；网络物理计算约 30Hz，300 节点以上约 15Hz；场景由 requestAnimationFrame 渲染。reduced-motion 停止环转动、射线与冲击波，事件数据照常更新。支持键盘焦点、原生模态框、页签方向键、纯文本事件检查器和图形文字说明。
