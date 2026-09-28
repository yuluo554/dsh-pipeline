// dsh-pipeline 0.2.0 — compiled pipeline "single-node".
// 1 node, 1 agent call max; policies: echo=abort.
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
