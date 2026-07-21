import { scoreConfidence, runQuery, PRESET_QUERIES } from './src/zhiwen/engine';
(async () => {
  const data = await loadZhiwenNetworkData();
  const broken = [];
  for (const p of PRESET_QUERIES) {
    const conf = scoreConfidence(p.query);
    try {
      const r = runQuery(p.query, data as any);
      const isFallback = r.text.startsWith('未找到与') || r.text.startsWith('未找到') || r.text.startsWith('请输入更多信息') || r.text.startsWith('请输入您想问');
      const isEmpty = r.totalCount === 0;
      if (isFallback || isEmpty || conf.score < 0.4) {
        broken.push({ tag: p.tag, query: p.query, score: conf.score, reason: isFallback ? 'fallback' : (isEmpty ? 'empty' : 'low-score'), text0: r.text.split('\n')[0].substring(0, 60) });
      }
    } catch (e) {
      broken.push({ tag: p.tag, query: p.query, reason: 'ERROR', error: e.message });
    }
  }
  console.log('Total:', PRESET_QUERIES.length, 'Broken:', broken.length);
  for (const b of broken) console.log(JSON.stringify(b));
})();
