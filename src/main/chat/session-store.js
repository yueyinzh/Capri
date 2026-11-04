const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SAFE_PERSONA_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function createSession(personaId) {
  const now = new Date().toISOString();
  return {
    version: 1,
    personaId,
    messages: [],
    rollingSummary: "",
    summaryThroughMessageId: null,
    createdAt: now,
    updatedAt: now
  };
}

function normalizeSession(candidate, personaId) {
  const session = createSession(personaId);
  if (!candidate || typeof candidate !== "object") return session;
  if (candidate.personaId !== personaId) return session;

  session.messages = Array.isArray(candidate.messages)
    ? candidate.messages
        .filter(
          (message) =>
            message &&
            (message.role === "user" || message.role === "assistant") &&
            typeof message.content === "string" &&
            message.content.trim()
        )
        .map((message) => ({
          id:
            typeof message.id === "string" && message.id
              ? message.id
              : crypto.randomUUID(),
          role: message.role,
          content: message.content,
          createdAt:
            typeof message.createdAt === "string"
              ? message.createdAt
              : new Date().toISOString(),
          status: message.status === "stopped" ? "stopped" : "complete",
          degraded: message.degraded === true
        }))
    : [];
  session.rollingSummary =
    typeof candidate.rollingSummary === "string"
      ? candidate.rollingSummary
      : "";
  session.summaryThroughMessageId =
    typeof candidate.summaryThroughMessageId === "string"
      ? candidate.summaryThroughMessageId
      : null;
  session.createdAt =
    typeof candidate.createdAt === "string"
      ? candidate.createdAt
      : session.createdAt;
  session.updatedAt =
    typeof candidate.updatedAt === "string"
      ? candidate.updatedAt
      : session.updatedAt;
  return session;
}

class SessionStore {
  constructor({ baseDir }) {
    this.baseDir = baseDir;
  }

  sessionPath(personaId) {
    if (!SAFE_PERSONA_ID.test(personaId)) {
      throw new Error("无效的角色 ID");
    }
    return path.join(this.baseDir, "sessions", `${personaId}.json`);
  }

  load(personaId) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.sessionPath(personaId), "utf8")
      );
      return normalizeSession(parsed, personaId);
    } catch {
      return createSession(personaId);
    }
  }

  save(personaId, session) {
    const target = this.sessionPath(personaId);
    const temp = `${target}.tmp`;
    session.personaId = personaId;
    session.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(session, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    fs.renameSync(temp, target);
    return session;
  }

  clear(personaId) {
    const target = this.sessionPath(personaId);
    try {
      fs.unlinkSync(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return createSession(personaId);
  }
}

module.exports = {
  SessionStore,
  createSession,
  normalizeSession
};
