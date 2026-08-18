// Browser half of @dsh-external/dsh-provider-order.
//
// 拖拽增强（self-contained，不再依赖修改核心 bundle 文件）。
//
// 历史：早期实现把行内拖拽 patch 打进核心 bundle
// @deepseek-ai/dsh-client-ui-settings-models/lib/client.js。该文件改动会随
// DSH Desktop 升级/运行源变化而失效（patch 打在 app 资源内 rc.6 副本，但
// Desktop 实际从 agent 目录的 rc.7 原版加载），导致「设置 → 模型」页模型商
// 行完全无法拖拽。
//
// 本 client 半自己实现原生 HTML5 拖拽（升级免疫）：
//   1. MutationObserver 监听设置页模型商行列表出现（ul[class*="_rows"]），
//      React 重渲染后自动重新绑定，无需改动核心 bundle 任何文件。
//   2. 行（li[class*="_rowCard"]）开启 draggable；在 input/button/select/
//      textarea/链接 等交互元素上按下不会误触发拖拽。
//   3. 释放后把新行序映射回 provider id：GET /dsh-provider-order/providers
//      （host 侧新增路由，返回与设置页渲染顺序一致的全量列表）按 displayName
//      匹配；然后 PUT /dsh-provider-order/order 持久化。host 侧重排
//      LlmRuntime 的 adapters/directory 两个 Map 并广播 llm/adapters-updated，
//      设置列表与输入框下方模型选择器同步跟随新顺序。
//
// 兼容性：CSS module 类名哈希随构建变化，这里用稳定的语义后缀
// （"_rows" / "_rowCard" / "_rowName"）做属性选择器匹配。

(function () {
  const CSS_TAG = "@dsh-external/dsh-provider-order/dnd.css";
  const CSS = [
    '[class*="_rowCard"]{cursor:grab}',
    '[class*="_rowCard"].dpo-dragging{opacity:.45}',
    '[class*="_rowCard"].dpo-over{border-color:var(--dsw-alias-brand-primary,#3964fe);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#3964fe)}',
    '[class*="_rowCard"] input,[class*="_rowCard"] button,[class*="_rowCard"] select,[class*="_rowCard"] textarea{cursor:auto}',
  ].join("");

  function injectCss() {
    if (typeof document === "undefined") return;
    if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]')) return;
    const tag = document.createElement("style");
    tag.dataset.plugin = "@dsh-external/dsh-provider-order";
    tag.dataset.pluginCss = CSS_TAG;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }

  function fetchJson(url, options) {
    return fetch(url, options || {}).then(
      (response) => response.json().catch(() => ({})),
    );
  }

  function rowCardsOf(ul) {
    return Array.prototype.slice.call(ul.querySelectorAll('li[class*="_rowCard"]'));
  }

  // 用行内 displayName 文本匹配 providers 列表，取回 provider id。
  function providerIdOf(row, providers) {
    const nameEl = row.querySelector('[class*="_rowName"]');
    if (!nameEl) return null;
    const name = (nameEl.textContent || "").trim();
    if (!name) return null;
    for (let i = 0; i < providers.length; i++) {
      if (providers[i].displayName === name) return providers[i].provider;
    }
    return null;
  }

  function persistOrder(ids) {
    const options = {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: ids }),
    };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      options.signal = AbortSignal.timeout(5000);
    }
    return fetchJson("/dsh-provider-order/order", options);
  }

  // 事件委托：一次绑定，React 增删/重排行不会产生重复监听。
  function bindRows(ul) {
    if (ul.dataset.dpoBound === "1") return;
    ul.dataset.dpoBound = "1";

    let dragFrom = null;
    let overRow = null;

    const clearVisuals = () => {
      if (overRow) {
        overRow.classList.remove("dpo-over");
        overRow = null;
      }
      if (dragFrom) {
        dragFrom.classList.remove("dpo-dragging");
        dragFrom = null;
      }
    };

    ul.addEventListener("dragstart", (event) => {
      const row = event.target.closest
        ? event.target.closest('li[class*="_rowCard"]')
        : null;
      if (!row || row.parentNode !== ul) return;
      // 交互元素上不启动拖拽（编辑表单区域）。
      if (event.target.closest && event.target.closest("input,button,textarea,select,a")) {
        event.preventDefault();
        return;
      }
      dragFrom = row;
      dragFrom.classList.add("dpo-dragging");
      try {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", "dsh-provider-order");
      } catch (_) {}
    });

    ul.addEventListener("dragover", (event) => {
      const row = event.target.closest
        ? event.target.closest('li[class*="_rowCard"]')
        : null;
      if (!dragFrom || !row || row === dragFrom) return;
      event.preventDefault();
      try {
        event.dataTransfer.dropEffect = "move";
      } catch (_) {}
      if (overRow && overRow !== row) overRow.classList.remove("dpo-over");
      overRow = row;
      overRow.classList.add("dpo-over");
    });

    ul.addEventListener("dragleave", (event) => {
      const related = event.relatedTarget;
      if (related && ul.contains(related)) return;
      if (overRow) {
        overRow.classList.remove("dpo-over");
        overRow = null;
      }
    });

    ul.addEventListener("drop", (event) => {
      event.preventDefault();
      const target = overRow || (event.target.closest
        ? event.target.closest('li[class*="_rowCard"]')
        : null);
      if (overRow) {
        overRow.classList.remove("dpo-over");
        overRow = null;
      }
      if (!dragFrom || !target || target === dragFrom) {
        if (dragFrom) dragFrom.classList.remove("dpo-dragging");
        dragFrom = null;
        return;
      }
      // 即时视觉反馈：移动 DOM 行（React 按 key 重渲染时以新顺序对齐，无冲突）。
      try {
        ul.insertBefore(dragFrom, target);
      } catch (_) {}
      const providers = ul.__dpoProviders || [];
      const ids = rowCardsOf(ul)
        .map((row) => providerIdOf(row, providers))
        .filter((id) => typeof id === "string");
      if (dragFrom) dragFrom.classList.remove("dpo-dragging");
      dragFrom = null;
      if (ids.length === 0) return;
      persistOrder(ids).then((json) => {
        if (!json || json.ok !== true) {
          if (typeof console !== "undefined") {
            console.warn("[dsh-provider-order] 保存顺序失败:", json && json.error);
          }
        }
      });
    });

    ul.addEventListener("dragend", clearVisuals);
  }

  function start() {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    injectCss();

    let timer = null;
    const refresh = () => {
      const uls = document.querySelectorAll('ul[class*="_rows"]');
      if (uls.length === 0) return;
      // 取最后一个出现的设置页列表（避开页面里其它同名结构的元素）。
      const ul = uls[uls.length - 1];
      fetchJson("/dsh-provider-order/providers")
        .then((json) => {
          ul.__dpoProviders = (json && json.providers) || [];
          bindRows(ul);
        })
        .catch(() => {});
    };

    const observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    refresh();
  }

  window.__ModuleLoader__.load({
    id: "@dsh-external/dsh-provider-order",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;

      function apply() {
        start();
      }

      const plugin = {
        name: "provider-order",
        inject: [],
        apply,
      };

      exports.default = plugin;
      exports.name = plugin.name;
      exports.inject = plugin.inject;
      exports.apply = plugin.apply;

      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      return module.exports;
    },
  });
})();