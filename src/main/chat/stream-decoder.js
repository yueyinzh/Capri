class InvalidChatResponseError extends Error {
  constructor(message = "模型返回格式无效") {
    super(message);
    this.name = "InvalidChatResponseError";
    this.code = "INVALID_RESPONSE";
  }
}

function stripJsonFence(raw) {
  return String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonObject(raw) {
  const text = stripJsonFence(raw);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractPartialReply(raw) {
  const match = /"reply"\s*:\s*"/.exec(raw);
  if (!match) return null;
  const start = match.index + match[0].length;
  let value = "";

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') break;
    if (char !== "\\") {
      value += char;
      continue;
    }

    const escaped = raw[index + 1];
    if (escaped === undefined) break;
    const simpleEscapes = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t"
    };
    if (escaped in simpleEscapes) {
      value += simpleEscapes[escaped];
      index += 1;
      continue;
    }
    if (escaped === "u") {
      const hex = raw.slice(index + 2, index + 6);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    break;
  }
  return value;
}

class ReplyStreamDecoder {
  constructor({ onDelta = () => {}, emotions = [], actions = [] } = {}) {
    this.onDelta = onDelta;
    this.allowedEmotions = new Set(emotions);
    this.allowedActions = new Set(actions);
    this.raw = "";
    this.mode = "undetermined";
    this.emitted = "";
  }

  emitPrefix(value) {
    const text = String(value || "");
    if (!text.startsWith(this.emitted)) return;
    const delta = text.slice(this.emitted.length);
    this.emitted = text;
    if (delta) this.onDelta(delta);
  }

  push(content) {
    if (typeof content !== "string" || !content) return;
    this.raw += content;

    if (this.mode === "undetermined") {
      const first = this.raw.trimStart()[0];
      if (!first) return;
      this.mode = first === "{" ? "json" : "plain";
      if (this.mode === "plain") {
        this.emitPrefix(this.raw);
        return;
      }
    }

    if (this.mode === "plain") {
      this.emitPrefix(this.raw);
      return;
    }

    const partial = extractPartialReply(this.raw);
    if (partial !== null) this.emitPrefix(partial);
  }

  finish() {
    const object = parseJsonObject(this.raw);
    if (object && typeof object.reply === "string" && object.reply.trim()) {
      const reply = object.reply.trim();
      this.emitPrefix(reply);
      let degraded = false;
      let emotion = object.emotion;
      let action = object.action;
      if (!this.allowedEmotions.has(emotion)) {
        emotion = "idle";
        degraded = true;
      }
      if (!this.allowedActions.has(action)) {
        action = "none";
        degraded = true;
      }
      return { reply, emotion, action, degraded };
    }

    if (this.mode === "plain" && this.raw.trim()) {
      return {
        reply: this.raw.trim(),
        emotion: "idle",
        action: "none",
        degraded: true
      };
    }

    const partial = extractPartialReply(this.raw);
    if (partial?.trim()) {
      return {
        reply: partial.trim(),
        emotion: "idle",
        action: "none",
        degraded: true
      };
    }

    throw new InvalidChatResponseError();
  }
}

module.exports = {
  InvalidChatResponseError,
  ReplyStreamDecoder,
  extractPartialReply,
  parseJsonObject,
  stripJsonFence
};
