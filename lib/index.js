// Host-side entry for @dsh-external/dsh-provider-order.
//
// 需求：在 设置→模型 列表里用鼠标拖动各模型商(provider)的顺序，并且
// 输入框下方「选择模型」展开菜单里的模型商分组顺序同步跟随该顺序。
//
// 架构（DSH 0.3.9 实测定位）：
//   - 设置→模型列表数据 = dsh-host-apiproxy `llm.providers`：
//       directory(listConfigurableProviders) 先序 + 追加无 settingsNs 的 live provider
//   - 模型选择器分组数据 = `session.models` / `llm.models` → buildModelCatalog：
//       ctx.llm.listProviders()（adapters Map 插入序）生成 groups
//   - 两个数据源最终都来自 LlmRuntime 的两个公开 Map：
//       ctx.llm.adapters（key=provider id）、ctx.llm.directory（key=provider id）
//   - 因此只要按用户顺序重排这两个 Map 的插入顺序（JS Map 保序），并触发
//     `llm/adapters-updated`，两个 UI 会同时跟随新顺序（二者都订阅了该事件）。
//
// 持久化：settings 命名空间 `provider-order` 的 `order: string[]`（provider id
// 数组）。客户端拖拽 → PUT /dsh-provider-order/order（本插件 webServer 路由，
// host 侧直接写 settings.yaml）→ 本插件 watch 重排两个 Map。
// 重启后：插件 apply 时读取 order 并重排（llm/adapters-updated 兜底）。
//
// 不依赖 dsh-host-apiproxy 的 WEB_SETTINGS_NAMESPACES 白名单：客户端读写不经
// settings wire（无需暴露命名空间），host 侧 registration.get/update 直读写文件。
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

const name = "@dsh-external/dsh-provider-order";
const inject = ["llm", "settings", "webServer"];

const NS = settingsNamespace("provider-order");

const Config = z.object({});

// 基线（自然顺序）：首次看到非空 Map 时记录，供「重置顺序」恢复默认。
let baselineAdapters = null;
let baselineDirectory = null;

function apply(ctx, config) {
  let registration;
  try {
    registration = ctx.settings.register(
      NS,
      z.object({
        order: z.array(z.string()).default([]),
      }),
    );
  } catch (error) {
    console.warn(
      "[" + name + "] settings namespace unavailable: " +
        ((error && error.message) || error),
    );
    return;
  }

  const currentOrder = () => {
    try {
      const value = registration.get();
      const order = value && value.order;
      return Array.isArray(order)
        ? order.filter((id) => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  };

  // 按给定 id 序重建一个 Map（未列出 key 追加末尾，保持值对象不变）。
  // 原地 clear+重设：Map 实例不变，外部对实例的引用不受影响。
  const reorderMap = (map, ids) => {
    const keys = [...map.keys()];
    if (keys.length === 0) return false;
    const seen = new Set();
    const ordered = [];
    for (const id of ids) {
      if (map.has(id) && !seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    }
    for (const key of keys) {
      if (!seen.has(key)) {
        ordered.push(key);
        seen.add(key);
      }
    }
    if (ordered.length !== keys.length) return false;
    let changed = false;
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i] !== keys[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    const next = new Map();
    for (const key of ordered) next.set(key, map.get(key));
    map.clear();
    for (const [key, value] of next) map.set(key, value);
    return true;
  };

  const captureBaseline = () => {
    if (baselineAdapters === null && ctx.llm.adapters.size > 0) {
      baselineAdapters = [...ctx.llm.adapters.keys()];
    }
    if (baselineDirectory === null && ctx.llm.directory.size > 0) {
      baselineDirectory = [...ctx.llm.directory.keys()];
    }
  };

  // 应用顺序：order 非空按用户序重排；order 为空（重置）恢复基线。
  // 返回是否真的发生了变化（供 emit 保底刷新，避免事件循环）。
  const applyOrder = () => {
    captureBaseline();
    const ids = currentOrder();
    if (ids.length === 0) {
      if (baselineAdapters === null && baselineDirectory === null) return false;
      const a =
        baselineAdapters !== null
          ? reorderMap(ctx.llm.adapters, baselineAdapters)
          : false;
      const d =
        baselineDirectory !== null
          ? reorderMap(ctx.llm.directory, baselineDirectory)
          : false;
      return a || d;
    }
    const a = reorderMap(ctx.llm.adapters, ids);
    const d = reorderMap(ctx.llm.directory, ids);
    return a || d;
  };

  // 启动时应用一次（maps 可能尚未填充，后续由 adapters-updated 兜底）。
  applyOrder();

  // 用户拖动排序 → settings 变更 → 重排 + 发事件保底刷新两处 UI。
  // watch 回调异步（Promise 链）执行，此处额外 emit llm/adapters-updated
  // 保证客户端在任何一次 stale 刷新后都收到新顺序。
  const offWatch = registration.watch(() => {
    if (applyOrder()) {
      try {
        ctx.llm.emitAdaptersUpdated();
      } catch (_) {}
    }
  });

  // provider 增删/拓扑变化 → 保持顺序（新 provider 追加末尾）。
  const offAdapters = ctx.on("llm/adapters-updated", () => {
    if (applyOrder()) {
      try {
        ctx.llm.emitAdaptersUpdated();
      } catch (_) {}
    }
  });

  // 客户端持久化通道：PUT /dsh-provider-order/order {order: string[]}。
  // 不经过 settings wire（无需 apiproxy 白名单），host 侧直写 settings.yaml，
  // registration.watch 自动触发重排 + llm/adapters-updated 广播。
  const webServer = ctx.get("webServer");
  if (webServer && typeof webServer.register === "function") {
    const readBody = (req) =>
      new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
      });
    const sendJson = (res, code, body) => {
      try {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
      } catch (_) {}
    };
    ctx.effect(
      () =>
        webServer.register({
          kind: "exact",
          path: "/dsh-provider-order/order",
          handler: async (req, res) => {
            try {
              if (req.method === "GET") {
                return sendJson(res, 200, { ok: true, order: currentOrder() });
              }
              if (req.method !== "PUT") {
                return sendJson(res, 405, { ok: false, error: "仅支持 GET/PUT" });
              }
              const body = await readBody(req);
              let parsed;
              try {
                parsed = JSON.parse(body);
              } catch (_) {
                return sendJson(res, 400, { ok: false, error: "请求体不是合法 JSON" });
              }
              const order = parsed && parsed.order;
              if (!Array.isArray(order) || !order.every((id) => typeof id === "string")) {
                return sendJson(res, 400, { ok: false, error: "order 必须是 string[]" });
              }
              await registration.update({ order });
              sendJson(res, 200, { ok: true, order: currentOrder() });
            } catch (error) {
              sendJson(res, 500, {
                ok: false,
                error: String((error && error.message) || error),
              });
            }
          },
        }),
      name + ": provider order route",
    );
  }

  ctx.logger?.info?.(
    "[" + name + "] provider order plugin active (namespace=" + NS + ")",
  );

  return () => {
    offWatch?.();
    offAdapters?.();
  };
}

export { Config, apply, inject, name };
