const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");
const { ChatModule } = require("../src/main/chat");

const root = path.join(__dirname, "..");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "capri-chat-module-"));
app.setPath("userData", userDataDir);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const chatEvents = [];
  const petEvents = [];
  const chat = new ChatModule({
    rootDir: root,
    userDataDir,
    ownerWindowProvider: () => null,
    sendToPet: (channel, payload) => petEvents.push({ channel, payload }),
    showPetInactive: () => {},
    notifyPet: () => {}
  });
  chat.emitToChat = (channel, payload) =>
    chatEvents.push({ channel, payload });

  try {
    chat.credentials.getApiKey = async () => ({
      apiKey: null,
      storage: "none"
    });
    chat.send({ text: "没有配置密钥时会怎样" });
    await sleep(400);
    assert.equal(chat.activeRequest, null);
    assert.equal(
      chatEvents.some(
        (event) =>
          event.channel === "chat:done" &&
          event.payload.degraded === true &&
          typeof event.payload.message?.content === "string"
      ),
      true
    );
    await chat.clearSession();

    chat.credentials.getApiKey = async () => ({
      apiKey: "test-key",
      storage: "memory"
    });
    chat.providerSettings.model = "test-model";
    chat.providerClient.streamChat = async ({
      onFirstContent,
      onContent
    }) => {
      onFirstContent();
      onContent("先");
      onContent("说两句。");
      return {
        reply: "先 说两句。",
        emotion: "happy",
        action: "bounce",
        degraded: false
      };
    };

    const accepted = chat.send({ text: "测试多轮对话" });
    assert.ok(accepted.requestId);
    await sleep(400);
    assert.equal(chat.activeRequest, null);
    assert.equal(
      chat.session.messages.some(
        (message) =>
          message.role === "assistant" && message.content === "先 说两句。"
      ),
      true
    );
    assert.equal(
      chatEvents.some((event) => event.channel === "chat:delta"),
      true
    );
    const phases = chatEvents
      .filter(
        (event) =>
          event.channel === "chat:phase" &&
          event.payload.requestId === accepted.requestId
      )
      .map((event) => event.payload.phase);
    assert.ok(phases.includes("listening"));
    assert.ok(phases.includes("thinking"));
    assert.ok(phases.includes("speaking"));
    assert.equal(
      petEvents.some((event) => event.channel === "pet:chat-bubble"),
      true
    );
    assert.equal(
      petEvents.some(
        (event) =>
          event.channel === "pet:set-state" &&
          event.payload.state === "happy"
      ),
      true
    );

    chat.providerClient.streamChat = ({ signal, onFirstContent }) =>
      new Promise((resolve, reject) => {
        onFirstContent();
        signal.addEventListener("abort", () => {
          const error = new Error("stopped");
          error.name = "AbortError";
          reject(error);
        });
      });
    chat.send({ text: "这条会被停止" });
    await sleep(360);
    chat.stopCurrentRequest();
    await sleep(30);
    assert.equal(chat.activeRequest, null);
    assert.equal(
      chatEvents.some(
        (event) =>
          event.channel === "chat:done" && event.payload.stopped === true
      ),
      true
    );

    await chat.clearSession();
    assert.equal(chat.session.messages.length, 0);
    assert.equal(
      chatEvents.some((event) => event.channel === "chat:history"),
      true
    );

    chat.session.messages.push({
      id: "mojie-only",
      role: "user",
      content: "摩羯自己的历史",
      createdAt: new Date().toISOString(),
      status: "complete"
    });
    chat.sessions.save(chat.activePersonaId, chat.session);
    const alternatePath = path.join(userDataDir, "alternate-persona.json");
    fs.writeFileSync(
      alternatePath,
      JSON.stringify({ id: "alternate", displayName: "另一个角色" }),
      "utf8"
    );
    const originalPersonaPath = chat.personaManifestPath.bind(chat);
    chat.personaManifestPath = (personaId) =>
      personaId === "alternate" ? alternatePath : originalPersonaPath(personaId);
    await chat.switchPersona("alternate");
    assert.equal(chat.session.messages.length, 0);
    await chat.switchPersona("mojie");
    assert.equal(chat.session.messages[0].content, "摩羯自己的历史");
    console.log("聊天模块测试通过：流式、停止、清空、角色隔离与桌宠事件");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    chat.cleanup();
    try {
      fs.rmSync(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100
      });
    } catch (error) {
      console.warn(`测试目录将在进程退出后清理：${error.message}`);
    } finally {
      app.quit();
    }
  }
});

app.on("window-all-closed", () => app.quit());
