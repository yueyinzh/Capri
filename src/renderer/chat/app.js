const api = window.capriChat;

const elements = {
  settingsPanel: document.querySelector("#settings-panel"),
  toggleSettings: document.querySelector("#toggle-settings"),
  providerForm: document.querySelector("#provider-form"),
  baseUrl: document.querySelector("#base-url"),
  model: document.querySelector("#model"),
  relationship: document.querySelector("#relationship"),
  includeWindow: document.querySelector("#include-window"),
  saveProvider: document.querySelector("#save-provider"),
  keyForm: document.querySelector("#key-form"),
  apiKey: document.querySelector("#api-key"),
  saveKey: document.querySelector("#save-key"),
  deleteKey: document.querySelector("#delete-key"),
  keyBadge: document.querySelector("#key-badge"),
  chatStatus: document.querySelector("#chat-status"),
  messageList: document.querySelector("#message-list"),
  clearChat: document.querySelector("#clear-chat"),
  composer: document.querySelector("#composer"),
  input: document.querySelector("#message-input"),
  send: document.querySelector("#send-message"),
  stop: document.querySelector("#stop-generation"),
  composerStatus: document.querySelector("#composer-status")
};

let personaName = "摩羯";
let messages = [];
let activeRequestId = null;
let pendingAssistant = null;
let pendingText = "";
let hasApiKey = false;
let keyStorage = "none";
let busy = false;

const phaseLabels = {
  idle: "待命",
  listening: "在听",
  thinking: "琢磨中",
  speaking: "正在说"
};

const storageLabels = {
  keytar: "系统钥匙串",
  safeStorage: "系统加密文件",
  memory: "仅本次运行",
  none: "未保存"
};

function setComposerStatus(message) {
  elements.composerStatus.textContent = message || "会话保存在本机，按角色隔离";
}

function setPhase(phase) {
  elements.chatStatus.textContent = phaseLabels[phase] || phase;
  elements.chatStatus.dataset.phase = phase;
}

function updateBusyState() {
  elements.send.disabled = busy;
  elements.stop.hidden = !busy;
  elements.input.disabled = busy;
}

function updateKeyBadge() {
  elements.keyBadge.textContent = hasApiKey
    ? `KEY // ${storageLabels[keyStorage] || keyStorage}`
    : "KEY // MISSING";
  elements.keyBadge.classList.toggle("ready", hasApiKey);
}

function messageElement(message, { streaming = false } = {}) {
  const article = document.createElement("article");
  article.className = `message ${message.role === "user" ? "user" : "assistant"}`;
  if (message.degraded) article.classList.add("degraded");
  if (message.id) article.dataset.messageId = message.id;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent =
    message.role === "user"
      ? "YOU // LOCAL"
      : `${personaName.toUpperCase()} // REPLY${message.status === "stopped" ? " // STOPPED" : ""}`;

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = message.content;
  if (streaming) {
    const caret = document.createElement("i");
    caret.className = "streaming-caret";
    caret.setAttribute("aria-hidden", "true");
    body.append(caret);
  }

  article.append(meta, body);
  return article;
}

function scrollToBottom() {
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function renderEmptyState() {
  elements.messageList.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const title = document.createElement("strong");
  title.textContent = "PRIVATE CHANNEL READY";
  const text = document.createElement("p");
  text.textContent = "说点什么。她会用自己的方式回答，也会记住这个角色自己的会话。";
  empty.append(title, text);
  elements.messageList.append(empty);
}

function renderMessages() {
  elements.messageList.replaceChildren();
  if (!messages.length) {
    renderEmptyState();
    return;
  }
  for (const message of messages) {
    elements.messageList.append(messageElement(message));
  }
  scrollToBottom();
}

function appendMessage(message) {
  if (!messages.length) elements.messageList.replaceChildren();
  messages.push(message);
  elements.messageList.append(messageElement(message));
  scrollToBottom();
}

function startPendingAssistant(messageId) {
  if (!messages.length) elements.messageList.replaceChildren();
  pendingText = "";
  pendingAssistant = messageElement(
    {
      id: messageId,
      role: "assistant",
      content: "",
      degraded: false
    },
    { streaming: true }
  );
  elements.messageList.append(pendingAssistant);
  scrollToBottom();
}

function updatePendingAssistant(delta) {
  if (!pendingAssistant) return;
  pendingText += delta;
  const body = pendingAssistant.querySelector(".message-body");
  const caret = body.querySelector(".streaming-caret");
  body.textContent = pendingText;
  body.append(caret);
  scrollToBottom();
}

function finalizePendingAssistant(message, degraded) {
  if (!pendingAssistant) return;
  pendingAssistant.remove();
  pendingAssistant = null;
  pendingText = "";
  if (!message) return;
  const finalMessage = {
    ...message,
    degraded: degraded || message.degraded
  };
  messages.push(finalMessage);
  elements.messageList.append(messageElement(finalMessage));
  scrollToBottom();
}

function removePendingAssistant() {
  pendingAssistant?.remove();
  pendingAssistant = null;
  pendingText = "";
}

function renderConfig(config) {
  elements.baseUrl.value = config.baseUrl || "";
  elements.model.value = config.model || "";
  elements.relationship.value = config.relationship || "owner";
  elements.includeWindow.checked = config.includeActiveWindow !== false;
}

function toggleSettings(force) {
  const next =
    typeof force === "boolean" ? force : elements.settingsPanel.hidden;
  elements.settingsPanel.hidden = !next;
  elements.toggleSettings.setAttribute("aria-expanded", String(next));
  if (next) elements.baseUrl.focus();
}

async function bootstrap() {
  const data = await api.getBootstrap();
  personaName = data.persona?.displayName || "摩羯";
  messages = Array.isArray(data.messages) ? data.messages : [];
  hasApiKey = data.hasApiKey === true;
  keyStorage = data.storage || "none";
  renderConfig(data.config || {});
  updateKeyBadge();
  renderMessages();
  updateBusyState();
  setPhase("idle");
}

async function submitMessage() {
  const text = elements.input.value.trim();
  if (!text || busy) return;

  busy = true;
  updateBusyState();
  setComposerStatus("消息已送出");
  try {
    const accepted = await api.send(text);
    activeRequestId = accepted.requestId;
    appendMessage({
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      status: "complete"
    });
    elements.input.value = "";
  } catch (error) {
    busy = false;
    updateBusyState();
    setComposerStatus(error.message || "消息发送失败");
  }
}

elements.toggleSettings.addEventListener("click", () => toggleSettings());

elements.providerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.saveProvider.disabled = true;
  try {
    const config = await api.saveProvider({
      baseUrl: elements.baseUrl.value.trim(),
      model: elements.model.value.trim(),
      relationship: elements.relationship.value,
      includeActiveWindow: elements.includeWindow.checked
    });
    renderConfig(config);
    setComposerStatus("连接参数已保存");
  } catch (error) {
    setComposerStatus(error.message || "连接参数保存失败");
  } finally {
    elements.saveProvider.disabled = false;
  }
});

elements.keyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = elements.apiKey.value;
  if (!apiKey.trim()) {
    setComposerStatus("先填入 API Key");
    return;
  }
  elements.saveKey.disabled = true;
  try {
    const result = await api.setApiKey(apiKey);
    elements.apiKey.value = "";
    hasApiKey = true;
    keyStorage = result.storage;
    updateKeyBadge();
    setComposerStatus(
      result.persisted
        ? "密钥已安全保存"
        : "系统存储不可用，密钥仅在本次运行有效"
    );
  } catch (error) {
    setComposerStatus(error.message || "密钥保存失败");
  } finally {
    elements.saveKey.disabled = false;
  }
});

elements.deleteKey.addEventListener("click", async () => {
  try {
    await api.clearApiKey();
    hasApiKey = false;
    keyStorage = "none";
    updateKeyBadge();
    setComposerStatus("已删除保存的密钥");
  } catch (error) {
    setComposerStatus(error.message || "密钥删除失败");
  }
});

elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  submitMessage();
});

elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitMessage();
  }
});

elements.stop.addEventListener("click", async () => {
  elements.stop.disabled = true;
  try {
    await api.stop();
    setComposerStatus("正在停下");
  } finally {
    elements.stop.disabled = false;
  }
});

elements.clearChat.addEventListener("click", async () => {
  if (!window.confirm("清空当前角色的全部聊天记录？此操作不可撤销。")) return;
  try {
    await api.clear();
    activeRequestId = null;
    busy = false;
    updateBusyState();
    messages = [];
    removePendingAssistant();
    renderEmptyState();
    setComposerStatus("当前角色会话已清空");
  } catch (error) {
    setComposerStatus(error.message || "清空会话失败");
  }
});

api.onPhase(({ requestId, phase }) => {
  if (activeRequestId && requestId !== activeRequestId) return;
  activeRequestId ||= requestId;
  setPhase(phase);
  setComposerStatus(
    phase === "thinking" ? "等那边回话……" : phaseLabels[phase] || phase
  );
});

api.onDelta(({ requestId, messageId, textDelta }) => {
  if (activeRequestId && requestId !== activeRequestId) return;
  activeRequestId ||= requestId;
  if (!pendingAssistant) startPendingAssistant(messageId);
  updatePendingAssistant(textDelta);
});

api.onDone(({ requestId, message, stopped, degraded }) => {
  if (activeRequestId && requestId !== activeRequestId) return;
  activeRequestId = null;
  busy = false;
  updateBusyState();
  finalizePendingAssistant(message, degraded || stopped);
  setPhase("idle");
  setComposerStatus(
    stopped ? "已停止生成" : degraded ? "这次连接不太稳" : "收到回复"
  );
  elements.input.focus();
});

api.onError(({ requestId, userMessage }) => {
  if (activeRequestId && requestId !== activeRequestId) return;
  setComposerStatus(userMessage || "连接失败");
});

api.onHistory(({ messages: nextMessages }) => {
  messages = Array.isArray(nextMessages) ? nextMessages : [];
  removePendingAssistant();
  renderMessages();
});

bootstrap().catch((error) => {
  setComposerStatus(error.message || "聊天模块初始化失败");
  renderEmptyState();
});
