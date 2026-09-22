import { Plugin, Provider, Model } from "@opencode/plugin";

// Test-only provider. All inference is served by the local smoke-test HTTP server.
export default Plugin.define({
  id: "token-usage.smoke-provider",
  async setup(context) {
    const providerID = Provider.ID.make("usage-test");
    const models = [
      { name: "small", context: 128000, cost: [{ input: 2, output: 8, cache: { read: 0.2, write: 3 } }] },
      { name: "large", context: 32000, cost: [{ input: 4, output: 16, cache: { read: 0.4, write: 3 } }] },
      // Intentionally absent from OpenCode's price data. The usage plugin must
      // match this manufacturer ID against its packaged official snapshot.
      { name: "gpt-5.6-luna", context: 1050000, cost: [] },
    ].map(({ name, context, cost }) => ({
      ...Model.Info.default(providerID, Model.ID.make(name)),
      name: `Usage Test ${name}`,
      limit: { context, output: 4096 },
      cost,
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
