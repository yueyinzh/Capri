const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "capri-pet.chat";
const ACCOUNT = "default";

function loadKeytar() {
  try {
    return require("keytar");
  } catch {
    return null;
  }
}

function getSafeStorage() {
  try {
    const { safeStorage } = require("electron");
    return safeStorage || null;
  } catch {
    return null;
  }
}

async function encryptionIsUsable(safeStorage) {
  if (!safeStorage?.isAsyncEncryptionAvailable) return false;
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
  if (
    process.platform === "linux" &&
    safeStorage.getSelectedStorageBackend?.() === "basic_text"
  ) {
    return false;
  }
  return true;
}

class CredentialStore {
  constructor({ userDataDir, keytarProvider = loadKeytar }) {
    this.userDataDir = userDataDir;
    this.fallbackPath = path.join(userDataDir, "chat", "provider-key.enc");
    this.keytarProvider = keytarProvider;
    this.memoryKey = null;
    this.storage = "none";
  }

  sanitizeKey(apiKey) {
    if (typeof apiKey !== "string") throw new Error("API Key 格式无效");
    const value = apiKey.trim();
    if (!value || value.length > 4096) throw new Error("API Key 长度无效");
    if (/\s/.test(value)) throw new Error("API Key 不能包含空白字符");
    return value;
  }

  async readFallback() {
    const safeStorage = getSafeStorage();
    if (!safeStorage || !(await encryptionIsUsable(safeStorage))) return null;
    try {
      const record = JSON.parse(fs.readFileSync(this.fallbackPath, "utf8"));
      if (record?.version !== 1 || typeof record.ciphertext !== "string") {
        return null;
      }
      const encrypted = Buffer.from(record.ciphertext, "base64");
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      return decrypted?.result || null;
    } catch {
      return null;
    }
  }

  async writeFallback(apiKey) {
    const safeStorage = getSafeStorage();
    if (!safeStorage || !(await encryptionIsUsable(safeStorage))) return false;
    const ciphertext = (await safeStorage.encryptStringAsync(apiKey)).toString(
      "base64"
    );
    const target = this.fallbackPath;
    const temp = `${target}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      temp,
      `${JSON.stringify({ version: 1, ciphertext }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    fs.renameSync(temp, target);
    return true;
  }

  removeFallback() {
    try {
      fs.unlinkSync(this.fallbackPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  async getApiKey() {
    if (this.memoryKey) {
      return { apiKey: this.memoryKey, storage: "memory" };
    }

    const keytar = this.keytarProvider();
    if (keytar) {
      try {
        const value = await keytar.getPassword(SERVICE, ACCOUNT);
        if (value) {
          this.storage = "keytar";
          return { apiKey: value, storage: this.storage };
        }
      } catch {
        // Fall through to Electron safeStorage.
      }
    }

    const fallback = await this.readFallback();
    if (fallback) {
      this.storage = "safeStorage";
      return { apiKey: fallback, storage: this.storage };
    }

    this.storage = "none";
    return { apiKey: null, storage: "none" };
  }

  async setApiKey(apiKey) {
    const value = this.sanitizeKey(apiKey);
    const keytar = this.keytarProvider();
    if (keytar) {
      try {
        await keytar.setPassword(SERVICE, ACCOUNT, value);
        this.memoryKey = null;
        this.storage = "keytar";
        this.removeFallback();
        return { persisted: true, storage: this.storage };
      } catch {
        // Fall through to Electron safeStorage.
      }
    }

    if (await this.writeFallback(value)) {
      this.memoryKey = null;
      this.storage = "safeStorage";
      return { persisted: true, storage: this.storage };
    }

    this.memoryKey = value;
    this.storage = "memory";
    return { persisted: false, storage: this.storage };
  }

  async clearApiKey() {
    const keytar = this.keytarProvider();
    if (keytar) {
      try {
        await keytar.deletePassword(SERVICE, ACCOUNT);
      } catch {
        // A missing credential or unavailable keychain is safe to ignore.
      }
    }
    this.memoryKey = null;
    this.storage = "none";
    this.removeFallback();
    return true;
  }
}

module.exports = {
  CredentialStore,
  encryptionIsUsable
};
