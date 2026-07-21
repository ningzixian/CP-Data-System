import { scoreConfidence, isUnitLookupQuery, extractLookupKey, searchFacilityByKey } from "./src/zhiwen/engine";
const tests = ["1号楼有哪些设施", "1号楼有哪些设施？", "1号楼有什么", "1号楼有哪些", "1号楼有什么设施"];
for (const t of tests) {
  const c = scoreConfidence(t);
  const u = isUnitLookupQuery(t);
  const k = extractLookupKey(t);
  console.log(JSON.stringify(t), "score:", c.score.toFixed(2), "isUnitLookup:", u, "key:", JSON.stringify(k));
}
