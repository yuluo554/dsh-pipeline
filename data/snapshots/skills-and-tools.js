// dsh-pipeline 0.2.0 — compiled pipeline "skills-and-tools".
// 2 nodes, 2 agent calls max; policies: draft=abort, review=abort.
const out = {};
phase("Draft");
{
  const __p1 = await agent("<skill_content name=\"office\">\n<skill_resources>\nResources for this skill are managed by provider \"dsh-pipeline-bench\".\nLoad referenced resources only as needed.\n</skill_resources>\n\n<skill_instructions>\nOffice skill (canned): draft the brief as .docx via the document tool, then verify with the structure checker.\n</skill_instructions>\n</skill_content>\n\n" + "Draft a one-page brief on " + args + ", following the loaded skill's instructions.", {
    label: "Draft",
  });
  if (__p1 === null) throw new Error("node \"draft\" failed at prompt 1");
  out["draft"] = __p1;
}
phase("Review");
{
  const __p1 = await agent("Review this draft:\n" + out["draft"] + "\n\nJudge tone and length in two sentences.", {
    label: "Review",
  });
  if (__p1 === null) throw new Error("node \"review\" failed at prompt 1");
  out["review"] = __p1;
}
return { nodes: out };
