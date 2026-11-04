const { ReplyStreamDecoder } = require("./stream-decoder");

class ProviderRequestError extends Error {
  constructor(message, code = "PROVIDER_ERROR", status = null) {
    super(message);
    this.name = "ProviderRequestError";
    this.code = code;
    this.status = status;
  }
}

function normalizeEndpoint(baseUrl) {
  let url;
  try {
    url = new URL(String(baseUrl || "").trim());
  } catch {
    throw new ProviderRequestError("Base URL 格式无效", "INVALID_BASE_URL");
  }
  if (url.username || url.password) {
    throw new ProviderRequestError(
      "Base URL 不能包含用户名或密码",
      "INVALID_BASE_URL"
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProviderRequestError(
      "Base URL 只支持 http 或 https",
      "INVALID_BASE_URL"
    );
  }
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
  ) {
    throw new ProviderRequestError(
      "远程 Provider 必须使用 HTTPS",
      "INVALID_BASE_URL"
    );
  }
  if (!url.pathname.replace(/\/+$/, "").endsWith("/chat/completions")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
  }
  return url.toString();
}

class SseEventParser {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.buffer = "";
  }

  push(chunk) {
    this.buffer += String(chunk || "").replace(/\r\n/g, "\n");
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      this.parseBlock(block);
      boundary = this.buffer.indexOf("\n\n");
    }
  }

  end() {
    if (this.buffer.trim()) this.parseBlock(this.buffer);
    this.buffer = "";
  }

  parseBlock(block) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) this.onEvent(data);
  }
}

function contentFromPayload(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.delta?.content ?? choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string" ? part : part?.text || part?.content || ""
      )
      .join("");
  }
  return "";
}

class ProviderClient {
  constructor({
    fetchImpl = globalThis.fetch,
    firstTokenTimeoutMs = 20000,
    idleTimeoutMs = 45000,
    totalTimeoutMs = 120000
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("当前运行环境不支持 fetch");
    }
    this.fetchImpl = fetchImpl;
    this.firstTokenTimeoutMs = firstTokenTimeoutMs;
    this.idleTimeoutMs = idleTimeoutMs;
    this.totalTimeoutMs = totalTimeoutMs;
  }

  async streamChat({
    config,
    apiKey,
    messages,
    signal,
    onContent = () => {},
    onFirstContent = () => {}
  }) {
    const url = normalizeEndpoint(config.baseUrl);
    const decoder = new ReplyStreamDecoder({
      onDelta: onContent,
      emotions: config.allowedEmotions,
      actions: config.allowedActions
    });
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: config.temperature,
        max_tokens: config.maxOutputTokens
      }),
      signal
    });

    if (!response.ok) {
      throw new ProviderRequestError(
        `Provider 请求失败（HTTP ${response.status}）`,
        response.status === 401 || response.status === 403
          ? "AUTH_ERROR"
          : "HTTP_ERROR",
        response.status
      );
    }

    const contentType = response.headers.get("content-type") || "";
    let received = "";
    let firstContent = false;
    let usage = null;

    const handleContent = (content) => {
      if (!content) return;
      if (!firstContent) {
        firstContent = true;
        onFirstContent();
      }
      decoder.push(content);
      received += content;
    };

    if (contentType.includes("text/event-stream") && response.body) {
      const reader = response.body.getReader();
      const textDecoder = new TextDecoder();
      let done = false;
      const parser = new SseEventParser((data) => {
        if (data.trim() === "[DONE]") {
          done = true;
          return;
        }
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          throw new ProviderRequestError(
            "Provider 返回了无法解析的流事件",
            "INVALID_RESPONSE"
          );
        }
        if (payload?.error) {
          throw new ProviderRequestError(
            "Provider 返回错误",
            "PROVIDER_ERROR"
          );
        }
        if (payload?.usage) usage = payload.usage;
        handleContent(contentFromPayload(payload));
      });

      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        parser.push(textDecoder.decode(chunk.value, { stream: true }));
      }
      parser.push(textDecoder.decode());
      parser.end();
    } else {
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new ProviderRequestError(
          "Provider 返回了无法解析的响应",
          "INVALID_RESPONSE"
        );
      }
      if (payload?.error) {
        throw new ProviderRequestError("Provider 返回错误", "PROVIDER_ERROR");
      }
      usage = payload?.usage || null;
      handleContent(contentFromPayload(payload));
    }

    if (received.length > 2 * 1024 * 1024) {
      throw new ProviderRequestError("Provider 响应过长", "RESPONSE_TOO_LARGE");
    }

    const final = decoder.finish();
    return { ...final, usage };
  }
}

module.exports = {
  ProviderClient,
  ProviderRequestError,
  SseEventParser,
  contentFromPayload,
  normalizeEndpoint
};
