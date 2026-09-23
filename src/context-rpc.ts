import { Rpc } from "@opencode/plugin/rpc";

const numbers = ["Messages", "System Tools", "System Prompt", "Skills", "MCP Tools", "Other"];

export const ContextSourceRpc = Rpc.define({
  id: "opencode-token-usage.context",
  methods: {
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
