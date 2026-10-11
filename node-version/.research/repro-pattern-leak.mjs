// 复现「正文里混入平仄谱」这个 bug
import { streamChat } from '../server/deepseek.mjs';
import { COMPOSE_SYSTEM_HEAD, COMPOSE_FORMAT, composePrompt } from '../server/prompt.mjs';
import { check } from '../server/validator.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  const t = await fs.readFile(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
  key = t.match(/DEEPSEEK_API_KEY:\s*(\S+)/)[1];
}

const scene = process.argv[2] || '夜行的末班车，车窗上都是雨，我在最后一排睡着了。';
const form = process.argv[3] || '七言律诗';

for (let k = 0; k < 3; k++) {
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
  const body = (raw.match(/<body>([\s\S]*?)<\/body>/)?.[1] || '').trim();
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  // 服务端的清洗（与 server.js 一致）
  const cleaned = lines
    .map((l) => l.replace(/[○◆◇□■●、，。；：！？—…「」『』（）\s]/g, ''))
    .map((l) => l.replace(/(平|仄|中|韵|句|读|豆|叶|换)$/g, ''))
    .map((l) => l.trim())
    .filter((l) => l.length);

  const patternOnly = cleaned.filter((l) => /^[平仄中]+$/.test(l));
  console.log(`\n#${k + 1} 原始 ${lines.length} 行 → 清洗后 ${cleaned.length} 行，其中纯平仄谱 ${patternOnly.length} 行`);
  cleaned.forEach((l, i) => {
    const isPat = /^[平仄中]+$/.test(l);
    console.log(`   ${String(i + 1).padStart(2)} ${isPat ? '【谱】' : '     '} ${l}`);
  });
  const v = check(form, cleaned);
  console.log(`   校律 ${v.level}：${v.issues.filter((i) => i.severity === 'error').map((i) => i.text).join('；') || '（无硬伤）'}`);
}
