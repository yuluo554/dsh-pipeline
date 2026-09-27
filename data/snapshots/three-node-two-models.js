// dsh-pipeline 0.1.0 — compiled pipeline "three-node-two-models".
// 3 nodes, 3 agent calls; failure policy: abort (M1).
const out = {};
phase("Outline");
{
  const __p1 = await agent("Write a concise bullet-list outline for a short article about " + args + ". Return only the outline.", {
    label: "Outline",
    provider: "deepseek",
    model: "deepseek-chat",
  });
  if (__p1 === null) throw new Error("node \"outline\" failed at prompt 1");
  out["outline"] = __p1;
}
phase("Review");
{
  const __p1 = await agent("Review the following outline for factual risks and gaps. Return a short numbered list of revision notes.\n\nOutline:\n" + out["outline"], {
    label: "Review",
  });
  if (__p1 === null) throw new Error("node \"review\" failed at prompt 1");
  out["review"] = __p1;
}
phase("Write");
{
  const __p1 = await agent("Write the final short article about " + args + " using this outline:\n" + out["outline"] + "\n\nApply these review notes:\n" + out["review"] + "\n\nReturn only the article text.", {
    label: "Write",
    provider: "deepseek",
    model: "deepseek-reasoner",
  });
  if (__p1 === null) throw new Error("node \"write\" failed at prompt 1");
  out["write"] = __p1;
}
return { nodes: out };
