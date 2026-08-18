// Browser half of @dsh-external/dsh-provider-order.
//
// 拖拽增强（self-contained，不依赖修改核心 bundle 文件）。
//
// 加载协议要点（dsh-client-modules）：bundle 脚本执行只 REGISTER 工厂；
// 工厂在 materialization（首次 import/require）时执行并 memoized；apply 是否
// 被 cordis client Entry 调用没有可靠保证，因此 **启动不依赖 apply**——工厂
// 体内直接 start()（带幂等标记）。
//
// 机制：
//   1. MutationObserver 观察 documentElement，等待设置页模型商行列表出现
//      （[class*="_rows"]，CSS module 哈希变化免疫，不限定 ul/li 标签），
//      React 重渲染后自动重新取数，无需改动核心 bundle。
//   2. 行为一类名稳定后缀（"_rowCard"/"_rowName"）匹配；行开启原生 HTML5
//      draggable；input/button/select/textarea/链接上按压不误触发。
//   3. 释放后按行内 displayName 匹配 GET /dsh-provider-order/providers 的
//      全量列表 → provider id 序，PUT /dsh-provider-order/order 持久化；
//      host 侧重排 LlmRuntime 两个 Map 并广播 llm/adapters-updated。
//   4. 绑定成功时在列表上方插入一个品牌指示条（可随时删除），确认生效。

(function () {
  const CSS_TAG = "@dsh-external/dsh-provider-order/dnd.css";
  const BADGE_TAG = "@dsh-external/dsh-provider-order/badge";
  // 不限定标签类型：实际 DOM 中行元素可能是 li，也可能是 div 等其他标签。
  // 只用 CSS module 的稳定语义后缀匹配，避免再出现“CSS 生效但 JS 选不中”的情况。
  const LIST_SELECTOR = '[class*="_rows"]';
  const ROW_SELECTOR = '[class*="_rowCard"]';
  const NAME_SELECTOR = '[class*="_rowName"]';
  const CSS = [
    '[class*="_rowCard"]{cursor:grab;-webkit-user-drag:element;user-select:none}',
    '[class*="_rowCard"].dpo-dragging{opacity:.45}',
    '[class*="_rowCard"].dpo-over{border-color:var(--dsw-alias-brand-primary,#3964fe);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#3964fe)}',
    '[class*="_rowCard"] input,[class*="_rowCard"] button,[class*="_rowCard"] select,[class*="_rowCard"] textarea{cursor:auto}',
    '[class*="_rowCard"] input,[class*="_rowCard"] textarea,[class*="_rowCard"] [contenteditable="true"]{user-select:text}', // 行内输入/编辑区域仍可选中文字
  ].join("");
  const BADGE_HTML =
    '<div style="display:flex;align-items:center;gap:6px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary,#8a8f98);padding:4px 0 8px;">' +
    '<span style="opacity:.8;">⇅</span><span>拖拽排序（provider-order）</span>' +
    "</div>";

  function injectCss() {
    if (typeof document === "undefined") return;
    if (!document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]')) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "@dsh-external/dsh-provider-order";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      (document.head || document.documentElement).appendChild(tag);
    }
  }

  function fetchJson(url, options) {
    return window.fetch(url, options || {}).then(
      (response) => response.json().catch(() => ({})),
    );
  }

  function rowCardsOf(container) {
    return Array.prototype.slice.call(container.querySelectorAll(ROW_SELECTOR));
  }

  // 用行内 displayName 文本匹配 providers 列表，取回 provider id。
  function providerIdOf(row, providers) {
    const nameEl = row.querySelector(NAME_SELECTOR);
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
    // 原生 HTML5 拖拽必须先给行设置 draggable="true"，否则 dragstart 根本不会触发。
    // React 重渲染会重建 li，因此每次 refresh 到这里都要重新标记现有行。
    rowCardsOf(ul).forEach((row) => {
      row.draggable = true;
    });
    if (ul.dataset.dpoBound === "1") return;
    ul.dataset.dpoBound = "1";

    // 品牌指示条：确认插件已生效（仅设置页模型商列表出现时插入一次）。
    if (ul.parentNode && !ul.parentNode.querySelector('[data-plugin-badge="' + BADGE_TAG + '"]')) {
      const badge = document.createElement("div");
      badge.dataset.pluginBadge = BADGE_TAG;
      badge.innerHTML = BADGE_HTML;
      ul.parentNode.insertBefore(badge, ul);
    }

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

    const focusRow = (event) => {
      const row = event.target && event.target.closest
        ? event.target.closest(ROW_SELECTOR)
        : null;
      return row && ul.contains(row) ? row : null;
    };

    // React 可能在渲染后把 draggable 重置回 false；在按下瞬间再强制打开，
    // 确保用户真正拖动前浏览器认为该行可拖。
    ul.addEventListener("mousedown", (event) => {
      const row = focusRow(event);
      if (row) row.draggable = true;
    }, true);
    ul.addEventListener("pointerdown", (event) => {
      const row = focusRow(event);
      if (row) row.draggable = true;
    }, true);

    ul.addEventListener("dragstart", (event) => {
      const row = focusRow(event);
      if (!row) return;
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
      const row = focusRow(event);
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
      const target = overRow || focusRow(event);
      if (overRow) {
        overRow.classList.remove("dpo-over");
        overRow = null;
      }
      if (!dragFrom || !target || target === dragFrom) {
        if (dragFrom) dragFrom.classList.remove("dpo-dragging");
        dragFrom = null;
        return;
      }
      try {
        const sourceParent = dragFrom.parentNode;
        if (sourceParent && sourceParent === target.parentNode) {
          sourceParent.insertBefore(dragFrom, target);
        } else if (target.parentNode) {
          target.parentNode.insertBefore(dragFrom, target);
        }
      } catch (_) {}
      const providers = ul.__dpoProviders || [];
      const ids = rowCardsOf(ul)
        .map((row) => providerIdOf(row, providers))
        .filter((id) => typeof id === "string");
      if (dragFrom) dragFrom.classList.remove("dpo-dragging");
      dragFrom = null;
      if (ids.length === 0) {
        if (typeof console !== "undefined") console.warn("[dsh-provider-order] 未取到 provider id（displayName 映射失败）");
        return;
      }
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

  let started = false;

  function start() {
    if (started) return;
    started = true;
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    injectCss();

    let timer = null;
    let failCount = 0;

    const refresh = () => {
      // 不限定 ul/li：兼容不同版本把列表/行渲染成 div 等标签。
      const lists = document.querySelectorAll(LIST_SELECTOR);
      if (lists.length === 0) return;
      const ul = lists[lists.length - 1];
      // 先让行可拖拽：不依赖 providers 接口成功/快慢，避免列表出现后只有
      // “看得见但拖不动”的假象。
      rowCardsOf(ul).forEach((row) => {
        row.draggable = true;
      });

      const finish = (providers, ok) => {
        ul.__dpoProviders = providers || [];
        // 即使 providers 接口暂时失败也绑定事件，避免拖拽完全不可用；
        // 保存映射会在 drop 时因 providers 缺失而警告，但不会阻塞 UI 拖动。
        bindRows(ul);
        if (ok && providers && providers.length > 0) {
          failCount = 0;
        } else if (!ok) {
          failCount += 1;
          if (failCount < 20) setTimeout(refresh, 1500);
        }
      };

      fetchJson("/dsh-provider-order/providers")
        .then((json) => {
          const ok = json && json.ok === true;
          const providers = (json && json.providers) || [];
          if (!ok || providers.length === 0) {
            if (typeof console !== "undefined") {
              console.warn(
                "[dsh-provider-order] providers 接口未返回有效数据，已绑定拖拽但保存映射可能不可用",
                json && json.error,
              );
            }
          }
          finish(providers, ok);
        })
        .catch(() => {
          if (typeof console !== "undefined") {
            console.warn("[dsh-provider-order] providers 接口请求失败");
          }
          finish([], false);
        });
    };

    // documentElement 先就位即观察；body 产生后由 mutation 驱动 refresh。
    const root = document.documentElement || document.body;
    if (!root) {
      window.addEventListener("DOMContentLoaded", start, { once: true });
      return;
    }
    const observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 500);
    });
    observer.observe(root, { childList: true, subtree: true });
    refresh();
    // 兜底轮询：即使 observer 错失首帧也尽量绑定。
    setTimeout(refresh, 1200);
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

      // 启动不依赖 apply：材料化即尝试（幂等）。
      start();

      exports.default = plugin;
      exports.name = plugin.name;
      exports.inject = plugin.inject;
      exports.apply = plugin.apply;

      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      return module.exports;
    },
  });
})();