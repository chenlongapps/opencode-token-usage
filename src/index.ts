import { Plugin } from "@opencode/plugin";
import { estimateContextSources, parseContextSources } from "./context-sources.js";
import { ContextSourceRpc } from "./context-rpc.js";

export default Plugin.define({
  id: "opencode-token-usage",
  async setup(context) {
    const rpc = await context.rpc.register(ContextSourceRpc, {
      latest: async input => {
        const sessionID = (input as { sessionID: string }).sessionID;
        return { estimate: parseContextSources(await context.storage.get(`context/${sessionID}`)) ?? null };
      },
    });
    const hook = await context.session.hook("context", async request => {
      try {
        const servers = (await context.mcp.list()).data.map(server => server.name);
        const estimate = estimateContextSources(request, servers);
        await context.storage.set(`context/${request.sessionID}`, {
          capturedAt: estimate.capturedAt, model: estimate.model, tokens: { ...estimate.tokens },
        });
      } catch {
        // Instrumentation must not interrupt the model call.
      }
    });
    return async () => { await hook.dispose(); await rpc.dispose(); };
  },
});
