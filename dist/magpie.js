// src/magpie/index.ts
import { createHash as createHash2 } from "node:crypto";

// src/auth/login.ts
import crypto2 from "node:crypto";

// src/cosy.ts
import crypto from "node:crypto";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname2, join as join2 } from "node:path";

// src/cosy-version.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
var BUNDLED_GATEWAY_COSY_VERSION = "1.1.72";
var QODER_CLI_RELEASES_URL = "https://repo.qoder.com/repos/QoderAI/changelog-CLI/releases?per_page=5&page=1";
var CACHE_FILE = "qoder-cosy-version-cache.json";
var REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1e3;
var FETCH_TIMEOUT_MS = 5e3;
function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}
function getCosyVersionCachePath() {
  return join(getHomeDir(), ".pi", "agent", CACHE_FILE);
}
var cosyVersionMem = /* @__PURE__ */ new Map();
function readCosyVersionCache() {
  const cachePath = getCosyVersionCachePath();
  if (cosyVersionMem.has(cachePath)) {
    return cosyVersionMem.get(cachePath) ?? null;
  }
  if (!existsSync(cachePath)) {
    cosyVersionMem.set(cachePath, null);
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(cachePath, "utf8"));
    cosyVersionMem.set(cachePath, data);
    return data;
  } catch {
    cosyVersionMem.set(cachePath, null);
    return null;
  }
}
function writeCosyVersionCache(data) {
  const cachePath = getCosyVersionCachePath();
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
  }
  cosyVersionMem.set(cachePath, data);
}
function isCliVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}
function compareCliVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
function getGatewayCosyVersion() {
  const cached = readCosyVersionCache()?.version;
  if (isCliVersion(cached) && compareCliVersions(cached, BUNDLED_GATEWAY_COSY_VERSION) >= 0) {
    return cached;
  }
  return BUNDLED_GATEWAY_COSY_VERSION;
}
var refreshInFlight = null;
async function refreshGatewayCosyVersion(options) {
  const now = options?.now ?? Date.now();
  const checkedAt = readCosyVersionCache()?.checkedAt;
  if (!options?.force && typeof checkedAt === "number" && now - checkedAt < REFRESH_INTERVAL_MS) {
    return;
  }
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let releases;
      try {
        const response = await fetch(QODER_CLI_RELEASES_URL, {
          headers: { Accept: "application/vnd.github.v3+json" },
          signal: controller.signal
        });
        if (!response.ok) return;
        releases = await response.json();
      } finally {
        clearTimeout(timer);
      }
      if (!Array.isArray(releases)) return;
      const latest = releases.find(
        (release) => release && !release.draft && !release.prerelease && isCliVersion(release.tag_name)
      );
      const stampedAt = Date.now();
      if (latest && compareCliVersions(latest.tag_name, getGatewayCosyVersion()) > 0) {
        writeCosyVersionCache({ version: latest.tag_name, checkedAt: stampedAt });
      } else {
        writeCosyVersionCache({ version: readCosyVersionCache()?.version, checkedAt: stampedAt });
      }
    } catch {
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// src/cosy.ts
var qoderRSAPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
var QODER_OPENAPI_COSY_VERSION = "1.0.1";
var QODER_CLIENT_TYPE = "5";
var QoderDataPolicy = "disagree";
var QoderLoginVersion = "v2";
var QoderMachineOS = process.platform === "win32" ? process.arch === "arm64" ? "aarch64_windows" : "x86_64_windows" : process.arch === "arm64" ? "aarch64_linux" : "x86_64_linux";
var QoderMachineTypeMagic = "5";
function rsaEncryptBase64(data) {
  const key = {
    key: qoderRSAPublicKey,
    padding: crypto.constants.RSA_PKCS1_PADDING
  };
  const encrypted = crypto.publicEncrypt(key, typeof data === "string" ? Buffer.from(data) : data);
  return encrypted.toString("base64");
}
function aesEncryptCBCBase64(plaintext, keyStr) {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(keyStr), Buffer.from(keyStr));
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}
function computeSigPath(urlStr) {
  const parsed = new URL(urlStr);
  let sigPath = parsed.pathname;
  if (sigPath.startsWith("/algo")) {
    sigPath = sigPath.substring("/algo".length);
  }
  return sigPath;
}
function getHomeDir2() {
  return process.env.HOME || process.env.USERPROFILE || homedir2();
}
function getMachineId() {
  const home = getHomeDir2();
  const paths = [join2(home, ".qoder", ".auth", "machine_id"), join2(home, ".pi", "agent", "qoder-machine-id")];
  for (const p of paths) {
    if (existsSync2(p)) {
      try {
        const val = readFileSync2(p, "utf8").trim();
        if (val) return val;
      } catch {
      }
    }
  }
  const newId = crypto.randomUUID();
  try {
    const savePath = paths[1];
    mkdirSync2(dirname2(savePath), { recursive: true });
    writeFileSync2(savePath, newId, "utf8");
  } catch {
  }
  return newId;
}
function buildAuthHeaders(body, requestURL, creds) {
  if (!creds.userID) {
    throw new Error("cosy: user id is empty");
  }
  if (!creds.authToken) {
    throw new Error("cosy: auth token is empty");
  }
  const aesKey = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const userInfo = {
    uid: creds.userID,
    security_oauth_token: creds.authToken,
    name: creds.name || "",
    aid: "",
    email: creds.email || ""
  };
  const infoB64 = aesEncryptCBCBase64(JSON.stringify(userInfo), aesKey);
  const cosyKey = rsaEncryptBase64(aesKey);
  const timestamp = Math.floor(Date.now() / 1e3).toString();
  const requestId = crypto.randomUUID();
  const cosyVersion = getGatewayCosyVersion();
  const cosyPayload = {
    version: "v1",
    requestId,
    info: infoB64,
    cosyVersion,
    ideVersion: ""
  };
  const payloadB64 = Buffer.from(JSON.stringify(cosyPayload)).toString("base64");
  const sigPath = computeSigPath(requestURL);
  const bodyBytes = body ? Buffer.isBuffer(body) ? body : Buffer.from(body) : Buffer.alloc(0);
  const sig = crypto.createHash("md5").update(payloadB64).update("\n").update(cosyKey).update("\n").update(timestamp).update("\n").update(bodyBytes).update("\n").update(sigPath).digest("hex");
  const bodyHash = crypto.createHash("md5").update(bodyBytes).digest("hex");
  const bodyLen = bodyBytes.length.toString();
  const machineID = creds.machineID || getMachineId();
  return {
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": creds.userID,
    "Cosy-Date": timestamp,
    "Cosy-Version": cosyVersion,
    "Cosy-Machineid": machineID,
    "Cosy-Machinetoken": machineID,
    "Cosy-Machinetype": QoderMachineTypeMagic,
    "Cosy-Machineos": QoderMachineOS,
    "Cosy-Clienttype": QODER_CLIENT_TYPE,
    "Cosy-Clientip": "127.0.0.1",
    "Cosy-Bodyhash": bodyHash,
    "Cosy-Bodylength": bodyLen,
    "Cosy-Sigpath": sigPath,
    "Cosy-Data-Policy": QoderDataPolicy,
    "Cosy-Organization-Id": "",
    "Cosy-Organization-Tags": "",
    "Login-Version": QoderLoginVersion,
    "X-Request-Id": crypto.randomUUID()
  };
}

// src/region.ts
var QODER_REGIONS = {
  global: {
    mode: "global",
    providerID: "qoder",
    baseUrl: "https://api3.qoder.sh/",
    openApiUrl: "https://openapi.qoder.sh",
    centerUrl: "https://center.qoder.sh",
    manageUrl: "https://qoder.com",
    patManageUrl: "https://qoder.com/account/integrations",
    deviceLoginUrl: "https://qoder.com/device/selectAccounts",
    modelCacheFile: "qoder-models-cache.json",
    patEnvNames: ["QODER_API_KEY", "QODER_PERSONAL_ACCESS_TOKEN", "QODER_PAT"],
    loginName: "Qoder (Browser OAuth / PAT)",
    userNameFallback: "Qoder User",
    userEmailFallback: "user@qoder.com",
    usageTitle: "Qoder AI Plan",
    supportsBrowserLogin: true
  },
  cn: {
    mode: "cn",
    providerID: "qoder-cn",
    baseUrl: "https://gateway.qoder.com.cn/",
    openApiUrl: "https://openapi.qoder.com.cn",
    centerUrl: "https://gateway.qoder.com.cn",
    manageUrl: "https://qoder.com.cn",
    patManageUrl: "https://qoder.com.cn/account/integrations",
    modelCacheFile: "qoder-cn-models-cache.json",
    patEnvNames: ["QODERCN_API_KEY", "QODERCN_PERSONAL_ACCESS_TOKEN", "QODERCN_PAT"],
    loginName: "Qoder CN (PAT)",
    userNameFallback: "Qoder CN User",
    userEmailFallback: "user@qoder.com.cn",
    usageTitle: "Qoder CN Plan",
    supportsBrowserLogin: false
  }
};
function getQoderRegionConfig(mode) {
  return QODER_REGIONS[mode];
}
function getQoderBaseUrl(mode) {
  return getQoderRegionConfig(mode).baseUrl;
}
function getQoderModelListURL(mode) {
  return `${getQoderBaseUrl(mode)}algo/api/v2/model/list?Encode=1`;
}
function getQoderChatURL(mode) {
  return `${getQoderBaseUrl(mode)}algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
}
function getQoderExchangeURL(mode) {
  return `${getQoderRegionConfig(mode).openApiUrl}/api/v1/jobToken/exchange`;
}
function getQoderUserInfoURL(mode) {
  return `${getQoderRegionConfig(mode).openApiUrl}/api/v1/userinfo`;
}
function getQoderUsageURL(mode) {
  return `${getQoderRegionConfig(mode).openApiUrl}/api/v2/quota/usage`;
}
function getQoderRefreshURL(mode) {
  return `${getQoderRegionConfig(mode).centerUrl}/algo/api/v3/user/refresh_token`;
}
function getQoderDeviceLoginURL(codeChallenge, machineID, nonce) {
  const baseUrl = getQoderRegionConfig("global").deviceLoginUrl;
  if (!baseUrl) throw new Error("Qoder browser login URL is not configured");
  return `${baseUrl}?challenge=${codeChallenge}&challenge_method=S256&machine_id=${machineID}&nonce=${nonce}`;
}
function getQoderDevicePollURL(nonce, codeVerifier) {
  const baseUrl = getQoderRegionConfig("global").openApiUrl;
  return `${baseUrl}/api/v1/deviceToken/poll?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(codeVerifier)}&challenge_method=S256`;
}

// src/protocol/errors.ts
var QoderHttpError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "QoderHttpError";
  }
  status;
};
var QoderQueuedError = class extends QoderHttpError {
  waitMs;
  queueCount;
  queueType;
  constructor(waitMs, queueCount, queueType) {
    const wait = Number.isSafeInteger(waitMs) && waitMs > 0 ? waitMs : 0;
    const count = typeof queueCount === "number" && Number.isSafeInteger(queueCount) && queueCount >= 0 ? queueCount : void 0;
    const tier = typeof queueType === "string" && /^p[0-9]{1,2}$/.test(queueType) ? queueType : void 0;
    const ahead = count !== void 0 ? `, ${count} ahead` : "";
    const label = tier ? ` (${tier})` : "";
    super(
      `Qoder model is busy: request queued (10605 CALL_COUNT_LIMIT${label}${ahead}, ~${Math.round(wait / 1e3)}s wait, rate limit, retry-after-ms=${wait})`,
      429
    );
    this.name = "QoderQueuedError";
    this.waitMs = wait;
    this.queueCount = count;
    this.queueType = tier;
  }
};

// src/auth/pat.ts
var UA = "pi-provider-qoder";
var PAT_REFRESH_PREFIX = "pat";
function isPatRefresh(refresh) {
  return refresh.startsWith(`${PAT_REFRESH_PREFIX}|`);
}
function encodePatRefresh(pat, jobRefreshToken, userID, machineID) {
  return [PAT_REFRESH_PREFIX, pat, jobRefreshToken, userID, machineID].join("|");
}
function decodePatRefresh(refresh) {
  const parts = refresh.split("|");
  return {
    pat: parts[1] || "",
    jobRefreshToken: parts[2] || "",
    userID: parts[3] || "",
    machineID: parts[4] || ""
  };
}
async function exchangeJobToken(pat, mode, signal) {
  const res = await fetch(getQoderExchangeURL(mode), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
      "Cosy-Version": QODER_OPENAPI_COSY_VERSION,
      "Cosy-ClientType": QODER_CLIENT_TYPE
    },
    body: JSON.stringify({ personal_token: pat }),
    signal
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new QoderHttpError(
      `Qoder PAT exchange failed: ${res.status} ${res.statusText}. ${text.slice(0, 200)}`,
      res.status
    );
  }
  const data = await res.json();
  if (!data.token) {
    throw new Error("Qoder PAT exchange returned no job token");
  }
  let expiresAt = Date.now() + 24 * 60 * 60 * 1e3;
  if (data.expires_at) {
    const parsed = Date.parse(data.expires_at);
    if (!Number.isNaN(parsed)) expiresAt = parsed;
  } else if (data.expires_in) {
    expiresAt = Date.now() + data.expires_in;
  }
  return {
    jobToken: data.token,
    jobRefreshToken: data.refresh_token || "",
    expiresAt
  };
}
async function fetchUserInfo(jobToken, mode, signal, strict = false) {
  let userID = "";
  let email = "";
  let name = "";
  try {
    const res = await fetch(getQoderUserInfoURL(mode), {
      signal,
      headers: {
        Authorization: `Bearer ${jobToken}`,
        Accept: "application/json",
        "User-Agent": UA,
        "Cosy-Version": QODER_OPENAPI_COSY_VERSION,
        "Cosy-ClientType": QODER_CLIENT_TYPE
      }
    });
    if (strict && !res.ok) throw new QoderHttpError("Qoder profile request failed", res.status);
    if (res.ok) {
      const info = await res.json();
      userID = info.id || "";
      email = info.email || "";
      name = info.name || info.username || "";
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (strict) throw error;
  }
  return { userID, email, name };
}
async function credentialsFromPat(pat, mode, signal) {
  const region = getQoderRegionConfig(mode);
  const { jobToken, jobRefreshToken, expiresAt } = await exchangeJobToken(pat, mode, signal);
  const { userID, email, name } = await fetchUserInfo(jobToken, mode, signal);
  const machineID = getMachineId();
  return {
    refresh: encodePatRefresh(pat, jobRefreshToken, userID, machineID),
    access: jobToken,
    expires: expiresAt - 5 * 60 * 1e3,
    // 5 min buffer
    userID,
    email: email || region.userEmailFallback,
    name: name || region.userNameFallback,
    machineID
  };
}

// src/auth/login.ts
function getPrompt(callbacks) {
  return callbacks.onPrompt;
}
function getProgress(callbacks) {
  return callbacks.onProgress;
}
function getSignal(callbacks) {
  return callbacks.signal;
}
function generatePKCE() {
  const codeVerifier = crypto2.randomBytes(32).toString("base64url");
  const codeChallenge = crypto2.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}
function parseExpiresAt(s, expiresInSeconds) {
  if (s) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
    const ms = Number.parseInt(s, 10);
    if (!Number.isNaN(ms) && ms > 0) return ms;
  }
  if (expiresInSeconds && expiresInSeconds > 0) {
    return Date.now() + expiresInSeconds * 1e3;
  }
  return Date.now() + 30 * 24 * 60 * 60 * 1e3;
}
async function interactiveLogin(callbacks, mode) {
  const region = getQoderRegionConfig(mode);
  const prompt = getPrompt(callbacks);
  const pat = await prompt({
    message: !region.supportsBrowserLogin ? "Paste a Qoder CN Personal Access Token, or leave empty to cancel" : "Paste a Qoder Personal Access Token (pt-...), or leave empty for browser login",
    placeholder: "pt-...",
    allowEmpty: true
  });
  if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
  if (pat?.trim()) {
    return patLogin(callbacks, pat.trim(), mode);
  }
  if (!region.supportsBrowserLogin) {
    throw new Error(
      `Qoder CN browser login is not supported here. Paste a Qoder CN PAT from ${region.patManageUrl} or set QODERCN_PERSONAL_ACCESS_TOKEN.`
    );
  }
  if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
  return runDeviceFlow(callbacks);
}
async function patLogin(callbacks, providedPat, mode) {
  const region = getQoderRegionConfig(mode);
  let pat = providedPat;
  if (!pat) {
    const prompt = getPrompt(callbacks);
    const entered = await prompt({
      message: !region.supportsBrowserLogin ? "Paste your Qoder CN Personal Access Token" : "Paste your Qoder Personal Access Token (pt-...)",
      placeholder: "pt-...",
      allowEmpty: false
    });
    if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
    pat = entered?.trim();
  }
  if (!pat) {
    throw new Error("No Personal Access Token provided");
  }
  getProgress(callbacks)?.("Exchanging access token...");
  const creds = await credentialsFromPat(pat, mode);
  getProgress(callbacks)?.("Login successful!");
  return creds;
}
function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error("Login cancelled"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new Error("Login cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function runDeviceFlow(callbacks) {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const nonce = crypto2.randomUUID();
  const machineID = getMachineId();
  const verificationURI = getQoderDeviceLoginURL(codeChallenge, machineID, nonce);
  getProgress(callbacks)?.("Please complete login in your browser...");
  callbacks.onAuth({
    url: verificationURI,
    instructions: "Click to sign in with your Qoder account in the browser."
  });
  const pollURL = getQoderDevicePollURL(nonce, codeVerifier);
  const pollInterval = 2e3;
  const maxAttempts = 90;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
    await abortableDelay(pollInterval, getSignal(callbacks));
    try {
      const response = await fetch(pollURL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "pi-provider-qoder"
        },
        signal: getSignal(callbacks)
      });
      if (response.status === 202 || response.status === 404) {
        continue;
      }
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Device token poll failed: ${response.status} ${response.statusText}. Response: ${errText}`);
      }
      const tokenData = await response.json();
      if (!tokenData.token) {
        throw new Error("Device token poll returned empty access token");
      }
      const expireMs = parseExpiresAt(tokenData.expires_at, tokenData.expires_in);
      getProgress(callbacks)?.("Fetching user profile...");
      let email = "";
      let name = "";
      try {
        const userinfoRes = await fetch(getQoderUserInfoURL("global"), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokenData.token}`,
            Accept: "application/json",
            "User-Agent": "pi-provider-qoder"
          }
        });
        if (userinfoRes.ok) {
          const userinfo = await userinfoRes.json();
          email = userinfo.email || "";
          name = userinfo.name || userinfo.username || "";
        }
      } catch {
      }
      getProgress(callbacks)?.("Login successful!");
      return {
        refresh: `${tokenData.refresh_token}|${tokenData.user_id}|${machineID}`,
        access: tokenData.token,
        expires: expireMs - 5 * 60 * 1e3,
        // 5 min buffer
        userID: tokenData.user_id,
        email,
        name,
        machineID
      };
    } catch (e) {
      const err = e;
      if (err.name === "AbortError" || getSignal(callbacks)?.aborted) {
        throw new Error("Login cancelled");
      }
      throw e;
    }
  }
  throw new Error("Authorization timed out");
}

// src/auth/oauth.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync4, readFileSync as readFileSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { dirname as dirname4, join as join4 } from "node:path";

// src/catalog.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname3, join as join3 } from "node:path";
var ZERO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
var MAX_OUTPUT_TOKENS = 131072;
var DEFAULT_CONTEXT_WINDOW = 1e6;
function getHomeDir3() {
  return process.env.HOME || process.env.USERPROFILE || homedir3();
}
function getQoderCachePath(mode) {
  return join3(getHomeDir3(), ".pi", "agent", getQoderRegionConfig(mode).modelCacheFile);
}
var modelCacheMem = /* @__PURE__ */ new Map();
function readParsedModelCache(mode) {
  const cachePath = getQoderCachePath(mode);
  if (modelCacheMem.has(cachePath)) {
    return modelCacheMem.get(cachePath) ?? null;
  }
  if (!existsSync3(cachePath)) {
    modelCacheMem.set(cachePath, null);
    return null;
  }
  try {
    const data = JSON.parse(readFileSync3(cachePath, "utf8"));
    modelCacheMem.set(cachePath, data);
    return data;
  } catch {
    modelCacheMem.set(cachePath, null);
    return null;
  }
}
function writeParsedModelCache(mode, data) {
  const cachePath = getQoderCachePath(mode);
  mkdirSync3(dirname3(cachePath), { recursive: true });
  writeFileSync3(cachePath, JSON.stringify(data, null, 2), "utf-8");
  modelCacheMem.set(cachePath, data);
}
function toQoderModelId(displayName) {
  return (displayName || "QoderModel").replace(/\s+/g, "");
}
var staticModels = [
  {
    id: "Auto",
    upstreamKey: "auto",
    name: "Auto",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: true,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "Ultimate",
    upstreamKey: "ultimate",
    name: "Ultimate",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "Performance",
    upstreamKey: "performance",
    name: "Performance",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "Efficient",
    upstreamKey: "efficient",
    name: "Efficient",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: false,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "Lite",
    upstreamKey: "lite",
    name: "Lite",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: false,
    supportsEffort: false,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "Qwen3.7Plus",
    upstreamKey: "qmodel",
    name: "Qwen3.7 Plus",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: false,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "Cantus",
    upstreamKey: "cmodel",
    name: "Cantus",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "Qwen3.8-Max",
    upstreamKey: "qmodel_preview",
    name: "Qwen3.8-Max",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "Qwen3.7-Max",
    upstreamKey: "qmodel_latest",
    name: "Qwen3.7-Max",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: false,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "DeepSeek-V4-Pro",
    upstreamKey: "dmodel",
    name: "DeepSeek-V4-Pro",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "DeepSeek-V4-Flash",
    upstreamKey: "dfmodel",
    name: "DeepSeek-V4-Flash",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "GLM-5.2",
    upstreamKey: "gm51model",
    name: "GLM-5.2",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "Kimi-K2.7-Code",
    upstreamKey: "kmodel",
    name: "Kimi-K2.7-Code",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: false,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    // Catalog advertises 256K; not included in the 1M live test in issue #13.
    contextWindow: 256e3,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "Kimi-K3",
    upstreamKey: "kmodel_latest",
    name: "Kimi-K3",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: false,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  },
  {
    id: "MiniMax-M3",
    upstreamKey: "mmodel",
    name: "MiniMax-M3",
    api: "qoder-api",
    provider: "qoder",
    baseUrl: getQoderBaseUrl("global"),
    reasoning: false,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS
  }
];
var staticCnModels = [
  {
    id: "Auto",
    upstreamKey: "auto",
    name: "Auto",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    // CN Auto has not been live-tested at 1M; keep the conservative 200K
    // fallback until the CN catalog advertises a larger option.
    contextWindow: 2e5,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qoder CN smart routing; fallback context window of 200K."
  },
  {
    id: "Qwen3.7-Max",
    upstreamKey: "qmodel_latest",
    name: "Qwen3.7-Max",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qoder CN qmodel_latest; context options 200K/400K/1M."
  },
  {
    id: "Qwen3.7-Plus",
    upstreamKey: "qmodel",
    name: "Qwen3.7-Plus",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qoder CN qmodel; context options 200K/400K/1M."
  },
  {
    id: "Qwen3.6-Flash",
    upstreamKey: "q36fmodel",
    name: "Qwen3.6-Flash",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qoder CN q36fmodel; context options 200K/400K/1M."
  },
  {
    id: "DeepSeek-V4-Pro",
    upstreamKey: "dmodel",
    name: "DeepSeek-V4-Pro",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qoder CN dmodel; context options 200K/400K/1M."
  },
  {
    id: "DeepSeek-V4-Flash",
    upstreamKey: "dfmodel",
    name: "DeepSeek-V4-Flash",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: false,
    supportsEffort: false,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qoder CN dfmodel; context options 200K/400K/1M."
  },
  {
    id: "GLM-5.2",
    upstreamKey: "gm51model",
    name: "GLM-5.2",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    // Live CN catalog currently displays 200K; do not copy global gm51model's 1M.
    contextWindow: 2e5,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qoder CN gm51model; live catalog currently displays GLM-5.2 with 200K context."
  },
  {
    id: "Kimi-K2.7-Code",
    upstreamKey: "kmodel",
    name: "Kimi-K2.7-Code",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    // Catalog advertises 256K; same as global kmodel.
    contextWindow: 256e3,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qoder CN kmodel; context option 256K."
  },
  {
    id: "MiniMax-M2.7",
    upstreamKey: "mmodel",
    name: "MiniMax-M2.7",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: false,
    supportsEffort: false,
    input: ["text"],
    cost: ZERO_COST,
    // Live CN catalog reports 200K; not confirmed at 1M.
    contextWindow: 2e5,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qoder CN mmodel; live catalog reports 200K context."
  }
];
var PI_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
function buildThinkingLevelMap(entry) {
  const tc = entry.thinking_config;
  if (!tc) return void 0;
  const efforts = tc.enabled?.efforts;
  if (efforts && typeof efforts === "object") {
    const supported = new Set(Object.keys(efforts));
    const map = { off: tc.disabled ? "disabled" : null };
    for (const level of PI_THINKING_LEVELS) {
      map[level] = supported.has(level) ? level : null;
    }
    return map;
  }
  if (tc.enabled) {
    const map = { off: tc.disabled ? "disabled" : null };
    for (const level of PI_THINKING_LEVELS) {
      map[level] = "enabled";
    }
    return map;
  }
  return void 0;
}
function buildThinkingConfig(entry) {
  const tc = entry.thinking_config;
  const efforts = tc?.enabled?.efforts;
  if (!efforts || typeof efforts !== "object") return void 0;
  const supported = new Set(Object.keys(efforts));
  const ordered = PI_THINKING_LEVELS.filter((level) => supported.has(level));
  if (ordered.length === 0) return void 0;
  const defaultLevel = PI_THINKING_LEVELS.find((level) => efforts[level]?.is_default);
  return {
    mode: "effort",
    efforts: ordered,
    ...defaultLevel ? { defaultLevel } : {},
    // Qoder's catalog marks a `disabled` branch when thinking can be turned
    // off. Without it reasoning is mandatory upstream, so omp clamps "off" to
    // the lowest supported effort instead of disabling.
    requiresEffort: !tc?.disabled
  };
}
function getCachedModelConfig(modelId, mode) {
  const data = readParsedModelCache(mode);
  if (data) {
    const direct = data.configs?.[modelId];
    if (direct && toQoderModelId(direct.display_name) === modelId) {
      return withMaxContextAsDefault(direct);
    }
    const legacyEntry = Object.values(data.configs || {}).find(
      (entry) => entry && typeof entry === "object" && toQoderModelId(entry.display_name) === modelId
    );
    if (legacyEntry) {
      return withMaxContextAsDefault(legacyEntry);
    }
  }
  const staticModel = (mode === "cn" ? staticCnModels : staticModels).find((model) => model.id === modelId);
  if (staticModel) {
    return {
      key: staticModel.upstreamKey || modelId,
      is_reasoning: staticModel.reasoning,
      source: "system"
    };
  }
  return null;
}
function contextWindowFromCatalog(entry) {
  const contextConfig = entry.context_config;
  if (contextConfig && typeof contextConfig === "object") {
    let advertised = 0;
    for (const configVal of Object.values(contextConfig)) {
      if (configVal && typeof configVal === "object" && typeof configVal.token_count === "number") {
        if (configVal.token_count > advertised) advertised = configVal.token_count;
      }
    }
    if (advertised > 0) return advertised;
  }
  return DEFAULT_CONTEXT_WINDOW;
}
function withMaxContextAsDefault(entry) {
  const contextConfig = entry.context_config;
  if (!contextConfig || typeof contextConfig !== "object") return entry;
  const maxTokenCount = Math.max(
    ...Object.values(contextConfig).map((config) => typeof config?.token_count === "number" ? config.token_count : 0)
  );
  if (maxTokenCount <= 0) return entry;
  return {
    ...entry,
    context_config: Object.fromEntries(
      Object.entries(contextConfig).map(([name, config]) => [
        name,
        { ...config, is_default: config.token_count === maxTokenCount }
      ])
    )
  };
}
async function fetchQoderCatalog(authToken, userID, name, email, mode, signal) {
  const modelListURL = getQoderModelListURL(mode);
  await refreshGatewayCosyVersion();
  const headers = buildAuthHeaders(null, modelListURL, {
    userID,
    authToken,
    name,
    email
  });
  const response = await fetch(modelListURL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...headers
    },
    signal
  });
  if (!response.ok) throw new QoderHttpError("Qoder model catalog request failed", response.status);
  return parseQoderCatalog(await response.json(), mode);
}
function parseQoderCatalog(value, mode) {
  const chatModels = value?.chat;
  if (!Array.isArray(chatModels) || chatModels.length === 0) throw new Error("Empty Qoder model catalog");
  const newModels = [];
  const configs = {};
  for (const entry of chatModels) {
    const key = entry.key;
    if (!key || !entry.enable || !entry.display_name) continue;
    const display = entry.display_name;
    const ctxLen = contextWindowFromCatalog(entry);
    const isVL = !!entry.is_vl;
    const isReasoning = !!entry.is_reasoning || !!entry.thinking_config;
    const supportsEffort = !!entry.thinking_config?.enabled?.efforts;
    const thinkingLevelMap = buildThinkingLevelMap(entry);
    const thinking = buildThinkingConfig(entry);
    const modelInfo = { id: toQoderModelId(display), name: display };
    configs[modelInfo.id] = entry;
    newModels.push({
      id: modelInfo.id,
      name: modelInfo.name,
      api: "qoder-api",
      provider: getQoderRegionConfig(mode).providerID,
      baseUrl: getQoderBaseUrl(mode),
      reasoning: isReasoning,
      supportsEffort,
      thinkingLevelMap,
      thinking,
      input: isVL ? ["text", "image"] : ["text"],
      cost: ZERO_COST,
      contextWindow: ctxLen,
      maxTokens: MAX_OUTPUT_TOKENS
    });
  }
  if (newModels.length === 0) throw new Error("Empty Qoder model catalog");
  return { models: newModels, configs };
}
async function updateQoderModelsCache(authToken, userID, name, email, mode) {
  try {
    const catalog = await fetchQoderCatalog(authToken, userID, name, email, mode);
    writeParsedModelCache(mode, { updatedAt: Date.now(), ...catalog });
  } catch {
  }
}

// src/auth/oauth.ts
var identityCache = /* @__PURE__ */ new Map();
function getHomeDir4() {
  return process.env.HOME || process.env.USERPROFILE || homedir4();
}
function getAuthFilePath() {
  return join4(getHomeDir4(), ".pi", "agent", "auth.json");
}
var authFileMem;
function readAuthFileCached() {
  const authPath = getAuthFilePath();
  if (authFileMem !== void 0) {
    if (authFileMem === null) return null;
    if (authFileMem.path === authPath) return authFileMem.data;
  }
  if (!existsSync4(authPath)) {
    authFileMem = null;
    return null;
  }
  try {
    const data = JSON.parse(readFileSync4(authPath, "utf-8"));
    authFileMem = { path: authPath, data };
    return data;
  } catch {
    authFileMem = null;
    return null;
  }
}
function saveCredentialsToAuthFile(providerID, credentials) {
  try {
    const authPath = getAuthFilePath();
    const dir = dirname4(authPath);
    if (!existsSync4(dir)) {
      mkdirSync4(dir, { recursive: true, mode: 448 });
    }
    const existing = readAuthFileCached();
    const auth = existing ? { ...existing } : {};
    auth[providerID] = { type: "oauth", ...credentials };
    writeFileSync4(authPath, JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 384 });
    authFileMem = { path: authPath, data: auth };
    const q = credentials;
    if (q.access && q.userID) {
      identityCache.set(`${providerID}:${q.access}`, q);
    }
  } catch (err) {
    console.error(`[pi-provider-qoder] Failed to write auth storage for ${providerID}:`, err);
  }
}
function getCachedCredentials(_accessToken, providerID = "qoder") {
  const auth = readAuthFileCached();
  if (!auth) return null;
  const creds = auth[providerID] || (providerID === "qoder" ? auth.qoder : null);
  if (creds?.userID || creds?.access) {
    if (creds.access && creds.userID) {
      identityCache.set(`${providerID}:${creds.access}`, creds);
    }
    return creds;
  }
  return null;
}
async function resolveQoderIdentity(accessToken, providerID, mode) {
  const region = getQoderRegionConfig(mode);
  const cacheKey = `${providerID}:${accessToken}`;
  const mem = identityCache.get(cacheKey);
  if (mem?.userID) return mem;
  const cached = getCachedCredentials(accessToken, providerID);
  if (cached?.userID) {
    identityCache.set(cacheKey, cached);
    return cached;
  }
  const info = await fetchUserInfo(accessToken, mode);
  const machineID = getMachineId();
  const creds = {
    access: accessToken,
    userID: info.userID || "qoder-user",
    email: info.email || region.userEmailFallback,
    name: info.name || region.userNameFallback,
    machineID,
    refresh: "",
    expires: 0
  };
  identityCache.set(cacheKey, creds);
  saveCredentialsToAuthFile(providerID, creds);
  return creds;
}
async function refreshQoderTokenForMode(credentials, mode, strict = false, options) {
  if (isPatRefresh(credentials.refresh)) {
    const { pat } = decodePatRefresh(credentials.refresh);
    if (pat) {
      try {
        const refreshed = await credentialsFromPat(pat, mode, options?.signal);
        const qCreds = refreshed;
        if (options?.cacheModels !== false)
          updateQoderModelsCache(qCreds.access, qCreds.userID, qCreds.name, qCreds.email, mode).catch(() => {
          });
        return refreshed;
      } catch (error) {
        if (strict) throw error;
      }
    }
    if (strict) throw new Error("Missing Qoder PAT for refresh");
    return {
      ...credentials,
      expires: Date.now() + 60 * 60 * 1e3
      // extend 1 hour to retry later
    };
  }
  const parts = credentials.refresh.split("|");
  const refreshToken = parts[0] || "";
  const userID = parts[1] || "";
  const machineID = parts[2] || getMachineId();
  const prev = credentials;
  const prevName = prev.name || "";
  const prevEmail = prev.email || "";
  const refreshURL = getQoderRefreshURL(mode);
  try {
    const response = await fetch(refreshURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.access}`,
        Accept: "application/json",
        "User-Agent": "pi-provider-qoder"
      },
      body: JSON.stringify({ refreshToken }),
      signal: options?.signal
    });
    if (response.ok) {
      const data = await response.json();
      if (strict && !data.token) throw new Error("Qoder refresh returned no access token");
      const newAccess = data.token;
      const newRefresh = data.refresh_token || refreshToken;
      let expireMs = Date.now() + 30 * 24 * 60 * 60 * 1e3;
      if (data.expires_at) {
        const parsed = Date.parse(data.expires_at);
        if (!Number.isNaN(parsed)) expireMs = parsed;
      } else if (data.expires_in) {
        expireMs = Date.now() + data.expires_in * 1e3;
      }
      const refreshed = {
        ...credentials,
        refresh: `${newRefresh}|${userID}|${machineID}`,
        access: newAccess,
        expires: expireMs - 5 * 60 * 1e3,
        userID,
        email: prevEmail,
        name: prevName,
        machineID
      };
      if (options?.cacheModels !== false)
        updateQoderModelsCache(newAccess, userID, prevName, prevEmail, mode).catch(() => {
        });
      return refreshed;
    }
    if (strict) throw new QoderHttpError(`Qoder refresh failed (${response.status})`, response.status);
  } catch (error) {
    if (strict) throw error;
  }
  const refreshedFallback = {
    ...credentials,
    expires: Date.now() + 60 * 60 * 1e3
    // extend for 1 hour
  };
  return refreshedFallback;
}

// src/auth/usage.ts
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function quotaNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function normalizeBucket(value, totalKey = "total") {
  const raw = asRecord(value);
  if (!raw) return void 0;
  const total = quotaNumber(raw[totalKey]);
  const used = quotaNumber(raw.used);
  const remaining = quotaNumber(raw.remaining);
  if (total === void 0 && used === void 0 && remaining === void 0) return void 0;
  const unit = typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim() : void 0;
  return { total, used, remaining, unit };
}
function normalizeQoderQuotaSnapshot(value) {
  const raw = asRecord(value);
  if (!raw) return void 0;
  const userQuota = normalizeBucket(raw.userQuota);
  const addOnQuota = normalizeBucket(raw.addOnQuota);
  const orgRaw = asRecord(raw.orgResourcePackage);
  const orgResourcePackage = normalizeBucket(orgRaw, orgRaw && "cap" in orgRaw ? "cap" : "total");
  if (!userQuota && !addOnQuota && !orgResourcePackage) return void 0;
  const expiration = quotaNumber(raw.expiresAt);
  const expiresAt = expiration !== void 0 && expiration <= 864e13 ? expiration : void 0;
  return { userQuota, ...addOnQuota ? { addOnQuota } : {}, orgResourcePackage, expiresAt };
}
async function fetchQoderUsageForMode(credentials, mode, signal) {
  const region = getQoderRegionConfig(mode);
  const response = await fetch(getQoderUsageURL(mode), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credentials.access}`,
      Accept: "application/json",
      "User-Agent": "pi-provider-qoder"
    },
    signal
  });
  if (!response.ok) {
    throw new QoderHttpError(`Failed to fetch Qoder usage (${response.status})`, response.status);
  }
  const raw = asRecord(await response.json());
  if (!raw) throw new Error("Invalid Qoder usage response");
  const snapshot = normalizeQoderQuotaSnapshot(raw);
  const resetAt = snapshot?.expiresAt === void 0 ? void 0 : new Date(snapshot.expiresAt).toISOString();
  const usageBuckets = [];
  for (const [id, label, bucket] of [
    ["user-quota", "User Quota", snapshot?.userQuota],
    ["add-on-quota", "Add-on Credits", snapshot?.addOnQuota],
    ["org-resource-package", "Org Resource Package", snapshot?.orgResourcePackage]
  ]) {
    if (!bucket) continue;
    usageBuckets.push({
      id,
      label,
      usedDisplay: bucket.used === void 0 ? "unknown" : bucket.used.toFixed(2),
      limitDisplay: bucket.total?.toFixed(2),
      unit: bucket.unit,
      resetAt
    });
  }
  const personal = snapshot?.userQuota;
  const remainingText = personal?.remaining === void 0 ? "" : `${personal.remaining.toFixed(2)}${personal.unit ? ` ${personal.unit}` : ""} remaining`;
  const addOn = snapshot?.addOnQuota;
  const addOnText = addOn?.remaining === void 0 ? "" : `Add-on: ${addOn.remaining.toFixed(2)}${addOn.unit ? ` ${addOn.unit}` : ""} remaining`;
  return {
    summary: [remainingText, addOnText].filter(Boolean).join(" \xB7 "),
    subscriptionTitle: region.usageTitle,
    resetAt,
    manageUrl: region.manageUrl,
    usageBuckets,
    raw
  };
}

// src/protocol/stream.ts
import crypto3 from "node:crypto";
import * as PiAi from "@earendil-works/pi-ai";
import {
  clampThinkingLevel
} from "@earendil-works/pi-ai";

// src/credits.ts
function creditNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function creditsToUsd(credits) {
  return credits * 20 / 1500;
}
function chargedCredits(usage) {
  if (usage.billable === false) return 0;
  return usage.billable === true ? creditNumber(usage.credits) : void 0;
}
function applyQoderCredits(usage, raw, provider) {
  if (provider) usage.qoder_provider = provider;
  if ("credits" in raw) usage.credits = creditNumber(raw.credits);
  if ("original_credits" in raw) usage.original_credits = creditNumber(raw.original_credits);
  if ("billable" in raw) usage.billable = typeof raw.billable === "boolean" ? raw.billable : void 0;
  usage.charged_credits = chargedCredits(usage);
  usage.usd_equivalent = usage.charged_credits === void 0 ? void 0 : creditsToUsd(usage.charged_credits);
}

// src/protocol/encoding.ts
var qoderCustomAlphabet = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
var qoderStdAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var encodeTable = new Uint8Array(256);
for (let i = 0; i < encodeTable.length; i++) {
  encodeTable[i] = i;
}
for (let i = 0; i < qoderStdAlphabet.length; i++) {
  encodeTable[qoderStdAlphabet.charCodeAt(i)] = qoderCustomAlphabet.charCodeAt(i);
}
encodeTable["=".charCodeAt(0)] = "$".charCodeAt(0);
function qoderEncodeBody(plaintext) {
  const std = Buffer.isBuffer(plaintext) ? plaintext.toString("base64") : Buffer.from(plaintext).toString("base64");
  const n = std.length;
  const a = Math.floor(n / 3);
  const out = Buffer.allocUnsafe(n);
  let dst = 0;
  for (let i = n - a; i < n; i++) {
    out[dst++] = encodeTable[std.charCodeAt(i)];
  }
  for (let i = a; i < n - a; i++) {
    out[dst++] = encodeTable[std.charCodeAt(i)];
  }
  for (let i = 0; i < a; i++) {
    out[dst++] = encodeTable[std.charCodeAt(i)];
  }
  return out;
}

// src/protocol/thinking.ts
var THINKING_TAG_VARIANTS = [
  { open: "<thinking>", close: "</thinking>" },
  { open: "<think>", close: "</think>" },
  { open: "<reasoning>", close: "</reasoning>" },
  { open: "<thought>", close: "</thought>" }
];
var ALL_THINKING_TAGS = THINKING_TAG_VARIANTS.flatMap((variant) => [variant.open, variant.close]);
function getTrailingPossibleTagPrefixLength(text, tag) {
  const maxPrefixLength = Math.min(text.length, tag.length - 1);
  for (let len = maxPrefixLength; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}
function getMaxTrailingPossibleTagPrefixLength(text, tags) {
  let maxLength = 0;
  for (const tag of tags) {
    maxLength = Math.max(maxLength, getTrailingPossibleTagPrefixLength(text, tag));
  }
  return maxLength;
}
function stripThinkingTags(text) {
  let out = text;
  for (const { open, close } of THINKING_TAG_VARIANTS) {
    if (open.length > 0 && out.includes(open)) out = out.split(open).join("");
    if (close.length > 0 && out.includes(close)) out = out.split(close).join("");
  }
  return out;
}
var DSML_TAG = /<\/?[\uFF5C|]{0,2}\s*DSML\s*[\uFF5C|]{0,2}[^>]*>|<\/?(?:invoke|invocation|parameter|function_call|function_calls)\b[^>]*>/g;
var DEGENERATE_DSML_TAIL = /(?:(?:<\/?(?:invoke|invocation|parameter|function_call|function_calls)\b[^>]*>)\s*|(?:<\/?[\uFF5C|]{0,2}\s*DSML\s*[\uFF5C|]{0,2}[^>]*>)\s*){2,}$/;
function stripDsmlResidue(text) {
  return text.replace(DSML_TAG, "").replace(/\n{3,}/g, "\n\n");
}
function isDegenerateDsmlTurn(message, rawReasoning) {
  if (message.stopReason === "toolUse") return false;
  const content = Array.isArray(message.content) ? message.content : [];
  if (content.some((block) => block.type === "text" && block.text.trim().length > 0)) return false;
  return DEGENERATE_DSML_TAIL.test(rawReasoning);
}
var ThinkingTagParser = class {
  constructor(output, stream) {
    this.output = output;
    this.stream = stream;
  }
  output;
  stream;
  textBuffer = "";
  inThinking = false;
  thinkingExtracted = false;
  thinkingBlockIndex = null;
  textBlockIndex = null;
  lastTextBlockIndex = null;
  activeEndTag = THINKING_TAG_VARIANTS[0].close;
  processChunk(chunk) {
    this.textBuffer += chunk;
    while (this.textBuffer.length > 0) {
      const prevLength = this.textBuffer.length;
      if (!this.inThinking && !this.thinkingExtracted) {
        this.processBeforeThinking();
        if (this.textBuffer.length === 0) break;
      }
      if (this.inThinking) {
        this.processInsideThinking();
        if (this.textBuffer.length === 0) break;
      }
      if (this.thinkingExtracted) {
        this.processAfterThinking();
        break;
      }
      if (this.textBuffer.length >= prevLength) break;
    }
  }
  finalize() {
    if (this.textBuffer.length === 0) return;
    if (this.inThinking && this.thinkingBlockIndex !== null) {
      const block = this.output.content[this.thinkingBlockIndex];
      block.thinking += this.textBuffer;
      this.stream.push({
        type: "thinking_delta",
        contentIndex: this.thinkingBlockIndex,
        delta: this.textBuffer,
        partial: this.output
      });
      this.stream.push({
        type: "thinking_end",
        contentIndex: this.thinkingBlockIndex,
        content: block.thinking,
        partial: this.output
      });
    } else {
      this.emitText(this.textBuffer);
    }
    this.textBuffer = "";
  }
  getTextBlockIndex() {
    return this.textBlockIndex ?? this.lastTextBlockIndex;
  }
  processBeforeThinking() {
    let bestOpenPos = -1;
    let bestOpenVariant = null;
    let bestClosePos = -1;
    let bestCloseVariant = null;
    for (const variant of THINKING_TAG_VARIANTS) {
      const openPos = this.textBuffer.indexOf(variant.open);
      if (openPos !== -1 && (bestOpenPos === -1 || openPos < bestOpenPos)) {
        bestOpenPos = openPos;
        bestOpenVariant = variant;
      }
      const closePos = this.textBuffer.indexOf(variant.close);
      if (closePos !== -1 && (bestClosePos === -1 || closePos < bestClosePos)) {
        bestClosePos = closePos;
        bestCloseVariant = variant;
      }
    }
    if (bestOpenVariant !== null && (bestCloseVariant === null || bestOpenPos < bestClosePos)) {
      if (bestOpenPos > 0) this.emitText(this.textBuffer.slice(0, bestOpenPos));
      this.textBuffer = this.textBuffer.slice(bestOpenPos + bestOpenVariant.open.length);
      this.activeEndTag = bestOpenVariant.close;
      this.inThinking = true;
      return;
    }
    if (bestCloseVariant !== null) {
      if (bestClosePos > 0) this.emitText(this.textBuffer.slice(0, bestClosePos));
      this.textBuffer = this.textBuffer.slice(bestClosePos + bestCloseVariant.close.length);
      if (this.textBuffer.startsWith("\n\n")) this.textBuffer = this.textBuffer.slice(2);
      else if (this.textBuffer.startsWith("\n")) this.textBuffer = this.textBuffer.slice(1);
      return;
    }
    const trailingPrefixLength = getMaxTrailingPossibleTagPrefixLength(this.textBuffer, ALL_THINKING_TAGS);
    const safeLen = this.textBuffer.length - trailingPrefixLength;
    if (safeLen > 0) {
      this.emitText(this.textBuffer.slice(0, safeLen));
      this.textBuffer = this.textBuffer.slice(safeLen);
    }
  }
  processInsideThinking() {
    const endPos = this.textBuffer.indexOf(this.activeEndTag);
    if (endPos !== -1) {
      if (endPos > 0) this.emitThinking(this.textBuffer.slice(0, endPos));
      if (this.thinkingBlockIndex !== null) {
        const block = this.output.content[this.thinkingBlockIndex];
        this.stream.push({
          type: "thinking_end",
          contentIndex: this.thinkingBlockIndex,
          content: block.thinking,
          partial: this.output
        });
      }
      this.textBuffer = this.textBuffer.slice(endPos + this.activeEndTag.length);
      this.inThinking = false;
      this.thinkingExtracted = true;
      this.lastTextBlockIndex = this.textBlockIndex;
      this.textBlockIndex = null;
      if (this.textBuffer.startsWith("\n\n")) this.textBuffer = this.textBuffer.slice(2);
      return;
    }
    const trailingPrefixLength = getTrailingPossibleTagPrefixLength(this.textBuffer, this.activeEndTag);
    const safeLen = this.textBuffer.length - trailingPrefixLength;
    if (safeLen > 0) {
      this.emitThinking(this.textBuffer.slice(0, safeLen));
      this.textBuffer = this.textBuffer.slice(safeLen);
    }
  }
  processAfterThinking() {
    this.emitText(this.textBuffer);
    this.textBuffer = "";
  }
  emitText(text) {
    if (!text) return;
    if (this.textBlockIndex === null) {
      this.textBlockIndex = this.output.content.length;
      this.output.content.push({ type: "text", text: "" });
      this.stream.push({ type: "text_start", contentIndex: this.textBlockIndex, partial: this.output });
    }
    const block = this.output.content[this.textBlockIndex];
    block.text += text;
    this.stream.push({ type: "text_delta", contentIndex: this.textBlockIndex, delta: text, partial: this.output });
  }
  emitThinking(thinking) {
    if (!thinking) return;
    if (this.thinkingBlockIndex === null) {
      if (this.textBlockIndex !== null) {
        this.thinkingBlockIndex = this.textBlockIndex;
        this.output.content.splice(this.thinkingBlockIndex, 0, { type: "thinking", thinking: "" });
        this.textBlockIndex = this.textBlockIndex + 1;
      } else {
        this.thinkingBlockIndex = this.output.content.length;
        this.output.content.push({ type: "thinking", thinking: "" });
      }
      this.stream.push({ type: "thinking_start", contentIndex: this.thinkingBlockIndex, partial: this.output });
    }
    const block = this.output.content[this.thinkingBlockIndex];
    block.thinking += thinking;
    this.stream.push({
      type: "thinking_delta",
      contentIndex: this.thinkingBlockIndex,
      delta: thinking,
      partial: this.output
    });
  }
};

// src/protocol/tool-call-id.ts
import { createHash } from "node:crypto";
var VALID_WIRE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
var RESERVED_WIRE_ID = /^qtc_[0-9a-f]{60}$/;
function digestToolCallId(original) {
  return `qtc_${createHash("sha256").update("qoder-tool-call-id:v1\0").update(original).digest("hex").slice(0, 60)}`;
}
function createQoderToolCallIdMapper(digest = digestToolCallId) {
  const byOriginal = /* @__PURE__ */ new Map();
  const byWire = /* @__PURE__ */ new Map();
  return (original) => {
    if (typeof original !== "string" || original.length === 0) {
      throw new Error("Qoder tool call ID must be a non-empty string");
    }
    const cached = byOriginal.get(original);
    if (cached !== void 0) return cached;
    const wireId = VALID_WIRE_ID.test(original) && !RESERVED_WIRE_ID.test(original) ? original : digest(original);
    const owner = byWire.get(wireId);
    if (owner !== void 0 && owner !== original) {
      throw new Error("Qoder tool call ID mapping collision");
    }
    byOriginal.set(original, wireId);
    byWire.set(wireId, original);
    return wireId;
  };
}

// src/protocol/transform.ts
function getContentText(msg) {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((c) => {
      if (c.type === "text") return c.text;
      if (c.type === "thinking") return c.thinking;
      return "";
    }).join("");
  }
  return "";
}
function getContentImages(msg) {
  if (!Array.isArray(msg.content)) return [];
  return msg.content.filter((c) => c.type === "image");
}
function transformTools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
}
function transformMessagesForQoder(messages) {
  const normalizedMessages = [];
  const mapToolCallId = createQoderToolCallIdMapper();
  const droppedToolCallIds = /* @__PURE__ */ new Set();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "assistant" && (msg.stopReason === "error" || msg.stopReason === "aborted")) {
      const am = msg;
      if (Array.isArray(am.content)) {
        for (const block of am.content) {
          if (block.type === "toolCall") {
            const id = block.id;
            if (id) droppedToolCallIds.add(id);
          }
        }
      }
      continue;
    }
    if (msg.role === "user") {
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const hasImage = msg.content.some((c) => c.type === "image");
        if (hasImage) {
          content = msg.content.map((c) => {
            if (c.type === "text") {
              return { type: "text", text: c.text };
            }
            if (c.type === "image") {
              const img = c;
              return {
                type: "image_url",
                image_url: {
                  url: `data:${img.mimeType};base64,${img.data}`
                }
              };
            }
            return null;
          }).filter((p) => p !== null);
        } else {
          content = getContentText(msg);
        }
      }
      normalizedMessages.push({
        role: "user",
        content
      });
    } else if (msg.role === "assistant") {
      const am = msg;
      let content = "";
      let reasoningContent = "";
      const toolCalls = [];
      if (Array.isArray(am.content)) {
        for (const block of am.content) {
          if (block.type === "text") {
            content += block.text;
          } else if (block.type === "thinking") {
            reasoningContent += stripDsmlResidue(block.thinking);
          } else if (block.type === "toolCall") {
            const tc = block;
            toolCalls.push({
              id: mapToolCallId(tc.id),
              type: "function",
              function: {
                name: tc.name,
                arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments)
              }
            });
          }
        }
      } else {
        content = am.content || "";
      }
      const mapped = {
        role: "assistant",
        content: content || (toolCalls.length > 0 || reasoningContent ? " " : null)
      };
      if (reasoningContent) {
        mapped.reasoning_content = reasoningContent;
      }
      if (toolCalls.length > 0) {
        mapped.tool_calls = toolCalls;
      }
      normalizedMessages.push(mapped);
    } else if (msg.role === "toolResult") {
      const imageBlocks = [];
      let j = i;
      for (; j < messages.length; j++) {
        const trMsg = messages[j];
        if (trMsg.role !== "toolResult") break;
        const tr = trMsg;
        if (droppedToolCallIds.has(tr.toolCallId)) continue;
        normalizedMessages.push({
          role: "tool",
          tool_call_id: mapToolCallId(tr.toolCallId),
          content: getContentText(tr)
        });
        for (const img of getContentImages(tr)) {
          imageBlocks.push({
            type: "image_url",
            image_url: { url: `data:${img.mimeType};base64,${img.data}` }
          });
        }
      }
      i = j - 1;
      if (imageBlocks.length > 0) {
        normalizedMessages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: `[${imageBlocks.length} image${imageBlocks.length === 1 ? "" : "s"} returned by the previous tool call]`
            },
            ...imageBlocks
          ]
        });
      }
    }
  }
  return normalizedMessages;
}

// src/protocol/stream.ts
var MODEL_BUSY_CODE = "10605";
var DEFAULT_MODEL_BUSY_RETRIES = 2;
var MAX_MODEL_BUSY_RETRIES = 10;
var MODEL_BUSY_MAX_WAIT_MS = 5e3;
var QoderModelBusyError = class extends Error {
  constructor(message, retryAfterMs, sawModelOutput = false) {
    super(message);
    this.retryAfterMs = retryAfterMs;
    this.sawModelOutput = sawModelOutput;
    this.name = "QoderModelBusyError";
  }
  retryAfterMs;
  sawModelOutput;
};
function parseJsonObject(value, depth = 0) {
  if (depth > 4) return void 0;
  if (typeof value === "string") {
    try {
      return parseJsonObject(JSON.parse(value), depth + 1);
    } catch {
      return void 0;
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function parseModelBusyRejection(body) {
  const outer = parseJsonObject(body);
  const busy = parseJsonObject(outer?.message);
  if (busy?.code !== MODEL_BUSY_CODE) return void 0;
  const queue = parseJsonObject(busy.message);
  if (!queue) return void 0;
  if (queue.serviceAvailable !== true) return void 0;
  const seconds = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
    const milliseconds = Math.round(value * 1e3);
    return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : 0;
  };
  if (queue.isQueued === false) {
    return { kind: "ready", retryAfterMs: seconds(queue.retryAfterSeconds) };
  }
  if (queue.isQueued === true) {
    const waitMs = seconds(queue.waitTime) || seconds(queue.retryAfterSeconds);
    const queueCount = typeof queue.queueCount === "number" ? queue.queueCount : void 0;
    const queueType = typeof queue.queueType === "string" ? queue.queueType : void 0;
    return { kind: "queued", waitMs, queueCount, queueType };
  }
  return void 0;
}
function formatQueuedBusyError(snapshot) {
  return new QoderQueuedError(snapshot.waitMs, snapshot.queueCount, snapshot.queueType);
}
function sleepWithAbort(ms, signal) {
  if (signal?.aborted) return Promise.reject(new Error("Aborted"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function refreshToolIndexes(output, toolCalls) {
  const lastToolState = toolCalls.lastToolState;
  if (!lastToolState || output.content[lastToolState.contentIndex] === lastToolState.block) return;
  for (let index = 0; index < output.content.length; index++) {
    const block = output.content[index];
    if (block.type !== "toolCall") continue;
    const state = toolCalls.statesByBlock.get(block);
    if (state) state.contentIndex = index;
  }
}
function retireCompleteCandidates(toolCalls, candidates) {
  for (const state of candidates.complete) {
    parseToolArguments(state);
    candidates.states.delete(state);
    state.candidates.delete(candidates);
    if (state.candidates.size === 0 && !state.unindexed) toolCalls.unscopedCandidates.delete(state);
  }
  candidates.complete.clear();
  candidates.unique = candidates.states.size === 1 ? candidates.states.values().next().value : void 0;
}
var TOOL_ARGUMENT_STRUCTURE = /["\\{}[\]]/g;
var NON_JSON_WHITESPACE = /[^ \t\r\n]/;
function invalidToolArguments(state) {
  return new Error(`Invalid or incomplete tool-call JSON (characters=${state.argumentLength})`);
}
function appendToolArguments(state, fragment) {
  state.argumentChunks.push(fragment);
  state.argumentLength += fragment.length;
  if (state.complete) {
    if (NON_JSON_WHITESPACE.test(fragment)) throw invalidToolArguments(state);
    return;
  }
  let start = 0;
  if (state.objectRoot === void 0) {
    start = fragment.search(NON_JSON_WHITESPACE);
    if (start === -1) return;
    state.objectRoot = fragment[start] === "{";
  }
  if (!state.objectRoot) return;
  if (state.escaped) {
    start = 1;
    state.escaped = false;
  }
  TOOL_ARGUMENT_STRUCTURE.lastIndex = start;
  while (true) {
    const match = TOOL_ARGUMENT_STRUCTURE.exec(fragment);
    if (!match) break;
    const character = match[0];
    if (state.inString) {
      if (character === "\\") {
        if (TOOL_ARGUMENT_STRUCTURE.lastIndex === fragment.length) state.escaped = true;
        else TOOL_ARGUMENT_STRUCTURE.lastIndex++;
      } else if (character === '"') {
        state.inString = false;
      }
    } else if (character === '"') {
      state.inString = true;
    } else if (character === "{" || character === "[") {
      state.depth++;
    } else if (character === "}" || character === "]") {
      state.depth--;
      if (state.depth === 0) {
        state.complete = true;
        if (NON_JSON_WHITESPACE.test(fragment.slice(TOOL_ARGUMENT_STRUCTURE.lastIndex))) {
          throw invalidToolArguments(state);
        }
        return;
      }
    }
  }
}
function parseToolArguments(state) {
  if (state.parsedArguments) return state.parsedArguments;
  let args = {};
  if (state.argumentLength > 0) {
    try {
      args = JSON.parse(state.argumentChunks.join(""));
    } catch {
      throw invalidToolArguments(state);
    }
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`Non-object tool-call arguments (characters=${state.argumentLength})`);
  }
  state.parsedArguments = args;
  return state.parsedArguments;
}
function stableHash(prefix, ...inputs) {
  const hash = crypto3.createHash("sha256");
  hash.update(prefix);
  for (const input of inputs) {
    hash.update("\0");
    hash.update(input);
  }
  return hash.digest("hex").slice(0, 16);
}
function stableChatRecordID(model, messages, tools, maxTokens) {
  const hash = crypto3.createHash("sha256");
  hash.update("qoder-record");
  hash.update("\0");
  hash.update(model);
  for (const msg of messages) {
    if (msg?.role) {
      hash.update("\0");
      hash.update(msg.role);
    }
    if (msg?.content) {
      hash.update("\0");
      hash.update(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
    }
  }
  if (tools) {
    hash.update("\0");
    hash.update(JSON.stringify(tools));
  }
  hash.update("\0");
  hash.update(`mt=${maxTokens}`);
  return hash.digest("hex").slice(0, 16);
}
function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) return part.text;
      return "";
    }).join("\n");
  }
  return "";
}
function resolveRequestContext(piAi, context) {
  const {
    collapseSystemMessages,
    getCurrentTools,
    getInitialSystemMessage,
    getSystemMessageText,
    withoutInitialSystemMessage
  } = piAi;
  const hasTranscript = typeof collapseSystemMessages === "function" && typeof getCurrentTools === "function" && typeof getInitialSystemMessage === "function" && typeof getSystemMessageText === "function" && typeof withoutInitialSystemMessage === "function";
  if (!hasTranscript) {
    return {
      messages: context.messages,
      systemText: contentToText(context.systemPrompt || ""),
      tools: context.tools ?? []
    };
  }
  const collapsed = collapseSystemMessages(context);
  const transcriptMessages = collapsed.messages;
  const initialSystem = getInitialSystemMessage(transcriptMessages);
  if (!initialSystem) {
    return {
      messages: context.messages,
      systemText: contentToText(context.systemPrompt || ""),
      tools: context.tools ?? []
    };
  }
  const tools = getCurrentTools(transcriptMessages);
  const systemText = contentToText(getSystemMessageText?.(initialSystem) ?? context.systemPrompt ?? "");
  const messages = withoutInitialSystemMessage(transcriptMessages);
  return { messages, systemText, tools };
}
function streamQoder(model, context, options, credentials, overrides) {
  const StreamCtor = PiAi.AssistantMessageEventStream;
  const stream = new StreamCtor();
  if (overrides?.stableEvents) {
    const push = stream.push.bind(stream);
    stream.push = (event) => {
      if ("contentIndex" in event) Object.assign(event, { qoderBlock: event.partial.content[event.contentIndex] });
      push(event);
    };
  }
  const output = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp: Date.now()
  };
  (async () => {
    try {
      const providerMode = model.provider === "qoder-cn" ? "cn" : "global";
      const region = getQoderRegionConfig(providerMode);
      const accessToken = options?.apiKey;
      if (!accessToken) {
        throw new Error(
          providerMode === "cn" ? "Qoder CN credentials not set. Run /login qoder-cn or set QODERCN_PERSONAL_ACCESS_TOKEN." : "Qoder credentials not set. Run /login qoder or set QODER_PERSONAL_ACCESS_TOKEN."
        );
      }
      const ident = credentials ?? await resolveQoderIdentity(accessToken, model.provider, providerMode);
      const userID = ident.userID || "qoder-user";
      const name = ident.name || region.userNameFallback;
      const email = ident.email || region.userEmailFallback;
      const machineID = ident.machineID || getMachineId();
      const modelConfig = overrides?.modelConfig ?? getCachedModelConfig(model.id, providerMode);
      if (!modelConfig?.key) {
        throw new Error(`Unknown Qoder model id: ${model.id}`);
      }
      const qoderModel = modelConfig.key;
      const isReasoning = !!modelConfig.is_reasoning;
      const resolved = resolveRequestContext(PiAi, context);
      const normalizedMessages = transformMessagesForQoder(resolved.messages);
      const systemText = resolved.systemText;
      let lastUserText = "";
      for (let i = normalizedMessages.length - 1; i >= 0; i--) {
        if (normalizedMessages[i].role === "user") {
          const content = normalizedMessages[i].content;
          lastUserText = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => "text" in c ? c.text : "").join("") : "";
          break;
        }
      }
      const stablePart = stableHash("qoder-session", userID, qoderModel);
      const sessionID = options?.sessionId ? `${stablePart}-${options.sessionId}` : `${stablePart}-${crypto3.randomUUID()}`;
      let maxTokens = MAX_OUTPUT_TOKENS;
      if (options?.maxTokens && options.maxTokens < maxTokens) {
        maxTokens = options.maxTokens;
      }
      const toolsRaw = resolved.tools.length > 0 ? transformTools(resolved.tools) : void 0;
      const recordID = stableChatRecordID(qoderModel, normalizedMessages, toolsRaw, maxTokens);
      const requestedLevel = options?.reasoning;
      const extOptions = options;
      const explicitlyOff = extOptions?.disableReasoning === true || extOptions?.forceReasoningOff === true || requestedLevel === false || requestedLevel === "off";
      const clamped = !explicitlyOff && requestedLevel ? clampThinkingLevel(model, requestedLevel) : void 0;
      const reasoningLevel = clamped === "off" ? void 0 : clamped;
      const parameters = { max_tokens: maxTokens };
      if (reasoningLevel) {
        parameters.enable_thinking = true;
        const mapped = model.thinkingLevelMap?.[reasoningLevel];
        const effort = mapped && mapped !== "enabled" && mapped !== "disabled" ? mapped : reasoningLevel;
        if (modelConfig?.thinking_config?.enabled?.efforts && typeof effort === "string") {
          parameters.reasoning_effort = effort;
        }
      } else {
        parameters.enable_thinking = false;
        const tc = modelConfig?.thinking_config;
        const lacksDisabledBranch = tc?.enabled?.efforts && !tc.disabled || model.thinkingLevelMap?.off === null;
        if (!lacksDisabledBranch) {
          parameters.reasoning_effort = "none";
        }
      }
      const reqBody = {
        request_id: crypto3.randomUUID(),
        request_set_id: recordID,
        chat_record_id: recordID,
        session_id: sessionID,
        stream: true,
        chat_task: "FREE_INPUT",
        is_reply: true,
        is_retry: false,
        source: 1,
        version: "3",
        session_type: "qodercli",
        agent_id: "agent_common",
        task_id: "common",
        code_language: "",
        chat_prompt: "",
        image_urls: null,
        aliyun_user_type: "",
        // Qoder's server ignores the top-level `system` field (verified: the
        // model never sees it). Inject the system prompt as a leading
        // role:system message instead, which the server does honor.
        system: "",
        messages: systemText ? [{ role: "system", content: systemText }, ...normalizedMessages] : normalizedMessages,
        tools: toolsRaw || [],
        parameters,
        chat_context: {
          chatPrompt: "",
          imageUrls: null,
          extra: {
            context: [],
            modelConfig: {
              key: qoderModel,
              is_reasoning: reasoningLevel ? isReasoning : false
            },
            originalContent: lastUserText
          },
          features: [],
          text: lastUserText
        },
        model_config: reasoningLevel ? modelConfig : { ...modelConfig, is_reasoning: false },
        business: {
          product: "cli",
          version: "1.0.0",
          type: "agent",
          stage: "start",
          id: crypto3.randomUUID(),
          name: lastUserText.substring(0, 30),
          begin_at: Date.now()
        }
      };
      const chatURL = getQoderChatURL(providerMode);
      const modelSource = modelConfig.source || "system";
      const requestedRetries = options?.maxRetries;
      const modelBusyRetries = Math.min(
        Math.max(
          0,
          typeof requestedRetries === "number" && Number.isFinite(requestedRetries) ? Math.floor(requestedRetries) : DEFAULT_MODEL_BUSY_RETRIES
        ),
        MAX_MODEL_BUSY_RETRIES
      );
      const requestedMaxWaitMs = options?.maxRetryDelayMs;
      const modelBusyMaxWaitMs = typeof requestedMaxWaitMs === "number" && Number.isFinite(requestedMaxWaitMs) && requestedMaxWaitMs > 0 ? Math.min(MODEL_BUSY_MAX_WAIT_MS, requestedMaxWaitMs) : MODEL_BUSY_MAX_WAIT_MS;
      let encodedBytes = qoderEncodeBody(Buffer.from(JSON.stringify(reqBody)));
      let headers = buildAuthHeaders(encodedBytes, chatURL, {
        userID,
        authToken: accessToken,
        name,
        email,
        machineID
      });
      const thinkingEnabled = options?.reasoning !== false && options?.reasoning !== "off";
      stream.push({ type: "start", partial: output });
      const runAttempt = async () => {
        options?.signal?.throwIfAborted();
        output.stopReason = "stop";
        output.errorMessage = void 0;
        output.responseId = void 0;
        output.responseModel = void 0;
        output.usage = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        };
        const response = await fetch(chatURL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
            "Accept-Encoding": "identity",
            "X-Model-Key": qoderModel,
            "X-Model-Source": modelSource,
            ...headers
          },
          body: encodedBytes,
          signal: options?.signal
        });
        if (!response.ok) {
          if (overrides?.structuredErrors) throw new QoderHttpError("Qoder chat request failed", response.status);
          const errText = await response.text();
          throw new Error(`Qoder API request failed: ${response.status} ${response.statusText}. Response: ${errText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");
        const decoder = new TextDecoder();
        let buffer = "";
        let bufferStart = 0;
        let contentBlockIndex = -1;
        let thinkingBlockIndex = -1;
        let rawReasoningTail = "";
        let toolCalls;
        const thinkingParser = thinkingEnabled ? new ThinkingTagParser(output, stream) : null;
        let sawModelOutput = false;
        let sawDone = false;
        try {
          while (!sawDone) {
            const { done, value } = await reader.read();
            if (done) break;
            if (bufferStart > 0) {
              buffer = buffer.substring(bufferStart);
              bufferStart = 0;
            }
            buffer += decoder.decode(value, { stream: true });
            while (true) {
              const lineEnd = buffer.indexOf("\n", bufferStart);
              if (lineEnd === -1) break;
              const line = buffer.substring(bufferStart, lineEnd).trim();
              bufferStart = lineEnd + 1;
              if (!line.startsWith("data:")) continue;
              const dataStr = line.substring(5).trim();
              if (dataStr === "[DONE]") {
                sawDone = true;
                break;
              }
              try {
                const envelope = JSON.parse(dataStr);
                if (envelope.statusCodeValue && envelope.statusCodeValue !== 200) {
                  const busy = parseModelBusyRejection(envelope.body);
                  if (busy?.kind === "ready") {
                    throw new QoderModelBusyError(
                      `Upstream status ${envelope.statusCodeValue}: ${envelope.body}`,
                      busy.retryAfterMs,
                      sawModelOutput
                    );
                  }
                  if (busy?.kind === "queued") {
                    if (sawModelOutput) {
                      throw new Error("Qoder model rejected the request after partial output (10605 RESOURCE_LIMIT)");
                    }
                    throw formatQueuedBusyError(busy);
                  }
                  if (overrides?.structuredErrors)
                    throw new QoderHttpError("Qoder upstream request failed", envelope.statusCodeValue);
                  throw new Error(`Upstream status ${envelope.statusCodeValue}: ${envelope.body}`);
                }
                const innerStr = envelope.body;
                if (innerStr === "[DONE]") {
                  sawDone = true;
                  break;
                }
                if (!innerStr) continue;
                const inner = JSON.parse(innerStr);
                if (inner.id) output.responseId = inner.id;
                if (inner.model) output.responseModel = inner.model;
                if (inner.usage) {
                  applyQoderCredits(output.usage, inner.usage, model.provider === "qoder-cn" ? "qoder-cn" : "qoder");
                  const u = inner.usage;
                  const promptTokens = u.prompt_tokens ?? 0;
                  const cacheReadTokens = u.prompt_tokens_details?.cached_tokens ?? 0;
                  const cacheWriteTokens = u.prompt_tokens_details?.cache_write_tokens ?? 0;
                  output.usage.input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
                  output.usage.output = u.completion_tokens ?? 0;
                  output.usage.totalTokens = u.total_tokens ?? 0;
                  output.usage.cacheRead = cacheReadTokens;
                  output.usage.cacheWrite = cacheWriteTokens;
                }
                if (inner.choices && inner.choices.length > 0) {
                  const choice = inner.choices[0];
                  const delta = choice.delta;
                  if (delta) {
                    if (delta.reasoning_content || delta.content || Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
                      sawModelOutput = true;
                    }
                    if (delta.reasoning_content) {
                      rawReasoningTail = (rawReasoningTail + delta.reasoning_content).slice(-512);
                      const reasoningChunk = stripDsmlResidue(stripThinkingTags(delta.reasoning_content));
                      if (reasoningChunk) {
                        if (thinkingBlockIndex === -1) {
                          thinkingBlockIndex = output.content.length;
                          output.content.push({ type: "thinking", thinking: "" });
                          stream.push({ type: "thinking_start", contentIndex: thinkingBlockIndex, partial: output });
                        }
                        const block = output.content[thinkingBlockIndex];
                        block.thinking += reasoningChunk;
                        stream.push({
                          type: "thinking_delta",
                          contentIndex: thinkingBlockIndex,
                          delta: reasoningChunk,
                          partial: output
                        });
                      }
                    }
                    if (delta.content) {
                      if (thinkingBlockIndex !== -1) {
                        const block = output.content[thinkingBlockIndex];
                        stream.push({
                          type: "thinking_end",
                          contentIndex: thinkingBlockIndex,
                          content: block.thinking,
                          partial: output
                        });
                        thinkingBlockIndex = -1;
                      }
                      if (thinkingParser) {
                        thinkingParser.processChunk(delta.content);
                        if (toolCalls?.lastToolState) refreshToolIndexes(output, toolCalls);
                      } else {
                        if (contentBlockIndex === -1) {
                          contentBlockIndex = output.content.length;
                          output.content.push({ type: "text", text: "" });
                          stream.push({ type: "text_start", contentIndex: contentBlockIndex, partial: output });
                        }
                        const block = output.content[contentBlockIndex];
                        block.text += delta.content;
                        stream.push({
                          type: "text_delta",
                          contentIndex: contentBlockIndex,
                          delta: delta.content,
                          partial: output
                        });
                      }
                    }
                    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                      for (const tc of delta.tool_calls) {
                        const id = tc.id || "";
                        const name2 = tc.function?.name || "";
                        const argDelta = tc.function?.arguments ?? "";
                        if (typeof id !== "string" || typeof name2 !== "string") {
                          throw new Error("Tool-call identity conflict: invalid metadata");
                        }
                        if (typeof argDelta !== "string") throw new Error("Invalid tool-call argument fragment");
                        if (!id && !name2 && !argDelta) continue;
                        toolCalls ??= {
                          states: [],
                          byId: /* @__PURE__ */ new Map(),
                          byIndex: /* @__PURE__ */ new Map(),
                          unscopedCandidates: /* @__PURE__ */ new Set(),
                          statesByBlock: /* @__PURE__ */ new Map()
                        };
                        const index = typeof tc.index === "number" ? tc.index : void 0;
                        let candidates;
                        if (index !== void 0) {
                          candidates = toolCalls.byIndex.get(index);
                          if (!candidates) {
                            candidates = { states: /* @__PURE__ */ new Set(), complete: /* @__PURE__ */ new Set(), unique: void 0 };
                            toolCalls.byIndex.set(index, candidates);
                          }
                        }
                        let state = id ? toolCalls.byId.get(id) : void 0;
                        let associated = !!state && !!candidates && candidates.states.has(state);
                        if (id && candidates && !associated && candidates.complete.size > 0) {
                          retireCompleteCandidates(toolCalls, candidates);
                        }
                        const available = candidates?.states ?? toolCalls.unscopedCandidates;
                        if (!state) {
                          const only = available.size === 1 ? candidates ? candidates.unique : available.values().next().value : void 0;
                          if (!id && available.size > 1) {
                            throw new Error(`Ambiguous tool-call continuation (candidates=${available.size})`);
                          }
                          if (only && (!id || !only.id)) {
                            state = only;
                            associated = candidates !== void 0;
                          } else {
                            state = {
                              argumentChunks: [],
                              argumentLength: 0,
                              depth: 0,
                              inString: false,
                              escaped: false,
                              complete: false,
                              id: "",
                              name: "",
                              contentIndex: -1,
                              candidates: /* @__PURE__ */ new Set(),
                              unindexed: index === void 0
                            };
                            toolCalls.states.push(state);
                          }
                        }
                        if (name2 && state.name && name2 !== state.name) {
                          throw new Error("Tool-call identity conflict: inconsistent name");
                        }
                        const newlyIdentified = !!id && !state.id;
                        const newlyNamed = !!name2 && !state.name;
                        if (newlyIdentified) {
                          state.id = id;
                          toolCalls.byId.set(id, state);
                        }
                        if (newlyNamed) state.name = name2;
                        if (!associated) {
                          toolCalls.unscopedCandidates.add(state);
                          if (candidates) {
                            state.unindexed = false;
                            state.candidates.add(candidates);
                            candidates.states.add(state);
                            candidates.unique = candidates.states.size === 1 ? state : void 0;
                            if (state.complete && state.id) candidates.complete.add(state);
                          }
                        }
                        const wasComplete = state.complete;
                        if (argDelta) appendToolArguments(state, argDelta);
                        if (state.complete && state.id && (!wasComplete || newlyIdentified)) {
                          for (const scope of state.candidates) scope.complete.add(state);
                        }
                        if (!state.block && (state.id || state.name)) {
                          state.block = { type: "toolCall", id: state.id, name: state.name, arguments: {} };
                          state.contentIndex = output.content.length;
                          output.content.push(state.block);
                          toolCalls.statesByBlock.set(state.block, state);
                          toolCalls.lastToolState = state;
                          stream.push({ type: "toolcall_start", contentIndex: state.contentIndex, partial: output });
                          for (const fragment of state.argumentChunks) {
                            stream.push({
                              type: "toolcall_delta",
                              contentIndex: state.contentIndex,
                              delta: fragment,
                              partial: output
                            });
                          }
                        } else if (state.block) {
                          if (newlyIdentified) state.block.id = state.id;
                          if (newlyNamed) state.block.name = state.name;
                          if (argDelta) {
                            stream.push({
                              type: "toolcall_delta",
                              contentIndex: state.contentIndex,
                              delta: argDelta,
                              partial: output
                            });
                          }
                        }
                      }
                    }
                  }
                  if (choice.finish_reason) {
                    output.stopReason = choice.finish_reason;
                  }
                }
              } catch (e) {
                if (e instanceof SyntaxError) {
                  if (process.env.QODER_DEBUG) {
                    console.error("[pi-provider-qoder] skipping malformed SSE line:", dataStr.slice(0, 200));
                  }
                  continue;
                }
                throw e;
              }
            }
          }
        } finally {
          try {
            await reader.cancel().catch(() => {
            });
          } finally {
            reader.releaseLock();
          }
        }
        if (thinkingParser) {
          thinkingParser.finalize();
          if (toolCalls?.lastToolState) refreshToolIndexes(output, toolCalls);
        }
        if (thinkingBlockIndex !== -1) {
          const block = output.content[thinkingBlockIndex];
          stream.push({
            type: "thinking_end",
            contentIndex: thinkingBlockIndex,
            content: block.thinking,
            partial: output
          });
        }
        if (toolCalls) {
          for (const state of toolCalls.states) {
            if (!state.id || !state.name) {
              throw new Error(`Unresolved tool-call identity (characters=${state.argumentLength})`);
            }
            parseToolArguments(state);
          }
          for (const [block, state] of toolCalls.statesByBlock) {
            block.arguments = parseToolArguments(state);
            stream.push({
              type: "toolcall_end",
              contentIndex: state.contentIndex,
              toolCall: block,
              partial: output
            });
          }
          if (toolCalls.statesByBlock.size > 0 && output.stopReason !== "length") {
            output.stopReason = "toolUse";
          }
        }
        if (isDegenerateDsmlTurn(output, rawReasoningTail)) {
          output.stopReason = "error";
          output.errorMessage = "Qoder server error: degenerate model output (unparseable DSML tool-call markup, no tool call executed)";
          stream.push({ type: "error", reason: "error", error: output });
          stream.end();
          return;
        }
        stream.push({
          type: "done",
          reason: output.stopReason,
          message: output
        });
        stream.end();
      };
      for (let attempt = 0; ; attempt++) {
        try {
          await runAttempt();
          return;
        } catch (e) {
          if (!(e instanceof QoderModelBusyError)) throw e;
          if (e.sawModelOutput || output.content.length > 0) {
            throw new Error("Qoder model rejected the request after partial output (10605 RESOURCE_LIMIT)");
          }
          const requestedWaitMs = e.retryAfterMs ?? 0;
          if (attempt >= modelBusyRetries) {
            throw new QoderModelBusyError(
              `Qoder server error: model is busy (10605 RESOURCE_LIMIT, retryAfterSeconds=${Math.round(requestedWaitMs / 1e3)}, attempts=${attempt + 1})`,
              requestedWaitMs
            );
          }
          if (requestedWaitMs > modelBusyMaxWaitMs) {
            throw new QoderModelBusyError(
              `Qoder server error: model is busy (10605 RESOURCE_LIMIT, requested delay ${requestedWaitMs}ms exceeds local cap ${modelBusyMaxWaitMs}ms)`,
              requestedWaitMs
            );
          }
          await sleepWithAbort(requestedWaitMs, options?.signal);
          options?.signal?.throwIfAborted();
          const nextId = crypto3.randomUUID();
          reqBody.request_id = nextId;
          reqBody.chat_record_id = nextId;
          encodedBytes = qoderEncodeBody(Buffer.from(JSON.stringify(reqBody)));
          headers = buildAuthHeaders(encodedBytes, chatURL, {
            userID,
            authToken: accessToken,
            name,
            email,
            machineID
          });
        }
      }
    } catch (e) {
      if (overrides?.structuredErrors) Object.assign(output, { qoderError: e });
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = e instanceof Error ? e.message : String(e);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      try {
        stream.end();
      } catch {
      }
    }
  })();
  return stream;
}

// src/magpie/errors.ts
var MessagesInputError = class extends Error {
};
function publicError(error, secrets = [], statusOverride) {
  const requestedStatus = statusOverride ?? (error instanceof QoderHttpError ? error.status : error instanceof MessagesInputError ? 400 : error instanceof DOMException && error.name === "AbortError" ? 499 : error instanceof DOMException && error.name === "TimeoutError" ? 504 : 502);
  const status = Number.isInteger(Number(requestedStatus)) && Number(requestedStatus) >= 400 && Number(requestedStatus) <= 599 ? Number(requestedStatus) : 502;
  const type = status === 401 ? "authentication_error" : status === 403 ? "permission_error" : status === 429 ? "rate_limit_error" : status === 400 ? "invalid_request_error" : status === 529 ? "overloaded_error" : "api_error";
  let message = status === 401 ? "Qoder authentication failed" : status === 403 ? "Qoder permission denied" : status === 429 ? "Qoder rate limit exceeded" : status === 499 ? "Qoder request cancelled" : `Qoder request failed (${status})`;
  if (error instanceof QoderQueuedError) message = error.message;
  else if (error instanceof MessagesInputError) message = error.message;
  else if (error instanceof Error && /^Invalid or incomplete tool-call JSON \(characters=\d+\)$/.test(error.message))
    message = error.message;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
    message = message.split(secret).join("[redacted]");
  return { status, error: { type, message } };
}
function errorResponse(error, status, secrets = []) {
  const result = publicError(error, secrets, status);
  return Response.json(
    { type: "error", error: result.error },
    {
      status: result.status,
      headers: error instanceof QoderQueuedError && result.status === 429 && error.waitMs > 0 ? { "retry-after": String(Math.ceil(error.waitMs / 1e3)) } : void 0
    }
  );
}

// src/magpie/messages.ts
import { randomUUID } from "node:crypto";
var zeroUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
});
function userContent(blocks) {
  return blocks.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text ?? "" };
    if (block.type === "image" && block.source?.type === "base64" && block.source.data && block.source.media_type) {
      return { type: "image", data: block.source.data, mimeType: block.source.media_type };
    }
    throw new MessagesInputError(`Unsupported Messages content: ${block.type}`);
  });
}
function requestContext(body, model) {
  if (!Array.isArray(body.messages)) throw new MessagesInputError("Messages must be an array");
  if (body.tool_choice && !["auto", "none"].includes(body.tool_choice.type))
    throw new MessagesInputError("Qoder supports automatic tool choice only");
  if (body.tools && (!Array.isArray(body.tools) || body.tools.some(
    (tool) => !tool || typeof tool.name !== "string" || !tool.input_schema || typeof tool.input_schema !== "object"
  )))
    throw new MessagesInputError("Invalid tools");
  const messages = [];
  const names = /* @__PURE__ */ new Map();
  for (const message of body.messages) {
    if (!message || typeof message.content !== "string" && !Array.isArray(message.content))
      throw new MessagesInputError("Invalid message content");
    const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    if (blocks.some((block) => !block || typeof block.type !== "string"))
      throw new MessagesInputError("Invalid message block");
    if (message.role === "assistant") {
      const content = blocks.map((block) => {
        if (block.type === "text") return { type: "text", text: block.text ?? "" };
        if (block.type === "thinking")
          return { type: "thinking", thinking: block.thinking ?? "", thinkingSignature: block.signature };
        if (block.type === "tool_use" && block.id && block.name && block.input && typeof block.input === "object" && !Array.isArray(block.input)) {
          names.set(block.id, block.name);
          return { type: "toolCall", id: block.id, name: block.name, arguments: block.input };
        }
        throw new MessagesInputError(`Unsupported assistant block: ${block.type}`);
      });
      messages.push({
        role: "assistant",
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: zeroUsage(),
        stopReason: content.some((b) => b.type === "toolCall") ? "toolUse" : "stop",
        timestamp: Date.now()
      });
    } else if (message.role === "user") {
      let pending = [];
      const flush = () => {
        if (pending.length) messages.push({ role: "user", content: userContent(pending), timestamp: Date.now() });
        pending = [];
      };
      for (const block of blocks) {
        if (block.type !== "tool_result") {
          pending.push(block);
          continue;
        }
        flush();
        if (!block.tool_use_id || !names.has(block.tool_use_id))
          throw new MessagesInputError("Tool result has no matching tool call");
        if (block.content !== void 0 && typeof block.content !== "string" && !Array.isArray(block.content))
          throw new MessagesInputError("Invalid tool result content");
        const resultContent = userContent(
          typeof block.content === "string" ? [{ type: "text", text: block.content }] : block.content ?? []
        );
        if (block.is_error) resultContent.unshift({ type: "text", text: "[Tool error]\n" });
        messages.push({
          role: "toolResult",
          toolCallId: block.tool_use_id,
          toolName: names.get(block.tool_use_id),
          content: resultContent,
          isError: block.is_error ?? false,
          timestamp: Date.now()
        });
      }
      flush();
    } else throw new MessagesInputError("Unsupported Messages role");
  }
  const systemPrompt = typeof body.system === "string" ? body.system : body.system?.map((b) => {
    if (b.type !== "text") throw new MessagesInputError("Unsupported system block");
    return b.text ?? "";
  }).join("\n\n");
  return {
    systemPrompt,
    messages,
    tools: body.tool_choice?.type === "none" ? [] : body.tools?.map((t) => ({ name: t.name, description: t.description ?? "", parameters: t.input_schema }))
  };
}
function contentOf(block) {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "thinking")
    return { type: "thinking", thinking: block.thinking, signature: block.thinkingSignature ?? "" };
  if (block.type === "toolCall") return { type: "tool_use", id: block.id, name: block.name, input: block.arguments };
  throw new Error("Unsupported Qoder response block");
}
function usageOf(message) {
  return {
    input_tokens: message.usage.input,
    output_tokens: message.usage.output,
    cache_read_input_tokens: message.usage.cacheRead,
    cache_creation_input_tokens: message.usage.cacheWrite
  };
}
function stopOf(message) {
  if (message.stopReason === "length") return "max_tokens";
  if (message.stopReason === "toolUse") return "tool_use";
  if (message.stopReason === "stop") return "end_turn";
  throw new Error(`Qoder stopped with ${message.stopReason}`);
}
function streamError(message) {
  return message.qoderError ?? new Error(message.errorMessage ?? "Qoder request failed");
}
async function messagesResponse(events, body, abort, onComplete = () => {
}, secrets = []) {
  const id = `msg_${randomUUID()}`;
  if (body.stream === false) {
    try {
      let final;
      for await (const event of events) {
        if (event.type === "error") throw streamError(event.error);
        if (event.type === "done") final = event.message;
      }
      if (!final) throw new Error("Qoder stream ended without a result");
      return Response.json({
        id,
        type: "message",
        role: "assistant",
        model: body.model,
        content: final.content.map(contentOf),
        stop_reason: stopOf(final),
        stop_sequence: null,
        usage: usageOf(final)
      });
    } catch (error) {
      return errorResponse(error, void 0, secrets);
    } finally {
      onComplete();
    }
  }
  const iterator = events[Symbol.asyncIterator]();
  let first;
  try {
    while (true) {
      first = await iterator.next();
      if (first.done) throw new Error("Qoder stream ended without a result");
      const event = first.value;
      if (event.type === "error") throw streamError(event.error);
      if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "done") break;
    }
  } catch (error) {
    onComplete();
    return errorResponse(error, abort.signal.aborted ? 499 : void 0, secrets);
  }
  async function* remaining() {
    if (!first.done) yield first.value;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  const encoder = new TextEncoder();
  let cancelled = false;
  const readable = new ReadableStream({
    async start(controller) {
      const put = (type, value) => {
        if (!cancelled)
          controller.enqueue(encoder.encode(`event: ${type}
data: ${JSON.stringify({ type, ...value })}

`));
      };
      const indexes = /* @__PURE__ */ new Map();
      const emitted = /* @__PURE__ */ new Map();
      let next = 0;
      let finished = false;
      const begin = (block) => {
        let index = indexes.get(block);
        if (index !== void 0) return index;
        index = next++;
        indexes.set(block, index);
        const content = block.type === "text" ? { type: "text", text: "" } : block.type === "thinking" ? { type: "thinking", thinking: "", signature: "" } : { type: "tool_use", id: block.id, name: block.name, input: {} };
        put("content_block_start", { index, content_block: content });
        return index;
      };
      try {
        put("message_start", {
          message: {
            id,
            type: "message",
            role: "assistant",
            model: body.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 }
          }
        });
        for await (const event of remaining()) {
          if (event.type === "error") throw streamError(event.error);
          if (event.type === "text_delta" || event.type === "thinking_delta") {
            const block = event.qoderBlock;
            if (!block) throw new Error("Missing stable Qoder block identity");
            const index = begin(block);
            emitted.set(block, (emitted.get(block) ?? 0) + event.delta.length);
            put("content_block_delta", {
              index,
              delta: event.type === "text_delta" ? { type: "text_delta", text: event.delta } : { type: "thinking_delta", thinking: event.delta }
            });
          }
          if (event.type === "done") {
            for (const block of event.message.content) {
              const index = begin(block);
              if (block.type === "toolCall")
                put("content_block_delta", {
                  index,
                  delta: { type: "input_json_delta", partial_json: JSON.stringify(block.arguments) }
                });
              else {
                const text = block.type === "text" ? block.text : block.thinking;
                const rest = text.slice(emitted.get(block) ?? 0);
                if (rest)
                  put("content_block_delta", {
                    index,
                    delta: block.type === "text" ? { type: "text_delta", text: rest } : { type: "thinking_delta", thinking: rest }
                  });
              }
            }
            for (const index of indexes.values()) put("content_block_stop", { index });
            put("message_delta", {
              delta: { stop_reason: stopOf(event.message), stop_sequence: null },
              usage: usageOf(event.message)
            });
            put("message_stop", {});
            finished = true;
          }
        }
        if (!finished) throw new Error("Qoder stream ended without a result");
      } catch (error) {
        put("error", { error: publicError(error, secrets, abort.signal.aborted ? 499 : void 0).error });
      } finally {
        onComplete();
        if (!cancelled) controller.close();
      }
    },
    cancel(reason) {
      cancelled = true;
      abort.abort(reason);
      onComplete();
    }
  });
  return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

// src/magpie/usage.ts
function quotaUsage(raw) {
  const snapshot = normalizeQoderQuotaSnapshot(raw);
  if (!snapshot) throw new Error("Qoder returned no quota data");
  const until = snapshot.expiresAt === void 0 ? void 0 : new Date(snapshot.expiresAt).toISOString();
  const windows = [
    ["Personal quota", snapshot.userQuota],
    ["Add-on credits", snapshot.addOnQuota],
    ["Organization resource package", snapshot.orgResourcePackage]
  ].flatMap(([name, bucket]) => {
    if (!bucket) return [];
    const amount = bucket.used ?? (bucket.total !== void 0 && bucket.remaining !== void 0 && bucket.remaining <= bucket.total ? Math.max(0, bucket.total - bucket.remaining) : void 0);
    const used = bucket.total !== void 0 && bucket.total > 0 && amount !== void 0 ? Math.min(100, amount / bucket.total * 100) : void 0;
    const display = [
      bucket.remaining === void 0 ? void 0 : `${bucket.remaining}${bucket.unit ? ` ${bucket.unit}` : ""} remaining`,
      amount === void 0 ? void 0 : `${amount} used`,
      bucket.total === void 0 ? void 0 : `total ${bucket.total}`,
      until ? `Quota resets ${until}` : void 0
    ].filter(Boolean).join("; ");
    return [
      {
        name,
        ...until ? { resetsAt: until } : {},
        ...used === void 0 ? {} : { used },
        ...amount === void 0 ? {} : { amount },
        ...bucket.total === void 0 ? {} : { limit: bucket.total },
        ...bucket.unit ? { unit: bucket.unit } : {},
        display,
        aside: true
      }
    ];
  });
  return { ...until ? { until } : {}, windows };
}

// src/magpie/index.ts
async function identity(auth, mode, signal) {
  if (auth.type === "api") return await credentialsFromPat(auth.key, mode, signal);
  if (auth.userID)
    return {
      ...auth,
      machineID: auth.machineID || getMachineId(),
      email: auth.email || "",
      name: auth.name || ""
    };
  return {
    ...auth,
    ...await fetchUserInfo(auth.access, mode, signal, true),
    machineID: auth.machineID || getMachineId()
  };
}
function accountCredentials(creds, mode) {
  const q = creds;
  const region = getQoderRegionConfig(mode);
  const uid = q.userID && q.userID !== "qoder-user" ? q.userID : q.uid;
  const email = q.email && q.email !== region.userEmailFallback ? q.email : "";
  return { ...q, email, uid, accountId: email || uid || "" };
}
function secretsOf(auth) {
  return auth.type === "api" ? [auth.key] : [auth.access, auth.refresh, ...auth.refresh.split("|")];
}
function accountKey(creds) {
  const parts = creds.refresh.split("|");
  return createHash2("sha256").update(parts[0] === "pat" ? parts[1] : creds.refresh || creds.access).digest("hex");
}
function withSignal(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      work.catch(() => {
      });
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
function reasoningOf(body, model) {
  if (!body.thinking || body.thinking.type === "disabled") return void 0;
  if (!["enabled", "adaptive"].includes(body.thinking.type)) throw new MessagesInputError("Unsupported thinking mode");
  if (!model.reasoning) return void 0;
  if (body.output_config?.effort) return body.output_config.effort;
  const budget = body.thinking.budget_tokens;
  return budget === void 0 ? "high" : budget <= 4096 ? "low" : budget <= 12e3 ? "medium" : budget <= 24e3 ? "high" : "xhigh";
}
function createPlugin(mode) {
  const region = getQoderRegionConfig(mode);
  const id = region.providerID;
  return async ({ client }) => {
    const catalogs = /* @__PURE__ */ new Map();
    const credentials = async (getAuth, signal, secrets = []) => {
      const auth = await getAuth();
      if (!auth) throw new QoderHttpError("Sign in required", 401);
      secrets.push(...secretsOf(auth));
      signal?.throwIfAborted();
      let creds = accountCredentials(await identity(auth, mode, signal), mode);
      signal?.throwIfAborted();
      if (creds.expires <= Date.now()) {
        creds = accountCredentials(
          await refreshQoderTokenForMode(creds, mode, true, { signal, cacheModels: false }),
          mode
        );
        signal?.throwIfAborted();
        secrets.push(creds.access, creds.refresh);
        await client.auth.set({ path: { id }, body: { ...creds, type: "oauth" } });
      } else if (auth.type === "api") await client.auth.set({ path: { id }, body: { ...creds, type: "oauth" } });
      return creds;
    };
    const catalogFor = async (creds, refresh = false, signal) => {
      const key = accountKey(creds);
      const cached = catalogs.get(key);
      if (cached && !refresh) return cached;
      const catalog = await fetchQoderCatalog(creds.access, creds.userID, creds.name, creds.email, mode, signal);
      catalog.configs = Object.fromEntries(
        Object.entries(catalog.configs).map(([modelId, config]) => [modelId, withMaxContextAsDefault(config)])
      );
      catalogs.set(key, catalog);
      return catalog;
    };
    const models = (definitions) => Object.fromEntries(
      definitions.map((model) => [
        model.id,
        {
          name: model.name,
          reasoning: model.reasoning,
          limit: { context: model.contextWindow, output: model.maxTokens },
          modalities: { input: model.input, output: ["text"] },
          variants: Object.fromEntries(
            Object.entries(model.thinkingLevelMap ?? {}).filter(([, value]) => value !== null && value !== void 0).map(([level]) => [
              level === "off" ? "none" : level,
              level === "off" ? { thinking: { type: "disabled" } } : {
                thinking: {
                  type: "enabled",
                  budgetTokens: { minimal: 1024, low: 2048, medium: 8192, high: 16e3, xhigh: 32e3, max: 64e3 }[level]
                },
                output_config: { effort: level }
              }
            ])
          )
        }
      ])
    );
    return {
      config: async (config) => {
        config.provider ??= {};
        config.provider[id] = {
          name: mode === "cn" ? "Qoder CN" : "Qoder",
          npm: "@ai-sdk/anthropic",
          api: "https://qoder.invalid/v1",
          models: models(mode === "cn" ? staticCnModels : staticModels)
        };
      },
      auth: {
        provider: id,
        methods: [
          ...region.supportsBrowserLogin ? [
            {
              type: "oauth",
              label: "Browser OAuth",
              async authorize() {
                let show;
                const shown = new Promise((resolve) => {
                  show = resolve;
                });
                const result = interactiveLogin(
                  { onPrompt: async () => "", onAuth: show },
                  mode
                ).then(
                  (creds) => ({ ...accountCredentials(creds, mode), type: "success" }),
                  (error) => ({
                    type: "failed",
                    error: publicError(error).error.message
                  })
                );
                const start = await Promise.race([shown, result]);
                if (!("url" in start))
                  throw new Error("error" in start ? start.error : "Browser login did not start");
                return { ...start, method: "auto", callback: () => result };
              }
            }
          ] : [],
          {
            type: "api",
            label: "Personal Access Token",
            prompts: [
              {
                type: "text",
                key: "pat",
                message: "Qoder Personal Access Token (pt-...)",
                validate: (value) => value.trim() ? void 0 : "Token is required"
              }
            ],
            async authorize(inputs) {
              const pat = (inputs.pat ?? inputs.credential ?? "").trim();
              if (!pat) return { type: "failed", error: "Token is required" };
              try {
                return { ...accountCredentials(await credentialsFromPat(pat, mode), mode), type: "success" };
              } catch (error) {
                return { type: "failed", error: publicError(error, [pat]).error.message };
              }
            }
          }
        ],
        refresh: async (auth) => {
          try {
            return accountCredentials(await refreshQoderTokenForMode(auth, mode, true, { cacheModels: false }), mode);
          } catch (error) {
            const safe = publicError(error);
            throw new QoderHttpError(safe.error.message, safe.status);
          }
        },
        loader: async (getAuth) => ({
          apiKey: "qoder-local-adapter",
          async fetch(input, init) {
            const request = new Request(input, init);
            if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/messages"))
              return errorResponse(new Error("Only Anthropic Messages requests are supported"), 400);
            const abort = new AbortController();
            const onAbort = () => abort.abort(request.signal.reason);
            if (request.signal.aborted) onAbort();
            else request.signal.addEventListener("abort", onAbort, { once: true });
            const secrets = [];
            try {
              abort.signal.throwIfAborted();
              let body;
              try {
                body = await request.json();
              } catch {
                throw new MessagesInputError("Invalid JSON request");
              }
              if (!body || typeof body !== "object" || Array.isArray(body))
                throw new MessagesInputError("Expected a Messages request object");
              const creds = await withSignal(credentials(getAuth, abort.signal, secrets), abort.signal);
              const catalog = await withSignal(catalogFor(creds, false, abort.signal), abort.signal);
              const def = catalog.models.find((model2) => model2.id === body.model);
              if (!def || !catalog.configs[def.id]) throw new MessagesInputError(`Unknown ${id} model`);
              const model = def;
              const context = requestContext(body, model);
              abort.signal.throwIfAborted();
              const reasoning = reasoningOf(body, model);
              const events = streamQoder(
                model,
                context,
                {
                  apiKey: creds.access,
                  maxTokens: body.max_tokens,
                  temperature: body.temperature,
                  reasoning,
                  signal: abort.signal
                },
                creds,
                { modelConfig: catalog.configs[def.id], stableEvents: true, structuredErrors: true }
              );
              const response = await messagesResponse(
                events,
                body,
                abort,
                () => request.signal.removeEventListener("abort", onAbort),
                secrets
              );
              return response;
            } catch (error) {
              request.signal.removeEventListener("abort", onAbort);
              return errorResponse(error, abort.signal.aborted ? 499 : void 0, secrets);
            }
          }
        }),
        usage: async (getAuth) => {
          const deadline = AbortSignal.timeout(1e4);
          const secrets = [];
          try {
            return await withSignal(
              (async () => {
                const creds = await credentials(getAuth, deadline, secrets);
                const usage = await fetchQoderUsageForMode(creds, mode, deadline);
                return {
                  plan: region.usageTitle,
                  user: creds.email || creds.name || void 0,
                  ...quotaUsage(usage.raw)
                };
              })(),
              deadline
            );
          } catch (error) {
            const safe = publicError(error, secrets);
            throw new QoderHttpError(safe.error.message, safe.status);
          }
        }
      },
      provider: {
        id,
        models: async (provider, { auth }) => {
          let definitions = mode === "cn" ? staticCnModels : staticModels;
          if (auth) {
            try {
              const creds = await credentials(async () => auth);
              definitions = (await catalogFor(creds, true)).models;
            } catch (error) {
              const safe = publicError(error, secretsOf(auth));
              throw new QoderHttpError(safe.error.message, safe.status);
            }
          }
          const template = Object.values(provider.models)[0] ?? {};
          return Object.fromEntries(
            Object.entries(models(definitions)).map(([key, value]) => [
              key,
              {
                ...template,
                ...provider.models[key],
                ...value,
                id: key,
                capabilities: {
                  ...template.capabilities ?? {},
                  reasoning: value.reasoning,
                  toolcall: true,
                  input: {
                    text: true,
                    image: value.modalities.input.includes("image"),
                    audio: false,
                    video: false,
                    pdf: false
                  },
                  output: { text: true }
                },
                api: {
                  ...template.api ?? {},
                  id: key,
                  npm: "@ai-sdk/anthropic",
                  url: "https://qoder.invalid/v1"
                }
              }
            ])
          );
        }
      }
    };
  };
}
var QoderPlugin = createPlugin("global");
var QoderCNPlugin = createPlugin("cn");
export {
  QoderCNPlugin,
  QoderPlugin
};
