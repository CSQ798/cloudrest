// 实测：模型在拿到明确平仄谱与骨架后，能否写出严格合律的作品
import { streamChat } from '../server/deepseek.mjs';
import { COMPOSE_SYSTEM_HEAD, COMPOSE_FORMAT, patternBrief, composePrompt } from '../server/prompt.mjs';
import { check } from '../server/validator.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  const t = await fs.readFile(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
  key = t.match(/DEEPSEEK_API_KEY:\s*(\S+)/)[1];
}

const scene = process.argv[2] || '深夜的医院走廊，长椅上有人抱着外套睡着了，输液管在暗处轻轻晃。';
const form = process.argv[3] || '浣溪沙';
const N = Number(process.argv[4] || 3);

function parse(text) {
  const get = (t) => text.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim() || '';
  return { body: get('body'), title: get('title'), devices: get('devices') };
}

let bestTone = 99;
for (let i = 0; i < N; i++) {
  let raw = '';
  for await (const p of streamChat({
    apiKey: key,
    messages: [
      { role: 'system', content: COMPOSE_SYSTEM_HEAD + '\n\n' + COMPOSE_FORMAT },
      { role: 'user', content: composePrompt(form, scene, '', '', null) },
    ],
    temperature: 1.15,
  })) {
    raw += p;
  }
  const f = parse(raw);
  const lines = f.body.split('\n').map((l) => l.trim()).filter(Boolean);
  const v = check(form, lines);
  const tones = v.stats.平仄出入 ?? '-';
  if (typeof tones === 'number' && tones < bestTone) bestTone = tones;
  console.log(`\n#${i + 1} 〔${f.title}〕 level=${v.level} 句数=${lines.length} 平仄出入=${tones}`);
  console.log('   ' + lines.join(' / '));
  const lens = lines.map((l) => [...l].filter((c) => /[\u4e00-\u9fff]/.test(c)).length);
  console.log('   句长 ' + lens.join('/'));
  for (const issue of v.issues) console.log(`   ${issue.severity === 'error' ? '✗' : '·'} ${issue.text}`);
  if (typeof tones === 'number' && tones === 0) {
    console.log('\n✓ 出现严格合律的一稿');
    break;
  }
}
console.log(`\n${form} 最佳平仄出入：${bestTone === 99 ? '（未能评估）' : bestTone}`);
