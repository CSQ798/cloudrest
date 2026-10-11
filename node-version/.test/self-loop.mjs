// 自出题 → 作诗 → 自评 → 记下该修哪一类
//
// 用法（要真调模型，花钱）：
//   node .test/self-loop.mjs            跑默认的三道题
//   node .test/self-loop.mjs 定风波     只跑指定的体裁
//
// 这不是「验收测试」，是**找病**用的：它把成品的完整自检结果摊开，
// 让我们看清模型自己写的时候会掉进哪些坑，再回过头去改准则或改自检。
// 结果同时写进 .research/self-loop-log.md，留档可比。
//
// 与 worker-test 的分工：worker-test 验的是「链路通不通」，本脚本验的是「写得怎么样」。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { compose } from '../server/core.mjs';
import { layoutPoem } from '../server/format.mjs';

let key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  const t = await fs.promises.readFile(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
  key = t.match(/DEEPSEEK_API_KEY:\s*(\S+)/)[1];
}
const config = { apiKey: key, model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/chat/completions' };

// 自己给自己出的题：三道，场景不同、体裁不同，故意挑会露馅的题材。
const TASKS = [
  { form: '七言绝句', scene: '小雪节气，天将晚，一个收废品的老人推着车从结了薄冰的巷子里过去，车把上挂着一只旧收音机，还在响。', wish: '' },
  { form: '定风波', scene: '城里租房住，房东要涨租，深夜把书装箱，窗外是一排正在盖的楼，塔吊的红灯一闪一闪。', wish: '' },
  { form: '五言律诗', scene: '母亲把父亲生前用的一把旧剃须刀收在抽屉最里面，刀柄上还缠着一圈胶布。', wish: '' },
];

const only = process.argv[2];
// repeat N：同一道题、同一体裁，连着跑 N 遍 —— 用来量「同一道题自身的方差」。
// 上一轮想验「反馈越长格律越松」，可每轮三道题难度不同，数字没有可比性；
// 先把同一道题的方差量出来，才谈得上比较。
const REPEAT = process.argv[2] === 'repeat' ? Number(process.argv[3] || 3) : 0;
const tasks = REPEAT ? Array.from({ length: REPEAT }, (_, i) => ({ ...TASKS[0], form: TASKS[0].form, _n: i + 1 })) : only ? TASKS.filter((t) => t.form === only) : TASKS;

const out = [];
const log = (s = '') => {
  out.push(s);
  console.log(s);
};

log(`# 自出题循环 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
log('');
for (const [i, task] of tasks.entries()) {
  const form = task.form || '（让它自己挑）';
  log(`## 第 ${i + 1} 题　体裁：${form}`);
  log(`场景：${task.scene}`);
  log('');

  let result = null;
  const errs = [];
  const res = await compose({
    payload: { scene: task.scene, wish: task.wish, form: task.form, mode: 'compose' },
    config,
    signal: undefined,
    io: {
      write(chunk) {
        for (const line of String(chunk).split('\n')) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'result') result = ev;
            if (ev.type === 'error') errs.push(ev.message);
            if (ev.type === 'status') process.stdout.write(`\r  … ${ev.message}                    `);
          } catch {
            /* 半行，忽略 */
          }
        }
      },
    },
  });
  process.stdout.write('\r');
  if (!result) {
    log('✗ 没成：' + (errs.join('；') || JSON.stringify(res && (res.json || res))));
    log('');
    continue;
  }

  log(`【${result.title}】<${result.form}>　第 ${result.tries} 稿　润色重写=${result.revised}`);
  log('');
  log('```');
  for (const l of result.lines) log(l === '' ? '' : l);
  log('```');
  const v = result.verdict || {};
  log('');
  log(`校律：${v.level}　${JSON.stringify(v.stats || {})}`);
  log(`选韵：${result.rhymePlan ? result.rhymePlan.text : '（判不出）'}`);
  if (result.rhymeNote) log(`它的说法：${result.rhymeNote}`);
  if (result.voiceTip) log(`⚠ ${result.voiceTip}`);
  log(`立意：${result.insight || '（没写）'}`);
  log('');
  log('自检：');
  const fs2 = (result.diagnosis && result.diagnosis.findings) || [];
  if (!fs2.length) log('  （无）');
  for (const f of fs2) log(`  [${f.severity === 'warn' ? '宜改' : '提示'}] ${f.name}：${f.text}`);
  log('');
}

const file = '.test/self-loop-log.md';
await fs.promises.writeFile(file, out.join('\n') + '\n');
console.log(`\n已写入 ${file}`);
