// 典故索引自测：条数、按场景挑典、候选清单
import { ALLUSIONS, ALLUSION_COUNT, inferSentiments, pickAllusions, allusionBrief, allusionsCoverage } from '../server/allusions.mjs';

const cov = allusionsCoverage();
console.log(`典故总数 ${cov.total}（A 先秦至唐 ${cov.a}，B 宋至近现代 ${cov.b}）`);
if (cov.total < 100) {
  console.log(`⚠ 总数 ${cov.total} < 100，A 可能尚未就绪`);
}

let bad = 0;
const REQUIRED = ['id', 'name', 'era', 'source', 'figures', 'gist', 'meaning', 'sentiment', 'usage', 'avoid', 'exampleInClassics'];
const ids = new Set();
const names = new Set();
for (const a of ALLUSIONS) {
  const miss = REQUIRED.filter((k) => a[k] === undefined || (Array.isArray(a[k]) ? !a[k].length : !String(a[k]).trim()));
  if (miss.length) {
    console.log(`✗ ${a.id || a.name} 缺字段：${miss.join('、')}`);
    bad++;
  }
  if (ids.has(a.id)) {
    console.log(`✗ id 重复：${a.id}`);
    bad++;
  }
  ids.add(a.id);
  if (names.has(a.name)) {
    console.log(`✗ 名称重复：${a.name}`);
    bad++;
  }
  names.add(a.name);
  if (!/《.+》/.test(String(a.source || ''))) {
    console.log(`✗ 出处未含书名号：${a.id} → ${a.source}`);
    bad++;
  }
}

// 按场景挑典
const SCENES = [
  '深夜的医院走廊，长椅上有人抱着外套睡着了。',
  '送朋友上火车，站台上风很大。',
  '登上一座古塔，看下面的旧城遗址。',
  '雨后独自在山里的旧院子坐着喝茶。',
  '清晨的菜市场，老人在挑青菜。',
];
console.log('\n=== 按场景挑典 ===');
for (const s of SCENES) {
  const picks = pickAllusions(s, 5);
  console.log(`场景：${s}`);
  console.log(`  推测情感：${inferSentiments(s).join('、') || '（无）'}`);
  console.log(`  候选：${picks.map((p) => p.name).join('、')}`);
  if (!picks.length) {
    console.log('  ✗ 没挑出候选');
    bad++;
  }
}

// 候选清单要能让模型看懂
const brief = allusionBrief('送朋友上火车，站台上风很大。', 4);
console.log('\n=== 给模型看的候选清单（节选）===');
console.log(brief.split('\n').slice(0, 10).join('\n'));
if (!brief.includes('最多用一处')) {
  console.log('✗ 清单缺少「最多用一处」的规矩');
  bad++;
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 处问题`);
process.exit(bad === 0 ? 0 : 1);
