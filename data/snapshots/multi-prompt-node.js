// dsh-pipeline 0.1.0 — compiled pipeline "multi-prompt-node".
// 1 node, 3 agent calls; failure policy: abort (M1).
const out = {};
phase("Planner");
{
  const __p1 = await agent("Task: " + args + "\nStep 1 - draft a short plan.", {
    label: "Planner #1",
  });
  if (__p1 === null) throw new Error("node \"planner\" failed at prompt 1");
  const __p2 = await agent("Step 2 - review your own plan and improve it:\n" + __p1, {
    label: "Planner #2",
  });
  if (__p2 === null) throw new Error("node \"planner\" failed at prompt 2");
  const __p3 = await agent("Step 3 - condense the improved plan into one paragraph:\n" + __p2, {
    label: "Planner #3",
  });
  if (__p3 === null) throw new Error("node \"planner\" failed at prompt 3");
  out["planner"] = __p3;
}
return { nodes: out };
