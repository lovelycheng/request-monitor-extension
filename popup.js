const listEl = document.getElementById("request-list");
const detailPanel = document.getElementById("detail-panel");
const detailContent = document.getElementById("detail-content");
const countEl = document.getElementById("record-count");

const filterUrl = document.getElementById("filter-url");
const filterMethod = document.getElementById("filter-method");
const filterSource = document.getElementById("filter-source");
const filterStatus = document.getElementById("filter-status");

let allRequests = [];
let selectedIds = new Set();
let ignoredUrls = new Set();

// 从 storage 加载忽略列表
chrome.storage.local.get(["ignoredUrls"], (data) => {
  if (data.ignoredUrls) ignoredUrls = new Set(data.ignoredUrls);
});

function matchFilter(r) {
  const urlFilter = filterUrl.value.trim().toLowerCase();
  const methodFilter = filterMethod.value;
  const sourceFilter = filterSource.value;
  const statusFilter = filterStatus.value;
  if (urlFilter && !r.url.toLowerCase().includes(urlFilter)) return false;
  if (methodFilter && r.method !== methodFilter) return false;
  if (sourceFilter && r.source !== sourceFilter) return false;
  if (statusFilter) {
    const sc = r.statusCode;
    if (statusFilter === "0" && sc !== 0) return false;
    if (statusFilter !== "0" && (!sc || String(sc)[0] !== statusFilter))
      return false;
  }
  return true;
}

function isIgnored(url) {
  for (const pattern of ignoredUrls) {
    if (url.includes(pattern)) return true;
  }
  return false;
}

function statusClass(code) {
  if (!code && code !== 0) return "";
  if (code >= 200 && code < 300) return "s2xx";
  if (code >= 300 && code < 400) return "s3xx";
  if (code >= 400 && code < 500) return "s4xx";
  if (code >= 500) return "s5xx";
  return "";
}

function renderList() {
  const filtered = allRequests.filter((r) => matchFilter(r) && !isIgnored(r.url));

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">无匹配记录</div>';
  } else {
    listEl.innerHTML = filtered
      .map((r) => {
        const checked = selectedIds.has(r._id) ? "checked" : "";
        const cls = selectedIds.has(r._id) ? " selected" : "";
        return `
      <div class="request-item${cls}" data-id="${r._id}">
        <input type="checkbox" ${checked} data-id="${r._id}" />
        <span class="source-badge ${r.source || "webRequest"}">${r.source || "http"}</span>
        <span class="method-badge ${r.method || ""}">${r.method || r.event || r.tag || ""}</span>
        <span class="status-code ${statusClass(r.statusCode)}">${r.statusCode !== undefined ? (r.statusCode || "err") : ""}</span>
        <span class="request-url" title="${r.url}">${r.url}</span>
        <button class="btn-hide" data-url="${r.url.replace(/"/g, "&quot;")}" title="屏蔽此类请求">×</button>
      </div>`;
      })
      .join("");
  }
  countEl.textContent = `${allRequests.length} 条 (${ignoredUrls.size} 条已屏蔽)`;
}

function showDetail(req) {
  const fields = [];
  for (const [k, v] of Object.entries(req)) {
    if (k.startsWith("_")) continue;
    if (v === null || v === undefined) continue;
    if (k === "stack") {
      fields.push(
        `<div class="label">${k}</div><pre>${String(v).substring(0, 2000)}</pre>`
      );
    } else if (typeof v === "object") {
      fields.push(
        `<div class="label">${k}</div><pre>${JSON.stringify(v, null, 2)}</pre>`
      );
    } else {
      fields.push(
        `<div class="label">${k}</div><div class="value">${String(v)}</div>`
      );
    }
  }
  detailContent.innerHTML = `<h3>请求详情 [${req.source || "?"}]</h3>${fields.join("")}`;
  detailPanel.classList.add("visible");
}

function loadRequests() {
  chrome.runtime.sendMessage({ type: "GET_REQUESTS" }, (resp) => {
    if (resp && resp.requests) {
      allRequests = resp.requests;
      selectedIds = new Set(
        [...selectedIds].filter((id) => allRequests.some((r) => r._id === id))
      );
      renderList();
    }
  });
}

// ── 事件委托（统一处理）────────────────────────────────

listEl.addEventListener("click", (e) => {
  // 屏蔽按钮
  const hideBtn = e.target.closest(".btn-hide");
  if (hideBtn) {
    e.stopPropagation();
    const url = hideBtn.dataset.url;
    // 提取 URL 中的路径部分作为屏蔽模式
    const pattern = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*/, "");
    if (pattern && !ignoredUrls.has(pattern)) {
      ignoredUrls.add(pattern);
      chrome.storage.local.set({ ignoredUrls: [...ignoredUrls] });
      renderList();
    }
    return;
  }

  // 复选框：只更新 selectedIds，不重新渲染（避免 DOM 刷新导致 checkbox 状态丢失）
  const cb = e.target.closest("input[type=checkbox]");
  if (cb) {
    e.stopPropagation();
    const id = Number(cb.dataset.id);
    if (cb.checked) {
      selectedIds.add(id);
      cb.closest(".request-item")?.classList.add("selected");
    } else {
      selectedIds.delete(id);
      cb.closest(".request-item")?.classList.remove("selected");
    }
    return;
  }

  // 点击行 → 展开详情
  const item = e.target.closest(".request-item");
  if (!item) return;
  const id = Number(item.dataset.id);
  const req = allRequests.find((r) => r._id === id);
  if (req) showDetail(req);
});

// ── 按钮 ──────────────────────────────────────────────

document.getElementById("close-detail").addEventListener("click", () => {
  detailPanel.classList.remove("visible");
});

document.getElementById("btn-select-all").addEventListener("click", () => {
  allRequests.forEach((r) => {
    if (matchFilter(r) && !isIgnored(r.url)) selectedIds.add(r._id);
  });
  renderList();
});

document.getElementById("btn-deselect").addEventListener("click", () => {
  selectedIds.clear();
  renderList();
});

document.getElementById("btn-clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_REQUESTS" }, () => {
    allRequests = [];
    selectedIds.clear();
    ignoredUrls.clear();
    chrome.storage.local.set({ ignoredUrls: [] });
    renderList();
    detailPanel.classList.remove("visible");
  });
});

document.getElementById("btn-copy-json").addEventListener("click", async () => {
  const toCopy = selectedIds.size
    ? allRequests.filter((r) => selectedIds.has(r._id))
    : allRequests;
  const json = JSON.stringify(toCopy, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    const btn = document.getElementById("btn-copy-json");
    btn.textContent = "已复制!";
    setTimeout(() => (btn.textContent = "复制 JSON"), 1500);
  } catch {
    alert("复制失败");
  }
});

document.getElementById("btn-export-json").addEventListener("click", () => {
  const toExport = selectedIds.size
    ? allRequests.filter((r) => selectedIds.has(r._id))
    : allRequests;
  const blob = new Blob([JSON.stringify(toExport, null, 2)], {
    type: "application/json",
  });
  chrome.downloads.download({
    url: URL.createObjectURL(blob),
    filename: `requests-${Date.now()}.json`,
    saveAs: true,
  });
});

document.getElementById("btn-export-script").addEventListener("click", () => {
  chrome.runtime.sendMessage(
    {
      type: "EXPORT_SCRIPT",
      selectedIds: selectedIds.size ? [...selectedIds] : [],
    },
    () => {}
  );
});

// ── 屏蔽管理弹窗 ────────────────────────────────────────

function renderBlockList() {
  const listEl = document.getElementById("block-list");
  if (ignoredUrls.size === 0) {
    listEl.innerHTML = '<div style="color:var(--text2);text-align:center;padding:20px">暂无屏蔽项</div>';
    return;
  }
  listEl.innerHTML = [...ignoredUrls].map((p) => `
    <div class="modal-item">
      <span class="pattern" title="${p}">${p}</span>
      <button data-pattern="${p.replace(/"/g, '&quot;')}">恢复</button>
    </div>
  `).join("");
}

document.getElementById("btn-manage-block").addEventListener("click", () => {
  renderBlockList();
  document.getElementById("block-modal").classList.add("visible");
});

document.getElementById("btn-block-close").addEventListener("click", () => {
  document.getElementById("block-modal").classList.remove("visible");
});

document.getElementById("block-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || !btn.dataset.pattern) return;
  ignoredUrls.delete(btn.dataset.pattern);
  chrome.storage.local.set({ ignoredUrls: [...ignoredUrls] });
  renderBlockList();
  renderList();
});

document.getElementById("btn-block-clear-all").addEventListener("click", () => {
  ignoredUrls.clear();
  chrome.storage.local.set({ ignoredUrls: [] });
  renderBlockList();
  renderList();
});

// 点击遮罩关闭
document.getElementById("block-modal").addEventListener("click", (e) => {
  if (e.target.id === "block-modal") {
    document.getElementById("block-modal").classList.remove("visible");
  }
});

// ── 过滤器 ────────────────────────────────────────────

[filterUrl, filterMethod, filterSource, filterStatus].forEach((el) => {
  el.addEventListener("input", renderList);
  el.addEventListener("change", renderList);
});

// ── 轮询 ──────────────────────────────────────────────

loadRequests();
setInterval(loadRequests, 1500);
