import { Plugin, Provider, Model } from "@opencode/plugin";

// Test-only provider. All inference is served by the local smoke-test HTTP server.
export default Plugin.define({
  id: "token-usage.smoke-provider",
  async setup(context) {
    const providerID = Provider.ID.make("usage-test");
    const models = ["small", "large"].map((name, index) => ({
      ...Model.Info.default(providerID, Model.ID.make(name)),
      name: `Usage Test ${name}`,
      limit: { context: 128000, output: 4096 },
      cost: [{ input: 2 * (index + 1), output: 8 * (index + 1), cache: { read: 0.2, write: 3 } }],
    }));
    await context.provider.transform(editor => editor.add({
      info: {
        ...Provider.Info.empty(providerID),
        name: "Token Usage Test",
        activation: "enabled",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: context.options.baseURL },
      },
      models,
    }));
  },
});
