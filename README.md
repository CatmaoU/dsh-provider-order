# @dsh-external/dsh-provider-order

拖动【设置 → 模型】列表里各个模型商(provider)的顺序，输入框下方「选择模型」展开菜单里的模型商分组顺序同步跟随。

## 原理

- 设置→模型列表 与 模型选择器 的数据最终都来自 host 服务 `llm`（LlmRuntime）的两个公开 Map：`ctx.llm.adapters` 与 `ctx.llm.directory`（key 均为 provider id）。
- 本插件 **自带行内拖拽 UI**（self-contained runtime 增强，不修改任何核心 bundle 文件）：client 半用 MutationObserver 找到设置页模型商行列表（`[class*="_rows"]`，CSS module 哈希变化免疫，不限定 `ul/li` 标签），对其开启原生 HTML5 拖拽；交互元素（输入框/按钮/下拉）上不会误触发。
- 释放后把新行序映射回 provider id（`GET /dsh-provider-order/providers`，host 侧新增路由，返回与设置页渲染顺序一致的全量列表，按 displayName 匹配），再 `PUT /dsh-provider-order/order` 持久化到 settings 命名空间 `provider-order.order: string[]`（`~/.dsh/settings.yaml`）。
- host 侧监听该命名空间变更 → 按序重排两个 Map 的插入顺序 → 广播 `llm/adapters-updated` → 两个 UI 同时刷新为新顺序。
- 重启后自动恢复：插件 apply 时读取已存顺序并重排（`llm/adapters-updated` 事件兜底）。

## 修复记录（2026-08-18）

问题：设置页模型商行完全无法拖拽。

原因：早期实现把行内拖拽 patch 打进核心 bundle
`@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`。该文件改动会随
DSH Desktop 升级/运行源变化而失效——patch 打在 `D:\dsh\resources\app` 内
的 rc.6 副本上，但 Desktop 实际从 agent 目录的 rc.7 原版加载 client bundle，
导致 patch 从未生效（且 rc.6 的 `zjMdl_rowCard` 类名与 rc.7 的 `zGbnIq_rowCard`
也不匹配）。

修复：拖拽 UI 整体移入本插件自身（`lib/client.js` runtime 增强），升级免疫；
host 侧新增 `GET /dsh-provider-order/providers` 供映射。

### 补充（2026-08-18 二次修复）

首次修好后“行仍然完全无法拖动”：`lib/client.js` 只绑定了
`dragstart`/`dragover`/`drop` 等事件，却没有给行设置 HTML5 拖拽必需的
`draggable="true"`，因此 `dragstart` 根本不会触发。

修复：每次 `refresh()` 遇到设置页模型商行列表时，先对所有
`li[class*="_rowCard"]` 设置 `row.draggable = true`（不依赖 providers 接口
成功/快慢），React 重建 li 后也会被重新标记。

### 补充 2（2026-08-18 三次修复）

仍有“无法拖动”反馈：光标已是 grab，但没有拖影、滑动会选中文字。
这说明 CSS 已命中行（`[class*="_rowCard"]`），但 JS 里选择器仍写死
`li[class*="_rowCard"]`，而实际行元素可能是 `div` 等非 `li` 标签，
导致 `draggable` 从未设置到真正的行上。

修复：

- 列表/行选择器全部改为不限定标签：
  `[class*="_rows"]` / `[class*="_rowCard"]` / `[class*="_rowName"]`。
- `mousedown`/`pointerdown` 时强制给目标行设置 `draggable=true`，
  对抗 React 重渲染把 `draggable` 重置回 `false`。
- `drop` 移动行时兼容行带 wrapper 的 DOM 结构，不再假定行是列表直接子元素。
- providers 接口暂时失败时也照常绑定拖拽事件（保存映射失败只告警不阻塞拖动）。

## 新增功能（v0.2.0）

### 设置面板导航栏自动滚动

问题：当安装大量插件后，设置页左侧导航栏（通用设置、模型、插件、Agent 预设、记忆系统、对话管理、快照、插件市场、文件拖入、文件提及、通知、自定义提示词、WSL 后端、第三方模型思考、归档对话管理、侧边临时会话、Skill 调度器等）会超出容器高度，但无法下滑查看。

修复：`lib/client.js` 新增 `setupSettingsScroll()` 函数，通过 MutationObserver 动态检测：

1. **自动检测**：读取设置面板导航容器的 `clientHeight` 和 `scrollHeight`
2. **自动适配**：当内容高度 > 容器高度时，自动设置 `overflow-y: auto` + `scrollbar-gutter: stable`
3. **实时响应**：每次 DOM 变化（插件安装/卸载/设置项增删）后重新检测，确保滚动状态始终正确
4. **智能回退**：内容未溢出时保持默认布局，不显示滚动条

CSS 规则（已注入，使用 CSS module 稳定后缀匹配，不依赖 `data-plugin="settings"`）：
```css
[class*="_panel"] > [class*="_nav"] { overflow-y: auto; overflow-x: hidden; min-height: 0; scrollbar-gutter: stable }
[class*="_panel"] > [class*="_nav"] [class*="_navList"] { min-height: 0 }
```

## 已知限制

1. `llm.providers` 视图固定为「directory 条目先、无 settingsNs 的 live provider 追加尾部」。
   若存在仅 live 注册（不在 configurable directory）的模型商，设置页中它的行会一直排在列表尾部，
   但模型选择器（按 adapters 序）会正确跟随拖拽顺序。
2. 重置按钮会把顺序恢复为插件启动时记录的自然顺序（新加入的模型商追加末尾）。
3. 行↔provider 映射按 displayName 匹配；若两个模型商 displayName 完全相同，
   映射取列表中第一个（罕见场景，一般模型商 displayName 唯一）。

## 文件结构

- `lib/index.js` — host 端：注册命名空间、重排两个 Map、事件联动、providers/order 两个路由
- `lib/client.js` — Web 端：自带行内拖拽（DOM 级 runtime 增强）
- `cordis.patch.yml` — bundle 装配 patch（随 bundles 列表在重启后应用）