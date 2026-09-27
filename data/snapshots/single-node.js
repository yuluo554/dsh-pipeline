// dsh-pipeline 0.1.0 — compiled pipeline "single-node".
// 1 node, 1 agent call; failure policy: abort (M1).
const out = {};
phase("Echo");
{
  const __p1 = await agent("Summarize the following in one sentence:\n" + args, {
    label: "Echo",
  });
  if (__p1 === null) throw new Error("node \"echo\" failed at prompt 1");
  out["echo"] = __p1;
}
return { nodes: out };
