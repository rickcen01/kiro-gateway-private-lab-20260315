import test from "node:test";
import assert from "node:assert/strict";

import {
  buildKiroPayloadFromOpenAI,
  extractTextContent,
  ensureAlternatingRoles,
  normalizeOpenAITools,
} from "../src/index.js";

test("extractTextContent handles content block arrays", () => {
  const value = extractTextContent([
    { type: "text", text: "hello" },
    { type: "text", text: "world" },
  ]);

  assert.equal(value, "hello\nworld");
});

test("normalizeOpenAITools supports standard function format", () => {
  const tools = normalizeOpenAITools([
    {
      type: "function",
      function: {
        name: "search_docs",
        description: "Search docs",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
    },
  ]);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "search_docs");
  assert.equal(tools[0].inputSchema.properties.query.type, "string");
});

test("ensureAlternatingRoles inserts synthetic assistant messages", () => {
  const messages = ensureAlternatingRoles([
    { role: "user", content: "one", toolCalls: [], toolResults: [] },
    { role: "user", content: "two", toolCalls: [], toolResults: [] },
  ]);

  assert.equal(messages.length, 3);
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].content, "(empty)");
});

test("buildKiroPayloadFromOpenAI injects system prompt and tools", () => {
  const payload = buildKiroPayloadFromOpenAI(
    {
      model: "auto-kiro",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "List files" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "bash",
            description: "Run bash",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
              },
            },
          },
        },
      ],
    },
    "conversation-123",
    "arn:test:profile",
  );

  assert.equal(payload.profileArn, "arn:test:profile");
  assert.equal(payload.conversationState.currentMessage.userInputMessage.modelId, "auto");
  assert.match(
    payload.conversationState.currentMessage.userInputMessage.content,
    /You are a helpful assistant/,
  );
  assert.equal(
    payload.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools[0]
      .toolSpecification.name,
    "bash",
  );
});
