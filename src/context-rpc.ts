import { Rpc } from "@opencode/plugin/rpc";

const numbers = ["Messages", "System Tools", "System Prompt", "Skills", "MCP Tools", "Other"];

export const ContextSourceRpc = Rpc.define({
  id: "opencode-token-usage.context",
  methods: {
    // A read-only bootstrap for a quiet, already-running session. OpenCode
    // 2.0.26's synthetic server.connected envelope has no created timestamp.
    clock: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: { type: "number", minimum: 0 },
    },
    latest: {
      input: {
        type: "object", properties: { sessionID: { type: "string" } }, required: ["sessionID"], additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          estimate: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: {
                  capturedAt: { type: "number" }, model: { type: "string" },
                  tokens: {
                    type: "object", properties: Object.fromEntries(numbers.map(label => [label, { type: "number" }])),
                    required: numbers, additionalProperties: false,
                  },
                },
                required: ["capturedAt", "model", "tokens"], additionalProperties: false,
              },
            ],
          },
        },
        required: ["estimate"], additionalProperties: false,
      },
    },
  },
  events: {},
});
