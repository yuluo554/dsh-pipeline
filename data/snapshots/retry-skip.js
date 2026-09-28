// dsh-pipeline 0.2.0 — compiled pipeline "retry-skip".
// 4 nodes, 7 agent calls max; policies: fetch=skip:2, enrich=skip, report=abort, verify=abort:1.
const out = {};
phase("Fetch");
{
  let __fetch_attempt = 0;
  let __fetch_done = false;
  while (!__fetch_done && __fetch_attempt < 3) {
    __fetch_attempt += 1;
    __try_fetch: {
      const __p1 = await agent("Collect the key facts about " + args + ".", {
        label: "Fetch",
      });
      if (__p1 === null) break __try_fetch;
      out["fetch"] = __p1;
      __fetch_done = true;
    }
  }
  if (!__fetch_done) out["fetch"] = null;
}
phase("Enrich");
{
  let __enrich_attempt = 0;
  let __enrich_done = false;
  while (!__enrich_done && __enrich_attempt < 1) {
    __enrich_attempt += 1;
    __try_enrich: {
      const __p1 = await agent("Suggest one angle to deepen the treatment of " + args + ".", {
        label: "Enrich",
      });
      if (__p1 === null) break __try_enrich;
      out["enrich"] = __p1;
      __enrich_done = true;
    }
  }
  if (!__enrich_done) out["enrich"] = null;
}
phase("Report");
{
  const __p1 = await agent("Write a short report brief about " + args + ".", {
    label: "Report",
  });
  if (__p1 === null) throw new Error("node \"report\" failed at prompt 1");
  out["report"] = __p1;
}
phase("Verify");
{
  let __verify_attempt = 0;
  let __verify_done = false;
  let __verify_failedAt = 0;
  while (!__verify_done && __verify_attempt < 2) {
    __verify_attempt += 1;
    __try_verify: {
      const __p1 = await agent("Verify the report's claims about " + args + " in one paragraph.", {
        label: "Verify",
      });
      if (__p1 === null) {
        __verify_failedAt = 1;
        break __try_verify;
      }
      out["verify"] = __p1;
      __verify_done = true;
    }
  }
  if (!__verify_done) throw new Error("node \"verify\" failed at prompt " + __verify_failedAt + " after 2 attempt(s)");
}
return { nodes: out };
