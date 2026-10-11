// 云卷云舒 · 共享内核
//
// 择体、成诗、校律重写、自评润色——全部逻辑只写这一份，
// Node（server.js）与 Cloudflare Worker（worker.mjs）都调它，避免两边分叉。
//
// 平台差异只有两件事，由调用方注入：
//   write(text)  —— 往响应里写一段文本
//   close()      —— 结束响应
// 其余（fetch / ReadableStream / TextDecoder / AbortController）两边都是 Web 标准。

import {
  CHOOSE_SYSTEM,
  choosePrompt,
  COMPOSE_SYSTEM_HEAD,
  COMPOSE_FORMAT,
  composePrompt,
  REFINE_SYSTEM_HEAD,
  systemHead,
  REFINE_FORMAT,
  refinePrompt,
  SELF_CRITIQUE_SYSTEM,
  ALL_FORMS,
} from './prompt.mjs';
import { streamChat } from './deepseek.mjs';
import {
  check,
  checkDeclared,
  renormByMeter,
  renormByLens,
  isPatternLine,
  isLeakedProse,
  stripTrailingPattern,
  toFeedback,
} from './validator.mjs';
import { getTune } from './tunes.mjs';
import { getShi } from './shi.mjs';
import { layoutPoem, layoutTitle } from './format.mjs';
import { isVerifiedForm } from './prompt.mjs';
import { POET_NAMES } from './poets.mjs';
import { ALLUSIONS, allusionsCoverage, allusionNames } from './allusions.mjs';
import { diagnose, diseaseFeedback, fieldIssues, stripBadFields } from './disease.mjs';
import { rhymePlan, voiceAdvice } from './voice.mjs';

export const ALLUSION_IDS = new Set(ALLUSIONS.map((a) => a.id));

/**
 * 这一稿的韵脚字。词按词谱的韵位取，近体诗按偶句取。
 *
 * 词**只取第一个韵组**（主韵）：换韵与错叶的词牌（定风波、相见欢、清平乐、
 * 菩萨蛮、虞美人、鹊桥仙、西江月…）一片之内本就有几个韵组，各组可以各属一部，
 * 那是词牌的规矩，不是出韵。混在一起判「声情」与「出韵」，会把《定风波》
 * 错叶的仄韵冤判成出韵 —— 这是自出题循环实测踩到的第二个坑。
 * 逐组判出韵的活儿归 server/validator.mjs（它有 rhymeGroups 与 groupChars），
 * 这里只负责「主韵是哪一部、听起来什么调子」。
 */
export function rhymeCharsOf(form, lines) {
  const ls = Array.isArray(lines) ? lines : [];
  const last = (l) => [...String(l || '')].filter((c) => /[\u3400-\u9FFF]/.test(c)).slice(-1)[0];
  const tune = getTune(form);
  if (tune) {
    // rhymeGroups 里存的是**小句下标**（不是韵序）：如《浣溪沙》[[0,1,2,4,5]]，
    // 正是 rhymes===1 的那几句。所以直接按它取字，不要再套一层韵序换算
    // （自出题循环里踩到过：多套一层，《浣溪沙》就少取一个韵脚）。
    const groups = Array.isArray(tune.rhymeGroups) && tune.rhymeGroups.length ? tune.rhymeGroups : null;
    if (groups) {
      const picked = groups[0].map((i) => last(ls[i])).filter(Boolean);
      if (picked.length) return picked;
    }
    const out = [];
    for (let i = 0; i < ls.length && i < tune.rhymes.length; i++) {
      if (tune.rhymes[i] === 1) {
        const c = last(ls[i]);
        if (c) out.push(c);
      }
    }
    return out;
  }  if (getShi(form)) {
    const out = [];
    for (let i = 0; i < ls.length; i++) {
      if (i % 2 === 1) {
        const c = last(ls[i]);
        if (c) out.push(c);
      }
    }
    return out;
  }
  return [];
}

export const LIMITS = {
  SCENE_MAX: 1000,
  WISH_MAX: 400,
  // 4 次不够。站长说「平仄八处出入太过分」—— 实测长调（定风波、沁园春这些）
  // 一遍下来常剩七八处，多给一次专门做「只换那几个字」的修补，能收敛到两三处。
  MAX_TRIES: 5,
  TEMPERATURE: 1.15,
  RETRY_TEMPERATURE: 1.0,
  SETTLE_TEMPERATURE: 0.95,
  IDLE_TIMEOUT_MS: 90_000,
};

// 供两个平台入口显示已核验体裁数
export { ALL_FORMS };

/** 某体裁每句应有字数（近体诗与词牌都能给出；未核验的返回 null） */
export function expectedLens(form) {
  const t = getTune(form);
  if (t) return t.lens;
  const spec = getShi(form);
  if (spec) return Array.from({ length: spec.couplets * 2 }, () => spec.size);
  return null;
}

/** 清洗用户输入：去掉控制字符与尖括号（防提示注入），限长 */
export function clean(v, max) {
  return String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[<>]/g, ' ')
    .trim()
    .slice(0, max);
}

/** 标签流收集器：把模型输出按 <tag>…</tag> 收进字段 */
// 白名单。**新加标签一定要加到这里** —— 否则模型写了也会被静默丢掉
// （notes / translation 就被这么丢过一次）。
const TAGS = [
  'choice', 'reason', 'scene', 'rhyme', 'realm', 'eye', 'insight', 'title', 'allusion', 'devices', 'change', 'meter',
  'body', 'notes', 'translation', 'appraisal',
];
export function makeTagCollector() {
  let buf = '';
  const fields = {};
  let current = null;
  const isTagChar = (c) => /[a-z]/.test(c);
  return {
    fields,
    feed(chunk) {
      buf += chunk;
      for (;;) {
        const lt = buf.indexOf('<');
        if (lt < 0) {
          if (current) fields[current] = (fields[current] || '') + buf;
          buf = '';
          break;
        }
        if (lt > 0) {
          if (current) fields[current] = (fields[current] || '') + buf.slice(0, lt);
          buf = buf.slice(lt);
        }
        const close = buf.indexOf('>');
        if (close < 0) {
          if (buf.length > 12) {
            if (current) fields[current] = (fields[current] || '') + buf;
            buf = '';
          }
          break;
        }
        const inner = buf.slice(1, close);
        buf = buf.slice(close + 1);
        if (inner.startsWith('/')) current = null;
        else if (TAGS.includes(inner)) {
          current = inner;
          if (fields[current] === undefined) fields[current] = '';
        } else if (!isTagChar(inner[0] || '')) {
          if (current) fields[current] = (fields[current] || '') + '<' + inner + '>';
        }
      }
      return fields;
    },
  };
}

/** 把 <body> 的原始文本整理成一句一行的正文（剔谱、剔提示词泄漏、剔记号） */
export function cleanBody(rawBody) {
  const cleaned = String(rawBody || '')
    .split('\n')
    .map((l) => stripTrailingPattern(l))
    .map((l) => l.replace(/[○◆◇□■●、，。；：！？—…「」『』（）\s]/g, ''))
    .map((l) => l.replace(/(平|仄|中|韵|句|读|豆|叶|换)$/g, ''))
    .map((l) => l.trim())
    .filter((l) => l.length);
  const patternLeak = cleaned.filter((l) => isPatternLine(l)).length;
  const bodyLines = cleaned.filter((l) => !isPatternLine(l)).filter((l) => !isLeakedProse(l));
  return { bodyLines, patternLeak };
}

/** 按句式把正文切正（并句、多字都能修；真的少字则 exact=false） */
export function fixLines(form, verified, meter, bodyLines) {
  if (verified) {
    const want = expectedLens(form);
    if (want) {
      const r = renormByLens(bodyLines, want);
      if (r && r.exact) return { lines: r.lines, fixed: JSON.stringify(r.lines) !== JSON.stringify(bodyLines) };
    }
  } else if (meter) {
    const r = renormByMeter(bodyLines, meter);
    if (r && r.exact) return { lines: r.lines, fixed: true };
  }
  return { lines: bodyLines, fixed: false };
}

/**
 * 建一个「收 NDJSON 事件」的流式响应工具。
 * @param {{write:(s:string)=>void, close:()=>void}} io
 */
export function makeEmitter(io) {
  const send = (obj) => io.write(JSON.stringify(obj) + '\n');
  return {
    send,
    status: (hint) => send({ type: 'status', hint }),
    error: (message) => send({ type: 'error', message }),
  };
}

/* ============================================================
 * /api/choose —— 由场景择体，并挑一条相扣的典故
 * ============================================================ */
export async function choose({ payload, config, signal, io }) {
  const { apiKey, model, endpoint } = config;
  const scene = clean(payload.scene, LIMITS.SCENE_MAX);
  const wish = clean(payload.wish, LIMITS.WISH_MAX);
  const poetRaw = clean(payload.poet, 12);
  const poet = POET_NAMES.includes(poetRaw) ? poetRaw : '';

  if (scene.length < 2) return { status: 400, json: { error: '再写一点点吧，一两个词也好' } };

  const upstream = makeUpstream(signal);
  const bump = makeBump(upstream);
  try {
    const text = await callModel({
      apiKey,
      model,
      endpoint,
      signal: upstream.signal,
      bump,
      messages: [
        { role: 'system', content: CHOOSE_SYSTEM },
        { role: 'user', content: choosePrompt(scene, wish, poet) },
      ],
    });
    const form = (text.match(/<choice>([\s\S]*?)<\/choice>/)?.[1] || '').trim().replace(/[《》\s]/g, '');
    const reason = (text.match(/<reason>([\s\S]*?)<\/reason>/)?.[1] || '').trim();
    const alloRaw = (text.match(/<allusions>([\s\S]*?)<\/allusions>/)?.[1] || '').trim();
    const allusions = alloRaw
      .split(/[^A-Za-z0-9_-]+/)
      .map((s) => s.trim())
      .filter((s) => s && ALLUSION_IDS.has(s))
      .slice(0, 1);
    const ok = ALL_FORMS.includes(form);
    return {
      status: 200,
      json: ok
        ? { form, reason, allusions }
        : { form: '五言绝句', reason: reason || '择体未成，暂用五言绝句。', allusions, fallback: true },
    };
  } catch (err) {
    return { status: 500, json: { error: '择体时出了岔子：' + (err?.message || err) } };
  } finally {
    bump.stop();
  }
}

/* ============================================================
 * /api/compose —— 成诗 / 润色（流式）
 * ============================================================ */
export async function compose({ payload, config, signal, io }) {
  const { apiKey, model, endpoint } = config;
  const scene = clean(payload.scene, LIMITS.SCENE_MAX);
  const form = clean(payload.form, 24).replace(/[《》]/g, '');
  const wish = clean(payload.wish, LIMITS.WISH_MAX);
  const mode = payload.mode === 'refine' ? 'refine' : 'compose';
  const poetRaw = clean(payload.poet, 12);
  const poet = POET_NAMES.includes(poetRaw) ? poetRaw : '';
  const allusionIds = (Array.isArray(payload.allusions) ? payload.allusions : [])
    .map((s) => String(s).trim())
    .filter((s) => ALLUSION_IDS.has(s))
    .slice(0, 1);

  if (!form) return { status: 400, json: { error: '请先择定体裁' } };
  if (mode === 'refine' && !wish) return { status: 400, json: { error: '请先写下你的新要求' } };

  const verified = isVerifiedForm(form);
  const prev = payload.previous && typeof payload.previous === 'object' ? payload.previous : null;
  const { send, status, error } = makeEmitter(io);

  const upstream = makeUpstream(signal);
  const bump = makeBump(upstream);
  // 走 systemHead()：CIHUA_OFF=1 时它会去掉《人间词话》那一批（对照实验用）
    const head = systemHead(mode);
  const format = mode === 'refine' ? REFINE_FORMAT : COMPOSE_FORMAT;

  try {
    send({ type: 'start', model, form, mode });

    let best = null;
    let lastProblem = '';
    let tries = 0;

    for (let attempt = 0; attempt < LIMITS.MAX_TRIES; attempt++) {
      tries = attempt + 1;
      const userPrompt =
        mode === 'refine'
          ? refinePrompt(form, scene, wish, prev || { body: '' }, lastProblem, poet, allusionIds)
          : composePrompt(form, scene, wish, lastProblem, attempt > 0 ? best?.raw : null, poet, allusionIds);

      const raw = await callModel({
        apiKey,
        model,
        endpoint,
        signal: upstream.signal,
        bump,
        // 温度阶梯：头一稿放开（1.15），改写一律**收着**（1.0 → 0.95）。
        // 上一版我让第二稿升到 1.3「逼它换句子」，结果实测跑了两次：
        // 一稿就成的诗没问题，用到第二稿的那两首，注释与白话翻译直接写成了乱码，
        // 还漏出模型自己的特殊标记（OPEN_END|>）。高温换来的是散，不是变。
        temperature: attempt === 0 ? LIMITS.TEMPERATURE : attempt === 1 ? LIMITS.RETRY_TEMPERATURE : LIMITS.SETTLE_TEMPERATURE,
        messages: [
          { role: 'system', content: head + '\n\n' + format },
          { role: 'user', content: userPrompt },
        ],
      });

      const col = makeTagCollector();
      col.feed(raw);
      const f = col.fields;
      const { bodyLines, patternLeak } = cleanBody(f.body);
      const meter = (f.meter || '').trim();
      const { lines: judged } = fixLines(form, verified, meter, bodyLines);
      const verdict = verified ? check(form, judged) : checkDeclared(form, judged, meter);

      const hard = verdict.issues.some((i) => i.severity === 'error');
      const toneMiss = verdict.stats.平仄出入 || 0;

      // 诗病自检：格律之外的那一层。只有「宜改」进分数（每条压 4 分，比平仄一处略重），
      // 「提示」只展示、不参与取舍 —— 词表判定的东西不能拿来退稿。
      const dis = diagnose({
        form,
        bodyLines: judged,
        fields: f,
        // 本次真正递到模型眼前的典故名 —— 用来核它自报的出处是不是编的
        allusionMenu: allusionNames(scene, 8, allusionIds),
        rhymeChars: rhymeCharsOf(form, judged),
        scene, // 原样的场景也交给自检：尺度、身份、情绪、器物四堵墙靠它比
      });
      // 注释/翻译这一层单独查（站长截过两次图）：坏掉的权重比诗病高，
      // 因为它不是「写得不够好」，是这一栏根本不能用。
      const fIss = fieldIssues(f, judged);
      const disWarn = dis.findings.filter((x) => x.severity === 'warn').length;
      // 声情与立意不搭时也提示（只是提示，不动分数：古人反用韵部的地方多着呢）
      const voiceTip = voiceAdvice(rhymeCharsOf(form, judged), (f.insight || '') + (f.scene || ''), getTune(form) ? '词林正韵' : '平水韵');
      const score = (hard ? 1000 : 0) + toneMiss + patternLeak * 50 + disWarn * 4 + fIss.length * 6;

      const result = { fields: f, raw, bodyLines: judged, verdict, meter, score, diagnosis: dis, voiceTip };
      if (!best || score < best.score) best = result;
      // 收到什么程度算成？「平仄出入」留 1~2 处是常事（多音字、可平可仄的活用），
      // 但站长说八处出入「太过分」，所以门槛从 3 收到 2；差在这一两处时
      // 上面的提示语会换成「只换那几个字」的改法，不会把已经对的地方又改坏。
      if (!hard && toneMiss <= 2 && !patternLeak && disWarn === 0 && fIss.length === 0) break;

      lastProblem = [
        toFeedback(verdict),
        diseaseFeedback(dis),
        fIss.length ? '【注释与白话翻译这一层不能用，请重写这两栏】\n' + fIss.map((x) => '- ' + x.text).join('\n') : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      status(
        patternLeak
          ? '正文里混进了平仄谱，正在重写……'
          : hard
            ? '句数或字数还没对齐，正在重写……'
            : `平仄还有 ${toneMiss} 处未合，正在重写……`
      );
    }

    /* ---- 自评 → 润色 ---- */
    let finalPick = best;
    let critique = '';
    let revisedNote = '';
    let revisionApplied = false;
    let critiqueOn = '';

    if (best && best.bodyLines.length) {
      critiqueOn = best.bodyLines.join('\n');
      try {
        const critRaw = await callModel({
          apiKey,
          model,
          endpoint,
          signal: upstream.signal,
          bump,
          temperature: 1.0,
          messages: [
            { role: 'system', content: SELF_CRITIQUE_SYSTEM },
            {
              role: 'user',
              content:
                `【场景】\n${scene}\n\n【体裁】《${form}》\n\n` +
                `【已成之稿】\n${best.bodyLines.join('\n')}\n\n` +
                `【取景自述】${(best.fields.scene || '').trim()}\n` +
                `【用典自述】${(best.fields.allusion || '').trim()}\n\n请审这一稿。`,
            },
          ],
        });
        critique = (critRaw.match(/<critique>([\s\S]*?)<\/critique>/)?.[1] || '').trim();
        revisedNote = (critRaw.match(/<revise>([\s\S]*?)<\/revise>/)?.[1] || '').trim();
      } catch {
        /* 自评失败不影响出诗 */
      }

      const noNeed = !critique || /无可指摘/.test(critique) || /不必改/.test(revisedNote);
      if (critique && !noNeed) {
        status('它自己看出了问题，正在改……');
        // 若它自己指出的病很重（套语、拼贴、与场景无关），宁可让平仄多些出入也要换掉那一稿。
        const severe = /套语|陈套|拼贴|割裂|悬浮|通用|配方|抽掉|搬来|凑韵|与.{0,6}无关|不是.{0,4}看见|毫发无伤/.test(
          critique
        );
        const slack = severe ? 6 : 2;
        for (let attempt = 0; attempt < 2; attempt++) {
          const raw2 = await callModel({
            apiKey,
            model,
            endpoint,
            signal: upstream.signal,
            bump,
            temperature: attempt === 0 ? 1.15 : 1.25,
            messages: [
              { role: 'system', content: head + '\n\n' + format },
              {
                role: 'user',
                content:
                  (mode === 'refine'
                    ? refinePrompt(form, scene, wish, prev || { body: '' }, lastProblem, poet, allusionIds)
                    : composePrompt(form, scene, wish, lastProblem, { body: best.bodyLines.join('\n') }, poet, allusionIds)) +
                  `\n\n【你上一稿的问题（这是你自己的评语，务必改掉）】\n${critique}\n` +
                  `【改的方向】${revisedNote}\n\n` +
                  `请照这个评语重写全篇。要注意：**要改的是「看见了什么」，不是「换几个更好看的词」**。\n` +
                  `先把场景里真实存在的物象一件件列出来（哪个人、哪只手、哪件东西、什么声音），\n` +
                  `凡是评语指出「与场景无关」「像通用配方」的句子，整句删掉，换成你真正看见的那样东西。\n` +
                  `不要为了对仗而保留任何一个悬浮的意象。格律仍须逐字守住。`,
              },
            ],
          });
          const col2 = makeTagCollector();
          col2.feed(raw2);
          const f2 = col2.fields;
          const { bodyLines: b2 } = cleanBody(f2.body);
          const meter2 = (f2.meter || '').trim();
          const { lines: judged2 } = fixLines(form, verified, meter2, b2);
          const v2 = verified ? check(form, judged2) : checkDeclared(form, judged2, meter2);
          const hard2 = v2.issues.some((i) => i.severity === 'error');
          const tone2 = v2.stats.平仄出入 || 0;
          const score2 = (hard2 ? 1000 : 0) + tone2;
          if (!hard2 && score2 <= best.score + slack) {
            finalPick = { fields: f2, raw: raw2, bodyLines: judged2, verdict: v2, score: score2, meter: meter2 };
            revisionApplied = true;
            break;
          }
        }
      }
    }

    if (!finalPick || !finalPick.bodyLines.length) {
      error('这次没有落下一个字，可重新落笔');
      return { status: 200, streamed: true, ok: false };
    }

    const f = finalPick.fields;
    // 出口把关：注释/翻译坏掉就清空，并在 droppedFields 里说明白
    const safe = stripBadFields(finalPick.fields, finalPick.bodyLines);
    const droppedFields = safe.dropped;

    send({
      type: 'result',
      scene: (f.scene || '').trim(),
      // 立意：诗的末句要透出一层想头（站长要的「哲思」）。这一条既是对模型的要求，
      // 也是给站长核对的地方 —— 说清那一层想头落在哪一句、由哪一处景生出。
      insight: (f.insight || '').trim(),
      // 选韵：模型自报的声情与韵部（左栏与「声情」并列，好核对）
      rhymeNote: (f.rhyme || '').trim(),
      // 服务端算出来的：这一首究竟落在哪个韵部、听起来什么调子
      rhymePlan:
        (finalPick.diagnosis && finalPick.diagnosis.plan) ||
        rhymePlan(rhymeCharsOf(form, finalPick.bodyLines), getTune(form) ? '词林正韵' : '平水韵'),
      // 声情与立意不搭时的提醒（可能为空）
      voiceTip: finalPick.voiceTip || '',
      // 境界（《人间词话》）：有我之境 / 无我之境 —— 服务端算的，摆在左栏给站长看。我的
      //      也让它自报一份（<realm>），两者一比就知道它心里想写的是哪一种。
      realm: (finalPick.diagnosis && finalPick.diagnosis.realm) || null,
      realmNote: (f.realm || '').trim(),
      // 一字境界全出：它自己指认的那一个字（单独立字段，免得漏）
      eye: (f.eye || '').trim(),
      // 诗病自检：格律之外那一层。「宜改」会退回重写，「提示」只是摊给你看
      diagnosis: finalPick.diagnosis || { level: 'ok', findings: [], stats: {} },
      // 词作「词牌·题」，诗只用题 —— 见 server/format.mjs
      title: layoutTitle(form, f.title),
      allusion: (f.allusion || '').trim(),
      devices: (f.devices || '').trim(),
      change: (f.change || '').trim(),
      meter: finalPick.meter || '',
      // body 仍是「一句一行」的原稿（校律用的就是它）；
      // lines 是按**句读**排好的展示版 —— 哪几个小句合成一句、一行排几个字，
      // 只有服务端知道，见 server/format.mjs（标点表在 server/tunes.mjs 的 MARKS）
      body: finalPick.bodyLines.join('\n'),
      lines: layoutPoem(form, finalPick.bodyLines),
      // 注释与翻译：出口前再清一道 —— 坏掉就空着，并在 droppedFields 里说明,
      notes: (safe.notes || '').trim(),
      translation: (safe.translation || '').trim(),
      droppedFields,
      appraisal: (f.appraisal || '').trim(),
      selfCritique: critique && !/无可指摘/.test(critique) ? critique : '',
      reviseNote: revisedNote && !/不必改/.test(revisedNote) ? revisedNote : '',
      revised: revisionApplied,
      revisedFrom: revisionApplied ? critiqueOn : '',
      form,
      verified,
      poet,
      tries,
      verdict: finalPick.verdict,
    });
    return { status: 200, streamed: true, ok: true, form, lines: finalPick.bodyLines.length };
  } catch (err) {
    error(signal?.aborted ? '上游超时或已断开，可重新落笔' : '写作时出了岔子：' + (err?.message || err));
    return { status: 200, streamed: true, ok: false };
  } finally {
    bump.stop();
  }
}

/* ---------------- 内部小工具 ---------------- */

/**
 * 空闲超时看门狗：上游久无动静就中断它，避免一个卡住的请求把连接吊死。
 * 每次收到内容调用一次（它就是函数本身），结束调用 .stop()。
 * @param {AbortController} upstream
 */
function makeBump(upstream) {
  let timer = null;
  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        upstream.abort();
      } catch {
        /* 已中止 */
      }
    }, LIMITS.IDLE_TIMEOUT_MS);
  };
  reset();
  return Object.assign(reset, {
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  });
}

async function callModel({ apiKey, model, endpoint, messages, signal, temperature = LIMITS.TEMPERATURE, bump }) {
  let text = '';
  for await (const piece of streamChat({ apiKey, model, endpoint, messages, signal, temperature })) {
    if (bump) bump();
    text += piece;
  }
  return text;
}

/** /api/health —— 前端靠它拿体裁、诗人、典故与韵书状态 */
export function health({ model, keyReady, rhymeBook, pingShui, tuneNames, shiNames, poetNames, allusions }) {
  return {
    ok: true,
    model,
    keyReady,
    forms: [...shiNames, ...tuneNames],
    tunes: tuneNames,
    shi: shiNames,
    poets: poetNames,
    allusions: allusions || allusionsCoverage(),
    rhymeBook,
    pingShui,
  };
}

/** 创建一个受空闲超时与外部中止双重控制的 AbortController */
export function makeUpstream(externalSignal) {
  const ctrl = new AbortController();
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl;
}
