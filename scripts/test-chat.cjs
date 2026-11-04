const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildContext,
  buildSystemPrompt,
  mergePersona
} = require("../src/main/chat/context-manager");
const {
  ProviderClient,
  SseEventParser,
  normalizeEndpoint
} = require("../src/main/chat/provider-client");
const {
  ReplyStreamDecoder,
  extractPartialReply
} = require("../src/main/chat/stream-decoder");
const { SessionStore } = require("../src/main/chat/session-store");

const root = path.join(__dirname, "..");
const readJson = (file) =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

async function main() {
const defaults = readJson("config/chat.defaults.json");
const manifest = readJson("config/persona.json");
const persona = mergePersona(defaults, manifest);

assert.equal(persona.id, "mojie");
assert.equal(persona.prompt.L1.antiExamples.length, 5);
assert.equal(persona.context.maxMessages, 24);

const overridden = mergePersona(defaults, manifest, {
  prompt: {
    L1: {
      catchphrases: ["测试口头禅"]
    }
  }
});
assert.deepEqual(overridden.prompt.L1.catchphrases, ["测试口头禅"]);
assert.equal(overridden.prompt.L1.antiExamples.length, 5);

const system = buildSystemPrompt(
  persona,
  {
    localDateTime: "2026-11-04 12:00:00",
    timezone: "Asia/Shanghai",
    activeWindow: { appName: "Code", title: "demo.js" },
    petState: "chat_speaking",
    chatPhase: "speaking",
    relationship: "owner"
  },
  { rollingSummary: "用户正在测试聊天模块。" }
);
assert.match(system, /当前时间：2026-11-04 12:00:00/);
assert.match(system, /活动窗口：Code \/ demo.js/);
assert.match(system, /reply、emotion、action/);
assert.match(system, /您好，有什么可以帮您/);

const session = {
  personaId: "mojie",
  rollingSummary: "",
  summaryThroughMessageId: null,
  messages: []
};
for (let index = 0; index < 18; index += 1) {
  session.messages.push({
    id: `user-${index}`,
    role: "user",
    content: `第${index}轮用户消息`,
    createdAt: new Date().toISOString()
  });
  session.messages.push({
    id: `assistant-${index}`,
    role: "assistant",
    content: `第${index}轮角色回复`,
    createdAt: new Date().toISOString()
  });
}
session.messages.push({
  id: "latest-user",
  role: "user",
  content: "这是必须保留的最新用户消息",
  createdAt: new Date().toISOString()
});

const tightPersona = mergePersona(defaults, manifest, {
  context: {
    maxMessages: 5,
    maxChars: 120,
    recentTurns: 2
  }
});
const context = buildContext(tightPersona, session);
assert.ok(context.stats.messageCount <= 5);
assert.ok(context.stats.charCount <= 120);
assert.equal(context.messages.at(-1).content, "这是必须保留的最新用户消息");
assert.ok(session.rollingSummary.includes("第"));

const jsonDeltas = [];
const decoder = new ReplyStreamDecoder({
  onDelta: (delta) => jsonDeltas.push(delta),
  emotions: persona.prompt.L4.emotions,
  actions: persona.prompt.L4.actions
});
decoder.push('{"reply":"你');
decoder.push('好啊\\n下一行","emotion":"happy",');
decoder.push('"action":"bounce"}');
const decoded = decoder.finish();
assert.equal(decoded.reply, "你好啊\n下一行");
assert.equal(decoded.emotion, "happy");
assert.equal(decoded.action, "bounce");
assert.equal(jsonDeltas.join(""), "你好啊\n下一行");
assert.equal(extractPartialReply('{"reply":"半句'), "半句");

const plain = new ReplyStreamDecoder({
  emotions: persona.prompt.L4.emotions,
  actions: persona.prompt.L4.actions
});
plain.push("普通文本回复");
assert.deepEqual(plain.finish(), {
  reply: "普通文本回复",
  emotion: "idle",
  action: "none",
  degraded: true
});

const events = [];
const sse = new SseEventParser((data) => events.push(data));
sse.push('data: {"choices":[{"delta":{"content":"甲"}}]}\r\n\r\n');
sse.push("data: [DONE]\n\n");
sse.end();
assert.equal(events.length, 2);
assert.equal(events[1], "[DONE]");

assert.equal(
  normalizeEndpoint("https://example.com/v1/"),
  "https://example.com/v1/chat/completions"
);
assert.throws(
  () => normalizeEndpoint("http://example.com/v1"),
  /HTTPS/
);

const providerDeltas = [];
const contentFragments = [
  '{"reply":"你',
  '好","emotion":"happy","action":"bounce"}'
];
const encoder = new TextEncoder();
const mockFetch = async () =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const content of contentFragments) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                choices: [{ delta: { content } }]
              })}\n\n`
            )
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    }
  );
const provider = new ProviderClient({ fetchImpl: mockFetch });
const providerResult = await provider.streamChat({
  config: {
    baseUrl: "https://example.com/v1",
    model: "test-model",
    temperature: 0.3,
    maxOutputTokens: 100,
    allowedEmotions: persona.prompt.L4.emotions,
    allowedActions: persona.prompt.L4.actions
  },
  apiKey: "test-key",
  messages: [{ role: "user", content: "测试" }],
  signal: new AbortController().signal,
  onContent: (delta) => providerDeltas.push(delta)
});
assert.equal(providerResult.reply, "你好");
assert.equal(providerDeltas.join(""), "你好");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "capri-chat-"));
try {
  const store = new SessionStore({ baseDir: tempDir });
  const alpha = store.load("alpha");
  alpha.messages.push({
    id: "alpha-message",
    role: "user",
    content: "只属于 alpha",
    createdAt: new Date().toISOString()
  });
  store.save("alpha", alpha);
  const beta = store.load("beta");
  assert.equal(beta.messages.length, 0);
  assert.equal(store.load("alpha").messages[0].content, "只属于 alpha");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("聊天核心测试通过：Prompt、裁剪、流解析、URL、会话隔离");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
