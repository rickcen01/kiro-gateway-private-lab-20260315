const DEFAULT_REGION = "us-east-1";
const DEFAULT_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_SKEW_MS = 60 * 1000;
const OPENAI_SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive",
};
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

const tokenState = {
  accessToken: null,
  expiresAtMs: 0,
  refreshToken: null,
  profileArn: null,
};

const modelCache = {
  models: null,
  expiresAtMs: 0,
};

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(env),
    });
  }

  try {
    if (request.method === "GET" && url.pathname === "/") {
      return withCors(
        env,
        jsonResponse({
          status: "ok",
          message: "Kiro Gateway Cloudflare Worker is running",
          version: "worker-0.1.0",
        }),
      );
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return withCors(
        env,
        jsonResponse({
          status: "healthy",
          timestamp: new Date().toISOString(),
          version: "worker-0.1.0",
        }),
      );
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      verifyBearerAuth(request, env);
      return withCors(env, await handleModels(env));
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      verifyBearerAuth(request, env);
      const payload = await request.json();
      return withCors(env, await handleOpenAIChat(payload, env));
    }

    if (request.method === "POST" && url.pathname === "/v1/messages") {
      verifyAnthropicAuth(request, env);
      const payload = await request.json();
      return withCors(env, await handleAnthropicMessages(payload, env));
    }

    return withCors(
      env,
      errorResponse(404, "not_found", `Unknown route: ${request.method} ${url.pathname}`),
    );
  } catch (error) {
    return withCors(env, handleError(error));
  }
}

export function buildCorsHeaders(env) {
  return {
    "access-control-allow-origin": env.CORS_ORIGIN || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Authorization,Content-Type,x-api-key,anthropic-version",
    "access-control-max-age": "86400",
  };
}

export function withCors(env, response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(buildCorsHeaders(env))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

export function errorResponse(status, type, message) {
  return jsonResponse(
    {
      error: {
        type,
        message,
      },
    },
    status,
  );
}

function handleError(error) {
  if (error instanceof HttpError) {
    return errorResponse(error.status, error.type, error.message);
  }
  return errorResponse(500, "internal_error", error?.message || "Internal error");
}

export class HttpError extends Error {
  constructor(status, type, message) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

export function verifyBearerAuth(request, env) {
  const expected = env.PROXY_API_KEY;
  if (!expected) {
    throw new HttpError(500, "config_error", "PROXY_API_KEY is not configured");
  }
  if (request.headers.get("Authorization") !== `Bearer ${expected}`) {
    throw new HttpError(401, "authentication_error", "Invalid or missing API key");
  }
}

export function verifyAnthropicAuth(request, env) {
  const expected = env.PROXY_API_KEY;
  if (!expected) {
    throw new HttpError(500, "config_error", "PROXY_API_KEY is not configured");
  }

  const xApiKey = request.headers.get("x-api-key");
  const authHeader = request.headers.get("Authorization");
  if (xApiKey === expected || authHeader === `Bearer ${expected}`) {
    return;
  }

  throw new HttpError(
    401,
    "authentication_error",
    "Invalid or missing API key. Use x-api-key or Authorization: Bearer.",
  );
}

export async function handleModels(env) {
  const models = await fetchAvailableModels(env);
  const created = Math.floor(Date.now() / 1000);
  return jsonResponse({
    object: "list",
    data: models.map((model) => ({
      id: model.modelId,
      object: "model",
      created,
      owned_by: "anthropic",
      description: model.description || null,
    })),
  });
}

export async function handleOpenAIChat(requestData, env) {
  const conversationId = crypto.randomUUID();
  const kiroPayload = buildKiroPayloadFromOpenAI(
    requestData,
    conversationId,
    getProfileArn(env),
  );
  const kiroResponse = await callKiroGenerateAssistantResponse(kiroPayload, env);

  if (requestData.stream) {
    return streamKiroToOpenAI(kiroResponse, requestData.model, env);
  }

  const result = await collectKiroStream(kiroResponse);
  return jsonResponse(buildOpenAINonStreamingResponse(result, requestData.model));
}

export async function handleAnthropicMessages(requestData, env) {
  const conversationId = crypto.randomUUID();
  const kiroPayload = buildKiroPayloadFromAnthropic(
    requestData,
    conversationId,
    getProfileArn(env),
  );
  const kiroResponse = await callKiroGenerateAssistantResponse(kiroPayload, env);

  if (requestData.stream) {
    return streamKiroToAnthropic(kiroResponse, requestData.model, env);
  }

  const result = await collectKiroStream(kiroResponse);
  return jsonResponse(buildAnthropicNonStreamingResponse(result, requestData.model));
}

export function getRegion(env) {
  return env.KIRO_REGION || DEFAULT_REGION;
}

export function getProfileArn(env) {
  return tokenState.profileArn || env.KIRO_PROFILE_ARN || "";
}

export function getRefreshUrl(env) {
  return `https://prod.${getRegion(env)}.auth.desktop.kiro.dev/refreshToken`;
}

export function getApiHost(env) {
  return `https://q.${getRegion(env)}.amazonaws.com`;
}

export function buildKiroHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent":
      "aws-sdk-js/1.0.27 ua/2.1 os/linux#cloudflare-worker lang/js md/cloudflare-worker api/codewhispererstreaming#1.0.27 m/E KiroIDE-0.7.45-cloudflare-worker",
    "x-amz-user-agent": "aws-sdk-js/1.0.27 KiroIDE-0.7.45-cloudflare-worker",
    "x-amzn-codewhisperer-optout": "true",
    "x-amzn-kiro-agent-mode": "vibe",
    "amz-sdk-invocation-id": crypto.randomUUID(),
    "amz-sdk-request": "attempt=1; max=3",
  };
}

export async function ensureAccessToken(env) {
  const now = Date.now();
  if (tokenState.accessToken && tokenState.expiresAtMs > now + DEFAULT_TOKEN_SKEW_MS) {
    return tokenState.accessToken;
  }

  const refreshToken = tokenState.refreshToken || env.KIRO_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new HttpError(500, "config_error", "KIRO_REFRESH_TOKEN is not configured");
  }

  const response = await fetch(getRefreshUrl(env), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "KiroGatewayCloudflareWorker/0.1.0",
    },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    throw new HttpError(502, "upstream_auth_error", `Token refresh failed: ${await response.text()}`);
  }

  const data = await response.json();
  if (!data.accessToken) {
    throw new HttpError(502, "upstream_auth_error", "Token refresh response missing accessToken");
  }

  tokenState.accessToken = data.accessToken;
  tokenState.refreshToken = data.refreshToken || refreshToken;
  tokenState.profileArn = data.profileArn || tokenState.profileArn || env.KIRO_PROFILE_ARN || null;
  tokenState.expiresAtMs = now + Number(data.expiresIn || 3600) * 1000;
  return tokenState.accessToken;
}

export async function fetchAvailableModels(env) {
  const now = Date.now();
  if (modelCache.models && modelCache.expiresAtMs > now) {
    return modelCache.models;
  }

  const token = await ensureAccessToken(env);
  const params = new URLSearchParams({ origin: "AI_EDITOR" });
  const profileArn = getProfileArn(env);
  if (profileArn) {
    params.set("profileArn", profileArn);
  }

  const response = await fetch(`${getApiHost(env)}/ListAvailableModels?${params.toString()}`, {
    method: "GET",
    headers: buildKiroHeaders(token),
  });

  if (!response.ok) {
    throw new HttpError(502, "upstream_error", `ListAvailableModels failed: ${await response.text()}`);
  }

  const data = await response.json();
  modelCache.models = Array.isArray(data.models) ? data.models : [];
  modelCache.expiresAtMs = now + DEFAULT_MODEL_CACHE_TTL_MS;
  return modelCache.models;
}

export async function callKiroGenerateAssistantResponse(kiroPayload, env) {
  const token = await ensureAccessToken(env);
  const response = await fetch(`${getApiHost(env)}/generateAssistantResponse`, {
    method: "POST",
    headers: buildKiroHeaders(token),
    body: JSON.stringify(kiroPayload),
  });

  if (!response.ok) {
    throw new HttpError(
      502,
      "upstream_error",
      `generateAssistantResponse failed: ${await response.text()}`,
    );
  }

  if (!response.body) {
    throw new HttpError(502, "upstream_error", "Kiro response body is empty");
  }

  return response;
}

export function extractTextContent(content) {
  if (content == null) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (!item || typeof item !== "object") {
          return "";
        }
        if (typeof item.text === "string") {
          return item.text;
        }
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        if (item.type === "input_text" && typeof item.text === "string") {
          return item.text;
        }
        if (item.type === "tool_result") {
          return extractTextContent(item.content);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof content === "object" && typeof content.text === "string") {
    return content.text;
  }

  return String(content);
}

export function normalizeOpenAITools(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") {
        return null;
      }

      if (tool.function) {
        return {
          name: tool.function.name || "",
          description: tool.function.description || `Tool: ${tool.function.name || "unknown"}`,
          inputSchema: tool.function.parameters || {},
        };
      }

      if (tool.name) {
        return {
          name: tool.name,
          description: tool.description || `Tool: ${tool.name}`,
          inputSchema: tool.input_schema || {},
        };
      }

      return null;
    })
    .filter(Boolean);
}

export function normalizeOpenAIToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object") {
        return null;
      }

      const rawArguments = toolCall.function?.arguments ?? "{}";
      return {
        id: toolCall.id || `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
        type: "function",
        function: {
          name: toolCall.function?.name || "",
          arguments:
            typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments || {}),
        },
      };
    })
    .filter(Boolean);
}

export function extractOpenAIToolResults(content) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((item) => item && typeof item === "object" && item.type === "tool_result")
    .map((item) => ({
      toolUseId: item.tool_use_id || "",
      content: extractTextContent(item.content) || "(empty result)",
    }));
}

export function openAIToUnifiedMessages(messages) {
  const systemParts = [];
  const unified = [];

  for (const message of messages || []) {
    if (!message || typeof message !== "object") {
      continue;
    }

    if (message.role === "system") {
      const text = extractTextContent(message.content);
      if (text) {
        systemParts.push(text);
      }
      continue;
    }

    if (message.role === "tool") {
      unified.push({
        role: "user",
        content: "",
        toolCalls: [],
        toolResults: [
          {
            toolUseId: message.tool_call_id || "",
            content: extractTextContent(message.content) || "(empty result)",
          },
        ],
      });
      continue;
    }

    if (message.role === "assistant") {
      unified.push({
        role: "assistant",
        content: extractTextContent(message.content),
        toolCalls: normalizeOpenAIToolCalls(message.tool_calls),
        toolResults: [],
      });
      continue;
    }

    unified.push({
      role: "user",
      content: extractTextContent(message.content),
      toolCalls: [],
      toolResults: extractOpenAIToolResults(message.content),
    });
  }

  return {
    systemPrompt: systemParts.join("\n\n").trim(),
    messages: unified,
  };
}

export function normalizeAnthropicTools(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") {
        return null;
      }
      return {
        name: tool.name || "",
        description: tool.description || `Tool: ${tool.name || "unknown"}`,
        inputSchema: tool.input_schema || {},
      };
    })
    .filter(Boolean);
}

export function anthropicToUnifiedMessages(requestData) {
  const systemPrompt =
    typeof requestData.system === "string"
      ? requestData.system
      : Array.isArray(requestData.system)
        ? extractTextContent(requestData.system)
        : "";

  const messages = (requestData.messages || []).map((message) => {
    const blocks = Array.isArray(message.content) ? message.content : [];
    const textParts = [];
    const toolCalls = [];
    const toolResults = [];

    for (const block of blocks) {
      if (!block || typeof block !== "object") {
        continue;
      }

      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id || `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
          type: "function",
          function: {
            name: block.name || "",
            arguments: JSON.stringify(block.input || {}),
          },
        });
      } else if (block.type === "tool_result") {
        toolResults.push({
          toolUseId: block.tool_use_id || "",
          content: extractTextContent(block.content) || "(empty result)",
        });
      }
    }

    return {
      role: message.role === "assistant" ? "assistant" : "user",
      content: textParts.join("\n"),
      toolCalls,
      toolResults,
    };
  });

  return {
    systemPrompt,
    messages,
  };
}

export function normalizeRole(role) {
  return role === "assistant" ? "assistant" : "user";
}

export function mergeAdjacentMessages(messages) {
  const merged = [];
  for (const message of messages) {
    const normalized = {
      role: normalizeRole(message.role),
      content: message.content || "",
      toolCalls: Array.isArray(message.toolCalls) ? [...message.toolCalls] : [],
      toolResults: Array.isArray(message.toolResults) ? [...message.toolResults] : [],
    };

    const previous = merged.at(-1);
    if (!previous || previous.role !== normalized.role) {
      merged.push(normalized);
      continue;
    }

    previous.content = [previous.content, normalized.content].filter(Boolean).join("\n\n");
    previous.toolCalls.push(...normalized.toolCalls);
    previous.toolResults.push(...normalized.toolResults);
  }
  return merged;
}

export function ensureFirstUser(messages) {
  if (!messages.length || messages[0].role === "user") {
    return messages;
  }
  return [{ role: "user", content: "(empty)", toolCalls: [], toolResults: [] }, ...messages];
}

export function ensureAlternatingRoles(messages) {
  if (!messages.length) {
    return messages;
  }

  const result = [messages[0]];
  for (const message of messages.slice(1)) {
    const previous = result.at(-1);
    if (previous.role === message.role) {
      result.push({
        role: previous.role === "user" ? "assistant" : "user",
        content: "(empty)",
        toolCalls: [],
        toolResults: [],
      });
    }
    result.push(message);
  }
  return result;
}

export function stripToolContent(messages) {
  return messages.map((message) => {
    const textParts = [];
    if (message.content) {
      textParts.push(message.content);
    }

    for (const toolCall of message.toolCalls || []) {
      textParts.push(
        `[Tool: ${toolCall.function?.name || "unknown"}]\n${toolCall.function?.arguments || "{}"}`,
      );
    }

    for (const toolResult of message.toolResults || []) {
      textParts.push(
        `[Tool Result (${toolResult.toolUseId || "unknown"})]\n${toolResult.content || "(empty result)"}`,
      );
    }

    return {
      role: message.role,
      content: textParts.filter(Boolean).join("\n\n"),
      toolCalls: [],
      toolResults: [],
    };
  });
}

export function toKiroToolSpecifications(tools) {
  return (tools || []).map((tool) => ({
    toolSpecification: {
      name: tool.name,
      description: tool.description || `Tool: ${tool.name}`,
      inputSchema: {
        json: tool.inputSchema || {},
      },
    },
  }));
}

export function toKiroToolUses(toolCalls) {
  return (toolCalls || []).map((toolCall) => ({
    name: toolCall.function?.name || "",
    input: safeJsonParse(toolCall.function?.arguments, {}),
    toolUseId: toolCall.id || "",
  }));
}

export function toKiroToolResults(toolResults) {
  return (toolResults || []).map((toolResult) => ({
    content: [{ text: toolResult.content || "(empty result)" }],
    status: "success",
    toolUseId: toolResult.toolUseId || "",
  }));
}

export function buildKiroPayloadFromOpenAI(requestData, conversationId, profileArn) {
  const { systemPrompt, messages } = openAIToUnifiedMessages(requestData.messages || []);
  const tools = normalizeOpenAITools(requestData.tools);
  return buildKiroPayloadFromUnified({
    systemPrompt,
    messages,
    tools,
    modelId: resolveModelId(requestData.model),
    conversationId,
    profileArn,
  });
}

export function buildKiroPayloadFromAnthropic(requestData, conversationId, profileArn) {
  const { systemPrompt, messages } = anthropicToUnifiedMessages(requestData);
  const tools = normalizeAnthropicTools(requestData.tools);
  return buildKiroPayloadFromUnified({
    systemPrompt,
    messages,
    tools,
    modelId: resolveModelId(requestData.model),
    conversationId,
    profileArn,
  });
}

export function resolveModelId(model) {
  return model === "auto-kiro" ? "auto" : model;
}

export function buildKiroPayloadFromUnified({
  systemPrompt,
  messages,
  tools,
  modelId,
  conversationId,
  profileArn,
}) {
  let workingMessages = mergeAdjacentMessages(messages || []);
  if (!tools.length) {
    workingMessages = stripToolContent(workingMessages);
  }
  workingMessages = ensureFirstUser(workingMessages);
  workingMessages = ensureAlternatingRoles(workingMessages);

  if (!workingMessages.length) {
    throw new HttpError(400, "invalid_request_error", "No messages to send");
  }

  const historyMessages = workingMessages.slice(0, -1);
  const currentMessage = { ...workingMessages.at(-1) };

  if (systemPrompt) {
    if (historyMessages.length > 0 && historyMessages[0].role === "user") {
      historyMessages[0] = {
        ...historyMessages[0],
        content: [systemPrompt, historyMessages[0].content].filter(Boolean).join("\n\n"),
      };
    } else {
      currentMessage.content = [systemPrompt, currentMessage.content].filter(Boolean).join("\n\n");
    }
  }

  const history = historyMessages.map((message) => buildHistoryEntry(message, modelId));
  let currentContent = currentMessage.content || "";

  if (currentMessage.role === "assistant") {
    history.push(buildHistoryEntry(currentMessage, modelId));
    currentContent = "Continue";
  }

  if (!currentContent) {
    currentContent = "Continue";
  }

  const currentContext = {};
  const kiroTools = toKiroToolSpecifications(tools);
  if (kiroTools.length) {
    currentContext.tools = kiroTools;
  }
  const currentToolResults = toKiroToolResults(currentMessage.toolResults);
  if (currentToolResults.length) {
    currentContext.toolResults = currentToolResults;
  }

  const userInputMessage = {
    content: currentContent,
    modelId,
    origin: "AI_EDITOR",
  };

  if (Object.keys(currentContext).length > 0) {
    userInputMessage.userInputMessageContext = currentContext;
  }

  const payload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId,
      currentMessage: {
        userInputMessage,
      },
    },
  };

  if (history.length > 0) {
    payload.conversationState.history = history;
  }

  if (profileArn) {
    payload.profileArn = profileArn;
  }

  return payload;
}

export function buildHistoryEntry(message, modelId) {
  if (message.role === "assistant") {
    const entry = {
      assistantResponseMessage: {
        content: message.content || "(empty)",
      },
    };
    const toolUses = toKiroToolUses(message.toolCalls);
    if (toolUses.length) {
      entry.assistantResponseMessage.toolUses = toolUses;
    }
    return entry;
  }

  const userInputMessage = {
    content: message.content || "(empty)",
    modelId,
    origin: "AI_EDITOR",
  };
  const toolResults = toKiroToolResults(message.toolResults);
  if (toolResults.length) {
    userInputMessage.userInputMessageContext = {
      toolResults,
    };
  }
  return {
    userInputMessage,
  };
}

export function safeJsonParse(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

class AwsEventStreamParser {
  constructor() {
    this.buffer = "";
    this.lastContent = null;
    this.currentToolCall = null;
    this.toolCalls = [];
  }

  feed(textChunk) {
    this.buffer += textChunk;
    const events = [];

    while (true) {
      const match = findEarliestEvent(this.buffer);
      if (!match) {
        break;
      }

      const endIndex = findMatchingBrace(this.buffer, match.index);
      if (endIndex === -1) {
        break;
      }

      const jsonText = this.buffer.slice(match.index, endIndex + 1);
      this.buffer = this.buffer.slice(endIndex + 1);

      let data;
      try {
        data = JSON.parse(jsonText);
      } catch {
        continue;
      }

      const event = this.processEvent(data, match.type);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  processEvent(data, type) {
    if (type === "content") {
      const content = data.content || "";
      if (data.followupPrompt || content === this.lastContent) {
        return null;
      }
      this.lastContent = content;
      return { type: "content", data: content };
    }

    if (type === "tool_start") {
      if (this.currentToolCall) {
        this.finalizeToolCall();
      }
      const rawInput =
        typeof data.input === "string" ? data.input : JSON.stringify(data.input || {});
      this.currentToolCall = {
        id: data.toolUseId || `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
        type: "function",
        function: {
          name: data.name || "",
          arguments: rawInput,
        },
      };
      if (data.stop) {
        this.finalizeToolCall();
      }
      return null;
    }

    if (type === "tool_input") {
      if (this.currentToolCall) {
        const chunk =
          typeof data.input === "string" ? data.input : JSON.stringify(data.input || {});
        this.currentToolCall.function.arguments += chunk;
      }
      return null;
    }

    if (type === "tool_stop") {
      if (this.currentToolCall && data.stop) {
        this.finalizeToolCall();
      }
      return null;
    }

    if (type === "usage") {
      return { type: "usage", data: data.usage || null };
    }

    if (type === "context_usage") {
      return { type: "context_usage", data: data.contextUsagePercentage || 0 };
    }

    return null;
  }

  finalizeToolCall() {
    if (!this.currentToolCall) {
      return;
    }

    const parsed = safeJsonParse(this.currentToolCall.function.arguments || "{}", null);
    if (parsed !== null) {
      this.currentToolCall.function.arguments = JSON.stringify(parsed);
    }
    this.toolCalls.push(this.currentToolCall);
    this.currentToolCall = null;
  }
}

export function findEarliestEvent(buffer) {
  const patterns = [
    ['{"content":', "content"],
    ['{"name":', "tool_start"],
    ['{"input":', "tool_input"],
    ['{"stop":', "tool_stop"],
    ['{"usage":', "usage"],
    ['{"contextUsagePercentage":', "context_usage"],
  ];

  let best = null;
  for (const [pattern, type] of patterns) {
    const index = buffer.indexOf(pattern);
    if (index === -1) {
      continue;
    }
    if (!best || index < best.index) {
      best = { index, type };
    }
  }
  return best;
}

export function findMatchingBrace(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

export async function collectKiroStream(response) {
  const parser = new AwsEventStreamParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const result = {
    content: "",
    toolCalls: [],
    usage: null,
    contextUsagePercentage: 0,
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    const text = decoder.decode(value, { stream: true });
    const events = parser.feed(text);
    for (const event of events) {
      if (event.type === "content") {
        result.content += event.data;
      } else if (event.type === "usage") {
        result.usage = event.data;
      } else if (event.type === "context_usage") {
        result.contextUsagePercentage = event.data;
      }
    }
  }

  if (parser.currentToolCall) {
    parser.finalizeToolCall();
  }

  result.toolCalls = parser.toolCalls;
  return result;
}

export function buildOpenAINonStreamingResponse(result, model) {
  const completionId = `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`;
  const message = {
    role: "assistant",
    content: result.content || "",
  };

  if (result.toolCalls.length) {
    message.tool_calls = result.toolCalls;
  }

  return {
    id: completionId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: result.toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

export function buildAnthropicNonStreamingResponse(result, model) {
  const content = [];
  if (result.content) {
    content.push({
      type: "text",
      text: result.content,
    });
  }
  for (const toolCall of result.toolCalls) {
    content.push({
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.function?.name || "",
      input: safeJsonParse(toolCall.function?.arguments, {}),
    });
  }

  return {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: result.toolCalls.length ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}

export function streamKiroToOpenAI(response, model, env) {
  const parser = new AwsEventStreamParser();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const completionId = `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`;
  const created = Math.floor(Date.now() / 1000);

  const stream = new ReadableStream({
    async start(controller) {
      let firstChunk = true;
      const reader = response.body.getReader();

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          const text = decoder.decode(value, { stream: true });
          const events = parser.feed(text);
          for (const event of events) {
            if (event.type !== "content") {
              continue;
            }

            const delta = { content: event.data };
            if (firstChunk) {
              delta.role = "assistant";
              firstChunk = false;
            }

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: completionId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [{ index: 0, delta, finish_reason: null }],
                })}\n\n`,
              ),
            );
          }
        }

        if (parser.currentToolCall) {
          parser.finalizeToolCall();
        }

        if (parser.toolCalls.length) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: parser.toolCalls.map((toolCall, index) => ({
                        index,
                        id: toolCall.id,
                        type: "function",
                        function: {
                          name: toolCall.function?.name || "",
                          arguments: toolCall.function?.arguments || "{}",
                        },
                      })),
                    },
                    finish_reason: null,
                  },
                ],
              })}\n\n`,
            ),
          );
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: parser.toolCalls.length ? "tool_calls" : "stop",
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...OPENAI_SSE_HEADERS,
      ...buildCorsHeaders(env),
    },
  });
}

export function streamKiroToAnthropic(response, model, env) {
  const parser = new AwsEventStreamParser();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const messageId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;

  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body.getReader();
      let blockStarted = false;

      controller.enqueue(
        encoder.encode(
          `event: message_start\ndata: ${JSON.stringify({
            type: "message_start",
            message: {
              id: messageId,
              type: "message",
              role: "assistant",
              model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          })}\n\n`,
        ),
      );

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          const text = decoder.decode(value, { stream: true });
          const events = parser.feed(text);
          for (const event of events) {
            if (event.type !== "content") {
              continue;
            }

            if (!blockStarted) {
              blockStarted = true;
              controller.enqueue(
                encoder.encode(
                  `event: content_block_start\ndata: ${JSON.stringify({
                    type: "content_block_start",
                    index: 0,
                    content_block: { type: "text", text: "" },
                  })}\n\n`,
                ),
              );
            }

            controller.enqueue(
              encoder.encode(
                `event: content_block_delta\ndata: ${JSON.stringify({
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: event.data },
                })}\n\n`,
              ),
            );
          }
        }

        if (blockStarted) {
          controller.enqueue(
            encoder.encode(
              `event: content_block_stop\ndata: ${JSON.stringify({
                type: "content_block_stop",
                index: 0,
              })}\n\n`,
            ),
          );
        }

        controller.enqueue(
          encoder.encode(
            `event: message_delta\ndata: ${JSON.stringify({
              type: "message_delta",
              delta: {
                stop_reason: "end_turn",
                stop_sequence: null,
              },
              usage: {
                output_tokens: 0,
              },
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...OPENAI_SSE_HEADERS,
      ...buildCorsHeaders(env),
    },
  });
}
