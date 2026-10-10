// Local-only Responses SSE fixture: initial summary burst, done-only summary,
// spaced text and a quiet gate. It never contacts OpenAI or needs real credentials.
export async function respond(response, data, gates) {
  const base = {
    id: "resp_usage_smoke", object: "response", created_at: Math.floor(Date.now() / 1000),
    model: data.model, status: "in_progress", output: [],
  };
  const part = text => ({ type: "output_text", text, annotations: [] });
  const message = text => ({ id: "msg_usage_smoke", type: "message", role: "assistant", status: "completed", content: [part(text)] });
  const usage = { input_tokens: 1200, input_tokens_details: { cached_tokens: 1000 },
    output_tokens: 1000, output_tokens_details: { reasoning_tokens: 800 }, total_tokens: 2200 };
  if (!data.stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ...base, status: "completed", output: [message("Smoke session")], usage }));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  let sequence = 0;
  const emit = (type, fields = {}) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...fields })}\n\n`);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  emit("response.created", { response: base });
  emit("response.in_progress", { response: base });
  const reasoning = { id: "rs_usage_smoke", type: "reasoning", summary: [] };
  emit("response.output_item.added", { output_index: 0, item: reasoning });
  const reasoningFields = { output_index: 0, item_id: reasoning.id, summary_index: 0 };
  emit("response.reasoning_summary_part.added", { ...reasoningFields, part: { type: "summary_text", text: "" } });
  await sleep(300);
  const summary = "a".repeat(400);
  emit("response.reasoning_summary_text.delta", { ...reasoningFields, delta: summary });
  await sleep(10);
  emit("response.reasoning_summary_text.delta", { ...reasoningFields, delta: summary });
  emit("response.reasoning_summary_text.done", { ...reasoningFields, text: summary.repeat(2) });
  emit("response.reasoning_summary_part.done", { ...reasoningFields, part: { type: "summary_text", text: summary.repeat(2) } });
  // No delta for the second part: the adapter synthesizes one from its done text.
  const fallbackFields = { ...reasoningFields, summary_index: 1 };
  emit("response.reasoning_summary_part.added", { ...fallbackFields, part: { type: "summary_text", text: "" } });
  emit("response.reasoning_summary_text.done", { ...fallbackFields, text: summary });
  emit("response.reasoning_summary_part.done", { ...fallbackFields, part: { type: "summary_text", text: summary } });
  reasoning.summary = [{ type: "summary_text", text: summary.repeat(2) }, { type: "summary_text", text: summary }];
  emit("response.output_item.done", { output_index: 0, item: reasoning });
  gates.started = true;
  await gates.burst.promise;
  const textFields = { output_index: 1, item_id: "msg_usage_smoke", content_index: 0 };
  emit("response.output_item.added", { output_index: 1, item: { ...message(""), status: "in_progress" } });
  emit("response.content_part.added", { ...textFields, part: part("") });
  const fragment = "SMOKE_OK ".repeat(4).padEnd(40, " ");
  for (let i = 0; i < 3; i++) {
    await sleep(600);
    emit("response.output_text.delta", { ...textFields, delta: fragment });
  }
  gates.textEnded = true;
  await gates.finish.promise;
  const answer = message(fragment.repeat(3));
  emit("response.output_text.done", { ...textFields, text: fragment.repeat(3) });
  emit("response.content_part.done", { ...textFields, part: answer.content[0] });
  emit("response.output_item.done", { output_index: 1, item: answer });
  emit("response.completed", { response: { ...base, status: "completed", output: [reasoning, answer], usage } });
  response.end();
}
