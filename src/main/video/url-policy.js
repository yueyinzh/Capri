const dns = require("node:dns/promises");
const net = require("node:net");

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa"
];

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 ||
    (a === 255 && b === 255 && c === 255)
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("2001:db8:")) return true;

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateIpv4(
      `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
    );
  }
  return false;
}

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

function isBlockedHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.+$/, "");
  return (
    normalized === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

async function validateVideoUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    throw new Error("网址格式无效");
  }
  const input = rawUrl.trim();
  if (!input || input.length > 2048) {
    throw new Error("网址为空或过长");
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("请输入完整的 http 或 https 网址");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("仅支持 http 和 https 网址");
  }
  if (parsed.username || parsed.password) {
    throw new Error("网址不能包含用户名或密码");
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error("不允许访问本机或内网地址");
  }

  const literalIp = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(literalIp)
    ? [{ address: literalIp }]
    : await dns.lookup(parsed.hostname, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("不允许访问本机、内网或保留地址");
  }

  parsed.hash = "";
  return parsed.href;
}

module.exports = {
  validateVideoUrl,
  isPrivateAddress
};
