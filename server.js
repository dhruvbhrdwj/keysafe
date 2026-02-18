const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || 4312;
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_VAULT_FILE = path.join(__dirname, "data", "vault.json");
const VAULT_FILE = process.env.VAULT_FILE
  ? path.resolve(process.env.VAULT_FILE)
  : DEFAULT_VAULT_FILE;
const DATA_DIR = path.dirname(VAULT_FILE);
const LOCK_TIMEOUT_MS = 15 * 60 * 1000;
const KDF_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  keyLen: 32
};
const VERIFIER_TEXT = "key-manager-verifier-v1";

const state = {
  initialized: false,
  unlocked: false,
  vault: null,
  key: null,
  lastActivity: 0
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function encodeBase64(buffer) {
  return buffer.toString("base64");
}

function decodeBase64(value) {
  return Buffer.from(value, "base64");
}

function deriveKey(masterPassword, salt, params) {
  return crypto.scryptSync(masterPassword, salt, params.keyLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * 1024 * 1024
  });
}

function encryptText(plainText, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plainText, "utf8")),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return {
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(ciphertext),
    tag: encodeBase64(tag)
  };
}

function decryptText(payload, key) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    decodeBase64(payload.iv)
  );
  decipher.setAuthTag(decodeBase64(payload.tag));
  const plaintext = Buffer.concat([
    decipher.update(decodeBase64(payload.ciphertext)),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
}

function encryptJSON(value, key) {
  return encryptText(JSON.stringify(value), key);
}

function decryptJSON(payload, key) {
  return JSON.parse(decryptText(payload, key));
}

function writeVaultFile(document) {
  ensureDataDir();
  fs.writeFileSync(VAULT_FILE, JSON.stringify(document, null, 2), {
    mode: 0o600
  });
}

function readVaultFile() {
  const raw = fs.readFileSync(VAULT_FILE, "utf8");
  return JSON.parse(raw);
}

function fileExists(filepath) {
  try {
    fs.accessSync(filepath);
    return true;
  } catch {
    return false;
  }
}

function loadInitializationState() {
  state.initialized = fileExists(VAULT_FILE);
}

function lockVault() {
  if (state.key) {
    state.key.fill(0);
  }
  state.unlocked = false;
  state.vault = null;
  state.key = null;
  state.lastActivity = 0;
}

function touchActivity() {
  state.lastActivity = Date.now();
}

function autoLockIfIdle() {
  if (!state.unlocked) {
    return;
  }
  if (Date.now() - state.lastActivity > LOCK_TIMEOUT_MS) {
    lockVault();
  }
}

function saveDecryptedVault() {
  if (!state.unlocked || !state.key || !state.vault) {
    throw new Error("Vault is locked");
  }
  const document = readVaultFile();
  document.encryptedVault = encryptJSON(state.vault, state.key);
  document.updatedAt = new Date().toISOString();
  writeVaultFile(document);
}

function publicEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    provider: entry.provider,
    environment: entry.environment,
    tags: entry.tags,
    notes: entry.notes,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

function parseTags(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const unique = new Set();
  for (const tag of input) {
    if (typeof tag !== "string") {
      continue;
    }
    const normalized = tag.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized.slice(0, 32));
  }
  return [...unique];
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function filterEntries(entries, query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    return entries;
  }
  return entries.filter((entry) => {
    const haystack = [
      entry.name,
      entry.provider,
      entry.environment,
      entry.notes,
      ...(entry.tags || [])
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function notFound(res) {
  sendError(res, 404, "Not found");
}

function requireUnlocked(res) {
  if (!state.unlocked || !state.vault) {
    sendError(res, 401, "Vault is locked");
    return false;
  }
  touchActivity();
  return true;
}

function createVault(masterPassword) {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(masterPassword, salt, KDF_PARAMS);
  const now = new Date().toISOString();
  const vault = {
    entries: [],
    createdAt: now,
    updatedAt: now
  };
  const document = {
    version: 1,
    kdf: {
      salt: encodeBase64(salt),
      N: KDF_PARAMS.N,
      r: KDF_PARAMS.r,
      p: KDF_PARAMS.p,
      keyLen: KDF_PARAMS.keyLen
    },
    verifier: encryptText(VERIFIER_TEXT, key),
    encryptedVault: encryptJSON(vault, key),
    updatedAt: now
  };
  writeVaultFile(document);
  state.initialized = true;
  state.unlocked = true;
  state.key = key;
  state.vault = vault;
  touchActivity();
}

function unlockVault(masterPassword) {
  const document = readVaultFile();
  const salt = decodeBase64(document.kdf.salt);
  const key = deriveKey(masterPassword, salt, document.kdf);
  let verifier = "";
  try {
    verifier = decryptText(document.verifier, key);
  } catch {
    throw new Error("Invalid master password");
  }
  if (verifier !== VERIFIER_TEXT) {
    key.fill(0);
    throw new Error("Invalid master password");
  }
  const vault = decryptJSON(document.encryptedVault, key);
  state.initialized = true;
  state.unlocked = true;
  state.key = key;
  state.vault = vault;
  touchActivity();
}

function parseIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/keys\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseRevealPath(pathname) {
  const match = pathname.match(/^\/api\/keys\/([^/]+)\/reveal$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/vault/status") {
    sendJson(res, 200, {
      initialized: state.initialized,
      unlocked: state.unlocked,
      lockTimeoutMinutes: Math.floor(LOCK_TIMEOUT_MS / 60000)
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/vault/init") {
    if (state.initialized) {
      sendError(res, 409, "Vault already initialized");
      return;
    }
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    const masterPassword =
      typeof body.masterPassword === "string" ? body.masterPassword : "";
    if (masterPassword.length < 12) {
      sendError(res, 400, "Master password must be at least 12 characters");
      return;
    }
    createVault(masterPassword);
    sendJson(res, 201, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/vault/unlock") {
    if (!state.initialized) {
      sendError(res, 400, "Vault not initialized");
      return;
    }
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    const masterPassword =
      typeof body.masterPassword === "string" ? body.masterPassword : "";
    if (!masterPassword) {
      sendError(res, 400, "Master password is required");
      return;
    }
    try {
      unlockVault(masterPassword);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendError(res, 401, error.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/vault/lock") {
    lockVault();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/keys") {
    if (!requireUnlocked(res)) {
      return;
    }
    const search = url.searchParams.get("search") || "";
    const filtered = filterEntries(state.vault.entries, search);
    sendJson(res, 200, {
      entries: filtered
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(publicEntry)
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/keys") {
    if (!requireUnlocked(res)) {
      return;
    }
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    const name = normalizeText(body.name, 80);
    const provider = normalizeText(body.provider, 80);
    const environment = normalizeText(body.environment, 50) || "default";
    const secret = typeof body.secret === "string" ? body.secret : "";
    const notes = normalizeText(body.notes, 500);
    const tags = parseTags(body.tags);
    if (!name) {
      sendError(res, 400, "Name is required");
      return;
    }
    if (!secret.trim()) {
      sendError(res, 400, "Secret value is required");
      return;
    }
    const now = new Date().toISOString();
    const entry = {
      id: crypto.randomUUID(),
      name,
      provider,
      environment,
      secret,
      tags,
      notes,
      createdAt: now,
      updatedAt: now
    };
    state.vault.entries.push(entry);
    state.vault.updatedAt = now;
    saveDecryptedVault();
    sendJson(res, 201, { entry: publicEntry(entry) });
    return;
  }

  if (req.method === "PUT" && parseIdFromPath(url.pathname)) {
    if (!requireUnlocked(res)) {
      return;
    }
    const id = parseIdFromPath(url.pathname);
    const entry = state.vault.entries.find((item) => item.id === id);
    if (!entry) {
      sendError(res, 404, "Entry not found");
      return;
    }
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    const name = normalizeText(body.name, 80);
    const provider = normalizeText(body.provider, 80);
    const environment = normalizeText(body.environment, 50) || "default";
    const notes = normalizeText(body.notes, 500);
    const tags = parseTags(body.tags);
    const secret = typeof body.secret === "string" ? body.secret : "";
    if (!name) {
      sendError(res, 400, "Name is required");
      return;
    }
    if (!secret.trim()) {
      sendError(res, 400, "Secret value is required");
      return;
    }
    entry.name = name;
    entry.provider = provider;
    entry.environment = environment;
    entry.secret = secret;
    entry.tags = tags;
    entry.notes = notes;
    entry.updatedAt = new Date().toISOString();
    state.vault.updatedAt = entry.updatedAt;
    saveDecryptedVault();
    sendJson(res, 200, { entry: publicEntry(entry) });
    return;
  }

  if (req.method === "DELETE" && parseIdFromPath(url.pathname)) {
    if (!requireUnlocked(res)) {
      return;
    }
    const id = parseIdFromPath(url.pathname);
    const before = state.vault.entries.length;
    state.vault.entries = state.vault.entries.filter((entry) => entry.id !== id);
    if (state.vault.entries.length === before) {
      sendError(res, 404, "Entry not found");
      return;
    }
    state.vault.updatedAt = new Date().toISOString();
    saveDecryptedVault();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && parseRevealPath(url.pathname)) {
    if (!requireUnlocked(res)) {
      return;
    }
    const id = parseRevealPath(url.pathname);
    const entry = state.vault.entries.find((item) => item.id === id);
    if (!entry) {
      sendError(res, 404, "Entry not found");
      return;
    }
    sendJson(res, 200, { secret: entry.secret });
    return;
  }

  notFound(res);
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, url) {
  let pathname = url.pathname;
  if (pathname === "/") {
    pathname = "/index.html";
  }
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, "Forbidden");
    return;
  }
  fs.readFile(safePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendError(res, 404, "Not found");
      } else {
        sendError(res, 500, "Internal server error");
      }
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

loadInitializationState();
setInterval(autoLockIfIdle, 15 * 1000).unref();

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendError(res, 400, "Bad request");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== "GET") {
      sendError(res, 405, "Method not allowed");
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendError(res, 500, error.message || "Internal server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Key manager is running at http://${HOST}:${PORT}`);
});
