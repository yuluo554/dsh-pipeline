// dsh-pipeline 0.2.0 — compiled pipeline "output-schema".
// 2 nodes, 2 agent calls max; policies: keywords=abort, tagline=abort.
const out = {};
phase("Keywords");
{
  const __p1 = await agent("Extract exactly three keywords about " + args + ". Return them as the schema requires.", {
    label: "Keywords",
    schema: {
      "type": "object",
      "properties": {
        "keywords": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "keywords"
      ],
      "additionalProperties": false
    },
  });
  if (__p1 === null) throw new Error("node \"keywords\" failed at prompt 1");
  out["keywords"] = __p1;
}
phase("Tagline");
{
  const __p1 = await agent("Write a one-line tagline using these keywords (given as JSON): " + JSON.stringify(out["keywords"]), {
    label: "Tagline",
  });
  if (__p1 === null) throw new Error("node \"tagline\" failed at prompt 1");
  out["tagline"] = __p1;
}
return { nodes: out };
