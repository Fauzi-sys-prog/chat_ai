export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const pythonApiBaseUrl = process.env.PYTHON_API_BASE_URL || "http://127.0.0.1:8000";

async function proxy(request: Request, path: string[]) {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(path.join("/"), `${pythonApiBaseUrl}/`);
  const isChatStream = request.method === "POST" && path[path.length - 1] === "chat";
  targetUrl.search = incomingUrl.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const init: RequestInit & {
    duplex?: "half";
  } = {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    duplex: "half",
  };

  try {
    const response = await fetch(targetUrl, init);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-length");
    responseHeaders.set("Cache-Control", "no-cache, no-transform");
    responseHeaders.set("X-Accel-Buffering", "no");
    if (isChatStream && !responseHeaders.has("Content-Type")) {
      responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Unable to reach the Python backend at ${pythonApiBaseUrl}. ${error.message}`
        : `Unable to reach the Python backend at ${pythonApiBaseUrl}.`;
    return new Response(message, {
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
}

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function DELETE(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}
