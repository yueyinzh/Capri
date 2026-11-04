const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, ipcMain } = require("electron");
const {
  buildContext,
  buildSystemPrompt,
  compactStoredSession,
  mergePersona
} = require("./context-manager");
const { CredentialStore } = require("./credential-store");
const {
  ProviderClient,
  ProviderRequestError,
  normalizeEndpoint
} = require("./provider-client");
const { RuntimeContext } = require("./runtime-context");
const { SessionStore, createSession } = require("./session-store");

const CHAT_WIDTH = 620;
const CHAT_HEIGHT = 760;
const VALID_RELATIONSHIPS = new Set(["stranger", "acquaintance", "owner"]);
const SAFE_PERSONA_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

function readOptionalJson(filePath) {
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(tempPath, filePath);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

function sanitizeText(value, maxChars) {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function createMessage(role, content, extra = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    status: "complete",
    degraded: false,
    ...extra
  };
}

class ChatModule {
  constructor({
    rootDir,
    userDataDir,
    ownerWindowProvider,
    sendToPet,
    showPetInactive,
    notifyPet
  }) {
    this.rootDir = rootDir;
    this.userDataDir = userDataDir;
    this.ownerWindowProvider = ownerWindowProvider;
    this.sendToPet = sendToPet;
    this.showPetInactive = showPetInactive;
    this.notifyPet = notifyPet;
    this.window = null;
    this.registeredHandlers = new Map();
    this.openListener = null;
    this.activeRequest = null;
    this.lastPetState = "idle";
    this.petStateResetTimer = null;
    this.chatDataDir = path.join(userDataDir, "chat");

    this.defaults = readJson(
      path.join(rootDir, "config", "chat.defaults.json")
    );
    this.defaultManifest = readJson(
      path.join(rootDir, "config", "persona.json")
    );
    this.sessions = new SessionStore({
      baseDir: this.chatDataDir
    });
    this.credentials = new CredentialStore({ userDataDir });
    this.runtime = new RuntimeContext({
      includeActiveWindow: this.defaults.provider.includeActiveWindow !== false
    });
    this.providerClient = new ProviderClient({
      firstTokenTimeoutMs: this.defaults.provider.firstTokenTimeoutMs,
      idleTimeoutMs: this.defaults.provider.idleTimeoutMs,
      totalTimeoutMs: this.defaults.provider.totalTimeoutMs
    });
    this.providerSettings = this.loadProviderSettings();
    this.activePersonaId = this.defaultManifest.id;
    this.persona = this.loadPersona(this.activePersonaId);
    this.session = this.sessions.load(this.activePersonaId);
  }

  personaManifestPath(personaId) {
    if (personaId === this.defaultManifest.id) {
      return path.join(this.rootDir, "config", "persona.json");
    }
    if (!SAFE_PERSONA_ID.test(personaId)) return null;
    const candidate = path.join(
      this.rootDir,
      "config",
      "personas",
      `${personaId}.json`
    );
    return fs.existsSync(candidate) ? candidate : null;
  }

  loadPersona(personaId) {
    const manifestPath = this.personaManifestPath(personaId);
    if (!manifestPath) throw new Error(`未知角色：${personaId}`);
    const manifest = readJson(manifestPath);
    if (manifest.id !== personaId) throw new Error("角色 manifest ID 不一致");
    const overridePath = path.join(
      this.chatDataDir,
      "persona-overrides",
      `${personaId}.json`
    );
    const override = readOptionalJson(overridePath);
    try {
      return mergePersona(this.defaults, manifest, override || undefined);
    } catch (error) {
      console.warn(`角色覆盖配置无效，已忽略：${error.message}`);
      return mergePersona(this.defaults, manifest);
    }
  }

  loadProviderSettings() {
    const base = {
      ...this.defaults.provider
    };
    const saved = readOptionalJson(
      path.join(this.chatDataDir, "provider.json")
    );
    if (!saved || typeof saved !== "object") {
      return this.normalizeProviderSettings(base);
    }
    return this.normalizeProviderSettings({ ...base, ...saved });
  }

  normalizeProviderSettings(candidate) {
    const source = candidate && typeof candidate === "object" ? candidate : {};
    return {
      baseUrl: sanitizeText(source.baseUrl, 2000),
      model: sanitizeText(source.model, 200),
      relationship: VALID_RELATIONSHIPS.has(source.relationship)
        ? source.relationship
        : "owner",
      includeActiveWindow: source.includeActiveWindow !== false,
      temperature: clampNumber(source.temperature, 0, 2, 0.3),
      maxOutputTokens: Math.round(
        clampNumber(source.maxOutputTokens, 64, 4096, 800)
      ),
      firstTokenTimeoutMs: Math.round(
        clampNumber(source.firstTokenTimeoutMs, 2000, 120000, 20000)
      ),
      idleTimeoutMs: Math.round(
        clampNumber(source.idleTimeoutMs, 2000, 120000, 45000)
      ),
      totalTimeoutMs: Math.round(
        clampNumber(source.totalTimeoutMs, 5000, 300000, 120000)
      )
    };
  }

  saveProviderSettings(patch) {
    if (!patch || typeof patch !== "object") {
      throw new Error("Provider 配置无效");
    }
    const next = this.normalizeProviderSettings({
      ...this.providerSettings,
      ...patch
    });
    if (!next.baseUrl) throw new Error("请填写 Base URL");
    if (!next.model) throw new Error("请填写模型名");
    normalizeEndpoint(next.baseUrl);
    this.providerSettings = next;
    this.runtime.setIncludeActiveWindow(next.includeActiveWindow);
    writeJsonAtomic(
      path.join(this.chatDataDir, "provider.json"),
      {
        baseUrl: next.baseUrl,
        model: next.model,
        relationship: next.relationship,
        includeActiveWindow: next.includeActiveWindow
      }
    );
    return this.publicProviderSettings();
  }

  publicProviderSettings() {
    return {
      baseUrl: this.providerSettings.baseUrl,
      model: this.providerSettings.model,
      relationship: this.providerSettings.relationship,
      includeActiveWindow: this.providerSettings.includeActiveWindow
    };
  }

  registerIpc() {
    this.runtime.startMonitor();
    this.registerHandler("chat:bootstrap", () => this.bootstrap());
    this.registerHandler("chat:send", (_event, payload) =>
      this.send(payload)
    );
    this.registerHandler("chat:stop", () => this.stopCurrentRequest());
    this.registerHandler("chat:clear", () => this.clearSession());
    this.registerHandler("chat:switch-persona", (_event, payload) =>
      this.switchPersona(payload?.personaId)
    );
    this.registerHandler("chat:save-provider", (_event, patch) =>
      this.saveProviderSettings(patch)
    );
    this.registerHandler("chat:set-api-key", (_event, payload) =>
      this.setApiKey(payload?.apiKey)
    );
    this.registerHandler("chat:clear-api-key", () => this.clearApiKey());

    this.openListener = (event) => {
      if (!this.senderIsPetWindow(event)) return;
      this.openWindow();
    };
    ipcMain.on("chat:open", this.openListener);
  }

  registerHandler(channel, handler) {
    const wrapped = async (event, payload) => {
      this.assertChatSender(event);
      return handler(event, payload);
    };
    this.registeredHandlers.set(channel, wrapped);
    ipcMain.handle(channel, wrapped);
  }

  senderIsPetWindow(event) {
    const petWindow = this.ownerWindowProvider();
    return Boolean(
      petWindow &&
        !petWindow.isDestroyed() &&
        BrowserWindow.fromWebContents(event.sender) === petWindow
    );
  }

  assertChatSender(event) {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      BrowserWindow.fromWebContents(event.sender) !== this.window
    ) {
      throw new Error("无效的聊天请求");
    }
  }

  emitToChat(channel, payload) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  createWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.window = new BrowserWindow({
      width: CHAT_WIDTH,
      height: CHAT_HEIGHT,
      minWidth: 520,
      minHeight: 640,
      title: "摩羯 // 对话",
      backgroundColor: "#0d090d",
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(this.rootDir, "src", "preload", "chat.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false
      }
    });
    this.window.loadFile(
      path.join(this.rootDir, "src", "renderer", "chat", "index.html")
    );
    this.window.once("ready-to-show", () => this.window?.show());
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    this.window.on("closed", () => {
      this.window = null;
    });
    return this.window;
  }

  async openWindow() {
    await this.runtime.refresh();
    const window = this.createWindow();
    if (window.webContents.isLoadingMainFrame()) {
      window.once("ready-to-show", () => {
        window.show();
        window.focus();
      });
    } else {
      window.show();
      window.focus();
    }
  }

  async publicApiKeyState() {
    const key = await this.credentials.getApiKey();
    return {
      hasApiKey: Boolean(key.apiKey),
      storage: key.storage
    };
  }

  async bootstrap() {
    const keyState = await this.publicApiKeyState();
    return {
      persona: {
        id: this.persona.id,
        displayName: this.persona.displayName
      },
      config: this.publicProviderSettings(),
      ...keyState,
      messages: this.session.messages,
      rollingSummary: this.session.rollingSummary
    };
  }

  send(payload) {
    if (this.activeRequest) {
      throw new Error("上一条回复还没结束");
    }
    const text = sanitizeText(payload?.text, this.persona.context.maxUserChars + 1);
    if (!text) throw new Error("消息不能为空");
    if (text.length > this.persona.context.maxUserChars) {
      throw new Error(`消息不能超过 ${this.persona.context.maxUserChars} 个字符`);
    }

    const userMessage = createMessage("user", text);
    this.session.messages.push(userMessage);
    compactStoredSession(this.persona, this.session);
    this.sessions.save(this.activePersonaId, this.session);

    const request = {
      id: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      controller: new AbortController(),
      replyText: "",
      started: false,
      stopRequested: false,
      clearRequested: false,
      firstTokenSeen: false,
      firstTokenTimer: null,
      idleTimer: null,
      totalTimer: null
    };
    this.activeRequest = request;
    this.emitPhase(request.id, "listening");
    this.setTimeoutForRequest(request, "firstTokenTimer", () => {
      this.abortRequest(request, "timeout");
    }, this.providerSettings.firstTokenTimeoutMs);
    this.setTimeoutForRequest(request, "totalTimer", () => {
      this.abortRequest(request, "timeout");
    }, this.providerSettings.totalTimeoutMs);

    setTimeout(() => {
      if (this.activeRequest === request) {
        if (request.stopRequested || request.aborted) return;
        this.runRequest(request).catch((error) => {
          console.error("聊天请求意外失败：", error.message);
        });
      }
    }, 320);

    return {
      requestId: request.id,
      messageId: request.messageId
    };
  }

  setTimeoutForRequest(request, property, callback, delay) {
    clearTimeout(request[property]);
    request[property] = setTimeout(callback, Math.max(0, delay));
  }

  abortRequest(request, reason) {
    if (!request || request.aborted) return;
    request.abortReason = reason;
    request.aborted = true;
    request.controller.abort(new Error(reason));
  }

  stopCurrentRequest() {
    const request = this.activeRequest;
    if (!request) return { stopped: false };
    request.stopRequested = true;
    if (!request.started) {
      this.finishWithMessage(
        request,
        { reply: "", emotion: "idle", action: "none" },
        { stopped: true }
      );
      return { stopped: true };
    }
    this.abortRequest(request, "stop");
    return { stopped: true };
  }

  touchIdleTimer(request) {
    this.setTimeoutForRequest(request, "idleTimer", () => {
      this.abortRequest(request, "timeout");
    }, this.providerSettings.idleTimeoutMs);
  }

  emitPhase(requestId, phase) {
    clearTimeout(this.petStateResetTimer);
    this.petStateResetTimer = null;
    this.emitToChat("chat:phase", { requestId, phase });
    const state = this.persona.visuals.phaseStates[phase];
    if (state) {
      this.lastPetState = state;
      this.showPetInactive?.();
      this.sendToPet("pet:set-state", { state, force: true });
    }
  }

  emitDelta(request) {
    this.showPetInactive?.();
    this.emitToChat("chat:delta", {
      requestId: request.id,
      messageId: request.messageId,
      textDelta: request.lastDelta
    });
    this.sendToPet("pet:chat-bubble", {
      requestId: request.id,
      text: request.replyText,
      streaming: true,
      visible: true
    });
  }

  async buildProviderMessages(request) {
    await this.runtime.refresh();
    const context = buildContext(this.persona, this.session);
    const systemPrompt = buildSystemPrompt(
      this.persona,
      this.runtime.snapshot({
        petState: this.lastPetState,
        chatPhase: "thinking",
        relationship: this.providerSettings.relationship
      }),
      this.session
    );
    compactStoredSession(this.persona, this.session);
    this.sessions.save(this.activePersonaId, this.session);
    request.contextStats = context.stats;
    return [
      { role: "system", content: systemPrompt },
      ...context.messages
    ];
  }

  async runRequest(request) {
    request.started = true;
    this.emitPhase(request.id, "thinking");
    try {
      const keyState = await this.credentials.getApiKey();
      if (!keyState.apiKey) {
        throw new ProviderRequestError(
          "尚未配置 API Key",
          "CONFIG_MISSING"
        );
      }
      if (!this.providerSettings.baseUrl || !this.providerSettings.model) {
        throw new ProviderRequestError(
          "Provider 配置不完整",
          "CONFIG_MISSING"
        );
      }

      const messages = await this.buildProviderMessages(request);
      if (this.activeRequest !== request || request.clearRequested) return;

      const result = await this.providerClient.streamChat({
        config: {
          ...this.providerSettings,
          allowedEmotions: this.persona.prompt.L4.emotions,
          allowedActions: this.persona.prompt.L4.actions
        },
        apiKey: keyState.apiKey,
        messages,
        signal: request.controller.signal,
        onFirstContent: () => {
          if (this.activeRequest !== request) return;
          request.firstTokenSeen = true;
          clearTimeout(request.firstTokenTimer);
          this.emitPhase(request.id, "speaking");
          this.touchIdleTimer(request);
        },
        onContent: (textDelta) => {
          if (this.activeRequest !== request || !textDelta) return;
          request.lastDelta = textDelta;
          request.replyText += textDelta;
          this.touchIdleTimer(request);
          this.emitDelta(request);
        }
      });

      if (this.activeRequest !== request) return;
      await this.completeRequest(request, result);
    } catch (error) {
      if (this.activeRequest !== request) return;
      if (request.clearRequested) return;
      await this.failRequest(request, error);
    }
  }

  clearRequestTimers(request) {
    clearTimeout(request.firstTokenTimer);
    clearTimeout(request.idleTimer);
    clearTimeout(request.totalTimer);
  }

  finalStateFor(result) {
    const emotionState =
      this.persona.visuals.emotionStates[result.emotion] || "idle";
    if (emotionState !== "idle") return emotionState;
    return (
      {
        bounce: "happy",
        shake: "angry",
        wiggle: "shy",
        startle: "surprised",
        slump: "sad"
      }[result.action] || "idle"
    );
  }

  finishWithMessage(request, result, { stopped = false, degraded = false } = {}) {
    const reply = sanitizeText(result.reply, 50000);
    if (reply) {
      const assistantMessage = createMessage("assistant", reply, {
        status: stopped ? "stopped" : "complete",
        degraded
      });
      this.session.messages.push(assistantMessage);
      compactStoredSession(this.persona, this.session);
      this.sessions.save(this.activePersonaId, this.session);
      this.emitToChat("chat:done", {
        requestId: request.id,
        message: assistantMessage,
        stopped,
        degraded
      });
      this.sendToPet("pet:chat-bubble", {
        requestId: request.id,
        text: reply,
        streaming: false,
        visible: true,
        durationMs: Math.min(9000, Math.max(4200, reply.length * 80))
      });
    } else {
      this.emitToChat("chat:done", {
        requestId: request.id,
        message: null,
        stopped,
        degraded
      });
      this.sendToPet("pet:chat-bubble", {
        requestId: request.id,
        text: "",
        streaming: false,
        visible: false
      });
    }

    const state = stopped ? "idle" : this.finalStateFor(result);
    this.lastPetState = state;
    this.showPetInactive?.();
    this.sendToPet("pet:set-state", { state, force: true });
    clearTimeout(this.petStateResetTimer);
    this.petStateResetTimer = setTimeout(() => {
      this.lastPetState = "idle";
    }, 2600);
    this.petStateResetTimer.unref?.();
    this.clearRequestTimers(request);
    if (this.activeRequest === request) this.activeRequest = null;
  }

  async completeRequest(request, result) {
    if (request.stopRequested) {
      this.finishWithMessage(request, result, {
        stopped: true,
        degraded: result.degraded
      });
      return;
    }
    this.finishWithMessage(request, result, { degraded: result.degraded });
  }

  fallbackFor(error) {
    const replies = this.defaults.fallbackReplies;
    if (error?.code === "CONFIG_MISSING" || error?.code === "AUTH_ERROR") {
      return { text: replies.configuration, code: error.code };
    }
    if (error?.code === "INVALID_BASE_URL") {
      return { text: replies.configuration, code: error.code };
    }
    if (error?.name === "AbortError" || error?.message === "timeout") {
      return { text: replies.timeout, code: "TIMEOUT" };
    }
    if (error?.code === "INVALID_RESPONSE") {
      return { text: replies.invalidResponse, code: error.code };
    }
    return { text: replies.network, code: error?.code || "NETWORK_ERROR" };
  }

  async failRequest(request, error) {
    this.clearRequestTimers(request);
    if (request.stopRequested) {
      this.finishWithMessage(
        request,
        {
          reply: request.replyText,
          emotion: "idle",
          action: "none"
        },
        { stopped: true }
      );
      return;
    }

    const fallback = this.fallbackFor(error);
    let reply = fallback.text;
    let emotion = "sad";
    if (request.replyText) {
      const suffix = this.defaults.fallbackReplies.partial;
      request.lastDelta = suffix;
      request.replyText = `${request.replyText}${suffix}`;
      this.emitDelta(request);
      reply = request.replyText;
      emotion = "sad";
    }
    this.emitToChat("chat:error", {
      requestId: request.id,
      code: fallback.code,
      userMessage: fallback.text,
      retryable: true
    });
    this.finishWithMessage(
      request,
      {
        reply,
        emotion,
        action: "slump"
      },
      { degraded: true }
    );
  }

  async clearSession() {
    clearTimeout(this.petStateResetTimer);
    this.petStateResetTimer = null;
    const request = this.activeRequest;
    if (request) {
      request.clearRequested = true;
      this.abortRequest(request, "clear");
      this.clearRequestTimers(request);
      this.activeRequest = null;
    }
    this.session = this.sessions.clear(this.activePersonaId);
    this.lastPetState = "idle";
    this.sendToPet("pet:chat-bubble", {
      requestId: null,
      text: "",
      visible: false,
      streaming: false
    });
    this.sendToPet("pet:set-state", { state: "idle", force: true });
    this.emitToChat("chat:history", {
      personaId: this.activePersonaId,
      messages: this.session.messages,
      rollingSummary: this.session.rollingSummary
    });
    return { ok: true };
  }

  async switchPersona(personaId) {
    const nextId = sanitizeText(personaId, 64);
    if (!nextId || nextId === this.activePersonaId) {
      return { ok: true, personaId: this.activePersonaId };
    }
    const nextPersona = this.loadPersona(nextId);
    const request = this.activeRequest;
    if (request) {
      request.clearRequested = true;
      this.abortRequest(request, "switch-persona");
      this.clearRequestTimers(request);
      this.activeRequest = null;
    }
    this.activePersonaId = nextId;
    this.persona = nextPersona;
    this.session = this.sessions.load(nextId);
    this.lastPetState = "idle";
    this.sendToPet("pet:set-state", { state: "idle", force: true });
    this.emitToChat("chat:history", {
      personaId: nextId,
      messages: this.session.messages,
      rollingSummary: this.session.rollingSummary
    });
    return { ok: true, personaId: nextId };
  }

  async setApiKey(apiKey) {
    const result = await this.credentials.setApiKey(apiKey);
    return { ok: true, ...result };
  }

  async clearApiKey() {
    await this.credentials.clearApiKey();
    return { ok: true };
  }

  cleanup() {
    const request = this.activeRequest;
    if (request) {
      request.clearRequested = true;
      this.abortRequest(request, "cleanup");
      this.clearRequestTimers(request);
      this.activeRequest = null;
    }
    for (const channel of this.registeredHandlers.keys()) {
      ipcMain.removeHandler(channel);
    }
    this.registeredHandlers.clear();
    if (this.openListener) ipcMain.removeListener("chat:open", this.openListener);
    this.openListener = null;
    this.runtime.stopMonitor();
    clearTimeout(this.petStateResetTimer);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}

module.exports = {
  ChatModule,
  createMessage,
  writeJsonAtomic
};
