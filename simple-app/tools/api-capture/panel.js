// ─────────────────────────────────────────────────────────────────────────────
// API Capture — DevTools panel logic
// ─────────────────────────────────────────────────────────────────────────────

const REDACTED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-csrf-token",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
]);

const REDACTED_BODY_FIELDS = [
  "password", "pwd", "passwd", "token", "accessToken", "refreshToken",
  "secret", "apiKey", "api_key", "access_token", "refresh_token",
];

// Form-encoded fields (login forms etc) — same field names, different syntax
const FORM_REDACTED_FIELDS = ["password", "pwd", "passwd", "secret"];

const MAX_SAMPLES_PER_ENDPOINT = 3;
const MAX_BODY_LENGTH = 50_000;

// State
let capturing = false;
const endpoints = new Map(); // key: "METHOD path" → { method, path, samples: [] }
let totalCaptured = 0;
let pendingRender = false;

// DOM refs
const $toggle  = document.getElementById("toggle");
const $domain  = document.getElementById("domain");
const $redact  = document.getElementById("redact");
const $counter = document.getElementById("counter");
const $clear   = document.getElementById("clear");
const $export  = document.getElementById("export");
const $list    = document.getElementById("list");
const $empty   = document.getElementById("empty");

// Default domain filter from current inspected tab
chrome.devtools.inspectedWindow.eval("location.host", (host) => {
  if (typeof host === "string" && host && !$domain.value) {
    $domain.value = host;
  }
});

// ─── Capture handler ─────────────────────────────────────────────────────────

function onRequestFinished(request) {
  if (!capturing) return;

  const type = request._resourceType;
  const method = request.request.method.toUpperCase();
  // Always capture XHR/Fetch. Also capture non-GET document/other resources
  // (covers form-based login POSTs like /wp-login.php which are document-type).
  const isApi = type === "xhr" || type === "fetch";
  const isFormPost = !isApi && method !== "GET" && method !== "HEAD";
  if (!isApi && !isFormPost) return;

  let url;
  try { url = new URL(request.request.url); }
  catch { return; }

  const filter = $domain.value.trim().toLowerCase();
  if (filter && !url.host.toLowerCase().includes(filter)) return;

  // Async pull response body
  request.getContent((body, encoding) => {
    const sample = buildSample(request, url, body, encoding);
    addSample(sample);
    queueRender();
  });
}

function buildSample(request, url, body, encoding) {
  const method = request.request.method.toUpperCase();
  const path = url.pathname;
  const queryParams = {};
  url.searchParams.forEach((v, k) => { queryParams[k] = v; });

  const requestHeaders = headersToObject(request.request.headers);
  const responseHeaders = headersToObject(request.response.headers);

  let requestBody = null;
  if (request.request.postData) {
    requestBody = request.request.postData.text ?? null;
    if (request.request.postData.params && !requestBody) {
      requestBody = request.request.postData.params
        .map((p) => `${p.name}=${p.value}`)
        .join("&");
    }
  }

  let responseBody = body ?? null;
  if (encoding === "base64" && responseBody) {
    responseBody = `[binary, base64 length ${responseBody.length}]`;
  }

  // Truncate huge bodies (avoid panel locking up)
  if (typeof requestBody === "string" && requestBody.length > MAX_BODY_LENGTH) {
    requestBody = requestBody.slice(0, MAX_BODY_LENGTH) + "\n…[truncated]";
  }
  if (typeof responseBody === "string" && responseBody.length > MAX_BODY_LENGTH) {
    responseBody = responseBody.slice(0, MAX_BODY_LENGTH) + "\n…[truncated]";
  }

  const redactOn = $redact.checked;
  if (redactOn) {
    redactHeaders(requestHeaders);
    redactHeaders(responseHeaders);
    requestBody = redactBodyString(requestBody);
    responseBody = redactBodyString(responseBody);
  }

  return {
    method,
    path,
    fullUrl: request.request.url,
    status: request.response.status,
    queryParams,
    requestHeaders,
    requestBody,
    responseHeaders,
    responseBody,
    durationMs: Math.round(request.time ?? 0),
    timestamp: new Date(request.startedDateTime ?? Date.now()).toISOString(),
  };
}

function headersToObject(arr) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const h of arr) {
    out[h.name.toLowerCase()] = h.value;
  }
  return out;
}

function redactHeaders(obj) {
  for (const k of Object.keys(obj)) {
    if (REDACTED_HEADERS.has(k.toLowerCase())) {
      obj[k] = "[REDACTED]";
    }
  }
}

function redactBodyString(body) {
  if (typeof body !== "string") return body;
  let out = body;
  // JSON-style: "field": "value"
  for (const field of REDACTED_BODY_FIELDS) {
    const re = new RegExp(`("${field}"\\s*:\\s*)"[^"]*"`, "gi");
    out = out.replace(re, '$1"[REDACTED]"');
  }
  // Form-encoded style: field=value separated by &
  for (const field of FORM_REDACTED_FIELDS) {
    const re = new RegExp(`(^|&)(${field})=([^&]*)`, "gi");
    out = out.replace(re, "$1$2=[REDACTED]");
  }
  return out;
}

function addSample(sample) {
  totalCaptured++;
  const key = `${sample.method} ${sample.path}`;
  let bucket = endpoints.get(key);
  if (!bucket) {
    bucket = { method: sample.method, path: sample.path, samples: [], count: 0 };
    endpoints.set(key, bucket);
  }
  bucket.count++;
  // Keep up to MAX_SAMPLES — diversify by status code
  const sameStatus = bucket.samples.findIndex((s) => s.status === sample.status);
  if (bucket.samples.length < MAX_SAMPLES_PER_ENDPOINT) {
    bucket.samples.push(sample);
  } else if (sameStatus === -1) {
    bucket.samples[bucket.samples.length - 1] = sample;
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function queueRender() {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => {
    pendingRender = false;
    render();
  });
}

function render() {
  $counter.textContent = `${totalCaptured} captured · ${endpoints.size} endpoint${endpoints.size === 1 ? "" : "s"}`;
  $export.disabled = endpoints.size === 0;

  if (endpoints.size === 0) {
    $empty.style.display = "";
    return;
  }
  $empty.style.display = "none";

  const sorted = [...endpoints.entries()].sort((a, b) => b[1].count - a[1].count);

  // Reuse existing nodes where possible (preserves <details> open state)
  const existing = new Map();
  for (const node of $list.querySelectorAll(".endpoint")) {
    existing.set(node.dataset.key, node);
  }

  const frag = document.createDocumentFragment();
  for (const [key, ep] of sorted) {
    let node = existing.get(key);
    if (!node) {
      node = renderEndpoint(key, ep);
    } else {
      updateEndpoint(node, ep);
    }
    frag.appendChild(node);
  }
  $list.innerHTML = "";
  $list.appendChild($empty);
  $list.appendChild(frag);
}

function renderEndpoint(key, ep) {
  const details = document.createElement("details");
  details.className = "endpoint";
  details.dataset.key = key;

  const summary = document.createElement("summary");

  const method = document.createElement("span");
  method.className = `method method-${ep.method}`;
  method.textContent = ep.method;

  const path = document.createElement("span");
  path.className = "path";
  path.textContent = ep.path;

  const count = document.createElement("span");
  count.className = "count";
  count.textContent = `× ${ep.count}`;

  const lastStatus = ep.samples[ep.samples.length - 1]?.status ?? 0;
  const status = document.createElement("span");
  status.className = `status-pill status-${String(lastStatus)[0]}`;
  status.textContent = String(lastStatus);

  summary.append(method, path, count, status);
  details.appendChild(summary);

  const samples = document.createElement("div");
  samples.className = "samples";
  renderSamples(samples, ep);
  details.appendChild(samples);

  return details;
}

function updateEndpoint(node, ep) {
  node.querySelector(".count").textContent = `× ${ep.count}`;
  const lastStatus = ep.samples[ep.samples.length - 1]?.status ?? 0;
  const status = node.querySelector(".status-pill");
  status.textContent = String(lastStatus);
  status.className = `status-pill status-${String(lastStatus)[0]}`;
  // Only re-render samples if user has it open (keeps perf good)
  if (node.open) {
    renderSamples(node.querySelector(".samples"), ep);
  }
}

function renderSamples(container, ep) {
  container.innerHTML = "";
  for (const s of ep.samples) {
    const div = document.createElement("div");
    div.className = "sample";

    const header = document.createElement("div");
    header.className = "sample-header";
    const time = document.createElement("span");
    time.textContent = new Date(s.timestamp).toLocaleTimeString();
    const dur = document.createElement("span");
    dur.textContent = `${s.durationMs}ms`;
    const stat = document.createElement("span");
    stat.className = `status-pill status-${String(s.status)[0]}`;
    stat.textContent = String(s.status);
    header.append(stat, time, dur);

    const url = document.createElement("div");
    url.className = "sample-url";
    url.textContent = s.fullUrl;

    div.append(header, url);

    if (Object.keys(s.queryParams).length > 0) {
      div.appendChild(kvBlock("Query params", JSON.stringify(s.queryParams, null, 2)));
    }
    div.appendChild(kvBlock("Request headers", JSON.stringify(s.requestHeaders, null, 2)));
    if (s.requestBody) {
      div.appendChild(kvBlock("Request body", prettyMaybeJson(s.requestBody)));
    }
    div.appendChild(kvBlock("Response headers", JSON.stringify(s.responseHeaders, null, 2)));
    if (s.responseBody) {
      div.appendChild(kvBlock("Response body", prettyMaybeJson(s.responseBody)));
    }

    container.appendChild(div);
  }
}

function kvBlock(title, content) {
  const wrap = document.createElement("div");
  wrap.className = "kv";
  const h = document.createElement("h4");
  h.textContent = title;
  const pre = document.createElement("pre");
  pre.textContent = content;
  wrap.append(h, pre);
  return wrap;
}

function prettyMaybeJson(text) {
  if (typeof text !== "string") return String(text);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

// ─── Controls ────────────────────────────────────────────────────────────────

$toggle.addEventListener("click", () => {
  capturing = !capturing;
  if (capturing) {
    $toggle.textContent = "■ Stop capture";
    $toggle.classList.add("recording");
  } else {
    $toggle.textContent = "▶ Start capture";
    $toggle.classList.remove("recording");
  }
});

$clear.addEventListener("click", () => {
  endpoints.clear();
  totalCaptured = 0;
  render();
});

$export.addEventListener("click", () => {
  const data = {
    capturedAt: new Date().toISOString(),
    domainFilter: $domain.value.trim() || null,
    redacted: $redact.checked,
    totalRequests: totalCaptured,
    endpointCount: endpoints.size,
    endpoints: [...endpoints.values()].sort((a, b) => b.count - a.count),
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `api-capture-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ─── Wire up listener ────────────────────────────────────────────────────────

chrome.devtools.network.onRequestFinished.addListener(onRequestFinished);
