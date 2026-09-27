// dsh-pipeline 0.1.0 — compiled pipeline "depends-explicit".
// 3 nodes, 3 agent calls; failure policy: abort (M1).
const out = {};
phase("Facts");
{
  const __p1 = await agent("List five concise facts about " + args + ".", {
    label: "Facts",
  });
  if (__p1 === null) throw new Error("node \"facts\" failed at prompt 1");
  out["facts"] = __p1;
}
phase("Quotes");
{
  const __p1 = await agent("Write one short original quote about " + args + ".", {
    label: "Quotes",
  });
  if (__p1 === null) throw new Error("node \"quotes\" failed at prompt 1");
  out["quotes"] = __p1;
}
phase("Brief");
{
  const __p1 = await agent("Combine these facts:\n" + out["facts"] + "\n\nAnd this quote:\n" + out["quotes"] + "\n\nInto a one-paragraph brief.", {
    label: "Brief",
  });
  if (__p1 === null) throw new Error("node \"brief\" failed at prompt 1");
  out["brief"] = __p1;
}
return { nodes: out };
