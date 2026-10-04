// The web app talks ONLY to our API (same origin, session cookie).

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: string) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function handle<T>(res: Response): Promise<T> {
  // A 401 means the session has ended, except when signing in, where the message says why.
  if (res.status === 401 && !res.url.endsWith("/api/auth/login")) {
    onUnauthorized?.();
    throw new ApiError(401, "Please sign in");
  }
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `Something went wrong (${res.status})`, body?.detail);
  }
  return body as T;
}

function url(path: string, params?: Record<string, string | number | boolean | undefined | null>) {
  const u = new URL(path.startsWith("/api") ? path : `/api${path}`, window.location.origin);
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  return u.pathname + u.search;
}

export const api = {
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
    return fetch(url(path, params), { credentials: "same-origin" }).then((r) => handle<T>(r));
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return fetch(url(path), {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => handle<T>(r));
  },
  patch<T>(path: string, body: unknown): Promise<T> {
    return fetch(url(path), {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r));
  },
  put<T>(path: string, body: unknown): Promise<T> {
    return fetch(url(path), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r));
  },
  del<T>(path: string): Promise<T> {
    return fetch(url(path), { method: "DELETE", credentials: "same-origin" }).then((r) => handle<T>(r));
  },
  /** multipart/form-data upload; pass `onProgress` for a 0–100 upload percentage. */
  upload<T>(path: string, form: FormData, opts: { method?: "POST" | "PATCH"; onProgress?: (pct: number) => void } = {}): Promise<T> {
    const method = opts.method ?? "POST";
    if (!opts.onProgress) return fetch(url(path), { method, credentials: "same-origin", body: form }).then((r) => handle<T>(r));
    return uploadWithProgress<T>(url(path), method, form, opts.onProgress);
  },
  /** Build a same-origin URL (for downloads, images). */
  href(path: string, params?: Record<string, string | number | boolean | undefined | null>) {
    return url(path, params);
  },
};

/** fetch can't report upload progress, so uploads that show a bar use XHR. */
function uploadWithProgress<T>(href: string, method: string, form: FormData, onProgress: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, href);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: { error?: string; detail?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T);
      if (xhr.status === 401) {
        onUnauthorized?.();
        return reject(new ApiError(401, "Please sign in"));
      }
      if (xhr.status === 413 && !body?.error) return reject(new ApiError(413, "That file is too big to upload."));
      reject(new ApiError(xhr.status, body?.error ?? `Upload failed (${xhr.status})`, body?.detail));
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload didn't reach the server. Check your connection and try again."));
    xhr.send(form);
  });
}
