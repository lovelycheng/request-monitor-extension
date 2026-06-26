const listEl = document.getElementById("request-list");
const detailPanel = document.getElementById("detail-panel");
const detailContent = document.getElementById("detail-content");
const countEl = document.getElementById("record-count");

let currentDetailId = null;  // 当前右侧详情展示的请求 _id

const filterUrl = document.getElementById("filter-url");
const filterMethod = document.getElementById("filter-method");
const filterSource = document.getElementById("filter-source");
const filterStatus = document.getElementById("filter-status");

let allRequests = [];
let selectedIds = new Set();
let ignoredUrls = new Set();
let sessionExcludedIds = new Set();  // 本次会话排除（不持久化）

// 从 storage 加载忽略列表
chrome.storage.local.get(["ignoredUrls"], (data) => {
  if (data.ignoredUrls) ignoredUrls = new Set(data.ignoredUrls);
});

function shortenUrl(url) {
  // 去掉 protocol + domain，只留 path + query 前 40 字符
  try {
    const u = new URL(url);
    const q = u.searchParams.toString();
    const path = u.pathname;
    let short = path || '/';
    if (q) short += '?' + (q.length > 30 ? q.substring(0, 30) + '...' : q);
    if (short.length > 80) short = short.substring(0, 80) + '...';
    return short;
  } catch {
    return url && url.length > 80 ? url.substring(0, 80) + '...' : (url || '');
  }
}

function matchFilter(r) {
  const urlFilter = filterUrl.value.trim().toLowerCase();
  const methodFilter = filterMethod.value;
  const sourceFilter = filterSource.value;
  const statusFilter = filterStatus.value;
  if (urlFilter) {
    if (!r.url || !String(r.url).toLowerCase().includes(urlFilter)) return false;
  }
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
  if (!url) return false;
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
  const filtered = allRequests.filter((r) =>
    matchFilter(r) && !isIgnored(r.url) && !sessionExcludedIds.has(r._id)
  );

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">无匹配记录</div>';
  } else {
    listEl.innerHTML = filtered
      .map((r) => {
        const checked = selectedIds.has(r._id) ? "checked" : "";
        const selCls = selectedIds.has(r._id) ? " selected" : "";
        const activeCls = currentDetailId === r._id ? " active" : "";
        let displayUrl = r.url || '';
        let displayMethod = r.method || r.event || '';
        if (r.source === 'action') {
          displayUrl = `[${r.action}] ${r.selector || r.text || r.tag || 'unknown'}`;
          displayMethod = r.action || '';
        } else if (r.url) {
          displayUrl = shortenUrl(r.url);
        }
        const fullUrl = (r.url || displayUrl).replace(/"/g, '&quot;');
        return `
      <div class="request-item${selCls}${activeCls}" data-id="${r._id}">
        <input type="checkbox" ${checked} data-id="${r._id}" />
        <span class="source-badge ${r.source || "webRequest"}">${r.source || "http"}</span>
        <span class="method-badge ${r.method || ""}">${displayMethod || r.tag || ""}</span>
        <span class="status-code ${statusClass(r.statusCode)}">${r.statusCode !== undefined ? (r.statusCode || "err") : ""}</span>
        <span class="request-url" title="${fullUrl}">${displayUrl}</span>
        <button class="btn-hide" data-url="${fullUrl}" title="屏蔽此类请求">×</button>
      </div>`;
      })
      .join("");
  }
  const excludedCount = sessionExcludedIds.size;
  const summary = `${allRequests.length} 条 (${ignoredUrls.size} 屏蔽${excludedCount ? ', ' + excludedCount + ' 排除' : ''})`;
  countEl.textContent = summary;

  // 如果当前详情对应的请求被过滤掉了，关闭详情
  if (currentDetailId && !filtered.some((r) => r._id === currentDetailId)) {
    closeDetail();
  }
}

// ── 右侧详情面板 ──────────────────────────────────────────

function showDetail(req) {
  currentDetailId = req._id;
  const parts = [];

  // ── 基本信息 ──
  parts.push('<div class="label">基本信息</div>');
  const basicRows = [];
  const pushRow = (label, value) => {
    if (value !== null && value !== undefined && value !== '') {
      basicRows.push(`<span class="detail-kv"><b>${label}:</b> ${escHtml(String(value))}</span>`);
    }
  };
  pushRow('来源', req.source);
  pushRow('操作', req.action);
  pushRow('方法', req.method);
  pushRow('状态码', req.statusCode);
  pushRow('耗时', req.duration != null ? req.duration + 'ms' : null);
  pushRow('URL', req.url);
  pushRow('selector', req.selector);
  pushRow('tag', req.tag);
  pushRow('text', req.text);
  pushRow('错误', req.error);
  parts.push(basicRows.join(''));

  // ── 请求体 ──
  if (req.requestBody != null) {
    parts.push('<div class="label">请求体</div>');
    const rb = formatBody(req.requestBody);
    parts.push(`<pre class="pre-body">${rb}</pre>`);
  }

  // ── 响应体 ──
  if (req.responseBody != null) {
    parts.push('<div class="label">响应体</div>');
    const resp = formatBody(req.responseBody);
    parts.push(`<pre class="pre-body">${resp}</pre>`);
  }

  // ── 响应头 ──
  if (req.responseHeaders && typeof req.responseHeaders === 'object') {
    parts.push('<div class="label">响应头</div>');
    parts.push(`<pre class="pre-body">${escHtml(JSON.stringify(req.responseHeaders, null, 2))}</pre>`);
  }

  // ── Cookies ──
  if (req.cookies && Array.isArray(req.cookies) && req.cookies.length > 0) {
    parts.push('<div class="label">Cookies</div>');
    parts.push(`<pre class="pre-body">${escHtml(JSON.stringify(req.cookies, null, 2))}</pre>`);
  }

  detailContent.innerHTML = parts.join('');
  detailPanel.classList.add("visible");
  updateActiveHighlight();
}

function formatBody(body) {
  if (typeof body === 'string') return escHtml(body);
  try { return escHtml(JSON.stringify(body, null, 2)); }
  catch { return escHtml(String(body)); }
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function closeDetail() {
  currentDetailId = null;
  detailPanel.classList.remove("visible");
  detailContent.innerHTML = '<div class="detail-empty">← 点击左侧请求查看详情</div>';
  updateActiveHighlight();
}

function updateActiveHighlight() {
  listEl.querySelectorAll(".request-item.active").forEach(el => el.classList.remove("active"));
  if (currentDetailId) {
    const activeRow = listEl.querySelector(`.request-item[data-id="${currentDetailId}"]`);
    if (activeRow) activeRow.classList.add("active");
  }
}

function loadRequests() {
  chrome.runtime.sendMessage({ type: "GET_REQUESTS" }, (resp) => {
    if (resp && resp.requests) {
      allRequests = resp.requests;
    } else {
      loadFromStorage();
      return;
    }
    selectedIds = new Set(
      [...selectedIds].filter((id) => allRequests.some((r) => r._id === id))
    );
    // 检查 detail 对应的请求是否还在
    if (currentDetailId && !allRequests.some((r) => r._id === currentDetailId)) {
      closeDetail();
    }
    renderList();
    // 数据更新后刷新详情面板，让合并完成的 responseBody 即时呈现
    if (currentDetailId) {
      const req = allRequests.find((r) => r._id === currentDetailId);
      if (req) showDetail(req);
    }
  });
}

function loadFromStorage() {
  chrome.storage.local.get(null, (result) => {
    const merged = [];
    const seen = new Set();
    if (result.requests && Array.isArray(result.requests)) {
      for (const r of result.requests) {
        if (!seen.has(r._id)) { merged.push(r); seen.add(r._id); }
      }
    }
    for (const [key, value] of Object.entries(result)) {
      if (key.startsWith('rm_action_') && value && typeof value === 'object') {
        const dup = merged.some(r =>
          r.source === value.source && r.action === value.action &&
          r.timeStamp === value.timeStamp && r.url === value.url
        );
        if (!dup) {
          value._id = value._id || (Date.now() % 100000);
          merged.push(value);
        }
      }
    }
    merged.sort((a, b) => (a.timeStamp || 0) - (b.timeStamp || 0));
    allRequests = merged;
    selectedIds = new Set(
      [...selectedIds].filter((id) => allRequests.some((r) => r._id === id))
    );
    renderList();
  });
}

// ── 事件委托 ──────────────────────────────────────────────

listEl.addEventListener("click", (e) => {
  // 屏蔽按钮
  const hideBtn = e.target.closest(".btn-hide");
  if (hideBtn) {
    e.stopPropagation();
    const url = hideBtn.dataset.url;
    const pattern = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*/, "");
    if (pattern && !ignoredUrls.has(pattern)) {
      ignoredUrls.add(pattern);
      chrome.storage.local.set({ ignoredUrls: [...ignoredUrls] });
      renderList();
    }
    return;
  }

  // 复选框
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

  // 点击行 → 显示详情到右侧面板
  const item = e.target.closest(".request-item");
  if (!item) return;
  const id = Number(item.dataset.id);
  const req = allRequests.find((r) => r._id === id);
  if (req) showDetail(req);
});

// ── 按钮 ──────────────────────────────────────────────────

document.getElementById("close-detail").addEventListener("click", closeDetail);

document.getElementById("btn-select-all").addEventListener("click", () => {
  allRequests.forEach((r) => {
    if (matchFilter(r) && !isIgnored(r.url) && !sessionExcludedIds.has(r._id)) selectedIds.add(r._id);
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
    closeDetail();
    renderList();
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
    setTimeout(() => (btn.textContent = "复制"), 1500);
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

// ── 会话排除 ──────────────────────────────────────────────

document.getElementById("btn-exclude").addEventListener("click", () => {
  if (selectedIds.size === 0) return;
  for (const id of selectedIds) {
    sessionExcludedIds.add(id);
  }
  selectedIds.clear();
  renderList();
});

document.getElementById("btn-restore-excluded").addEventListener("click", () => {
  sessionExcludedIds.clear();
  renderList();
});

// ── 屏蔽管理弹窗 ──────────────────────────────────────────

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

document.getElementById("block-modal").addEventListener("click", (e) => {
  if (e.target.id === "block-modal") {
    document.getElementById("block-modal").classList.remove("visible");
  }
});

// ── 过滤器 ────────────────────────────────────────────────

[filterUrl, filterMethod, filterSource, filterStatus].forEach((el) => {
  el.addEventListener("input", renderList);
  el.addEventListener("change", renderList);
});

// ── 实时更新 ──────────────────────────────────────────────

let loadTimer = null;
function throttledLoad() {
  if (loadTimer) return;
  loadTimer = setTimeout(() => {
    loadTimer = null;
    loadRequests();
  }, 300);
}

loadRequests();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.requests) {
    throttledLoad();
  }
});
