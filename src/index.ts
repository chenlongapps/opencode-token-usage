import { Plugin } from "@opencode/plugin";
import { ContextCapture } from "./context-capture.js";
import { ContextSourceRpc } from "./context-rpc.js";

export default Plugin.define({
  id: "opencode-token-usage",
  async setup(context) {
    const capture = new ContextCapture(context.mcp, context.storage);
    const rpc = await context.rpc.register(ContextSourceRpc, {
      clock: async () => Date.now(),
      latest: async input => {
        const sessionID = (input as { sessionID: string }).sessionID;
        return { estimate: await capture.latest(sessionID) ?? null };
      },
    });
    const hook = await context.session.hook("context", async request => {
      try {
        await capture.capture(request);
      } catch {
        // Instrumentation must not interrupt the model call.
      }
    });
    const stop = new AbortController();
    const events = (async () => {
      try {
        for await (const event of context.event.subscribe({ signal: stop.signal })) {
          if (event.type === "session.deleted") {
            try { await capture.remove(event.data.sessionID); } catch { /* Keep processing later events. */ }
          }
          if (event.type === "mcp.status.changed" || event.type === "mcp.resources.changed") capture.invalidateMcp();
        }
      } catch {
        // A disconnect or shutdown must not affect model requests.
      }
    })();
    return async () => {
      stop.abort();
      await hook.dispose();
      await capture.flush();
      await rpc.dispose();
      void events;
    };
  },
});
