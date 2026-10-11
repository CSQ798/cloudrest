// 云卷云舒 · 数据层
//
// 一份接口，两个实现：
//   createD1Store(db)      —— 线上用。Cloudflare D1（SQLite），跨实例、跨请求都在。
//   createMemoryStore()    —— 测试与本地用。纯内存，快，但**重启就没了**。
//   server/store-file.mjs  —— 本地持久化：内存实现 + 落一个 JSON 文件（只有 Node 用它）
//
// 为什么额度一定要落库：Workers 是无状态的，同一个用户的下一次请求可能落到
// 另一个实例上，内存里的计数下一秒就没了。所以免费次数与充值余额都必须在
// 一条 SQL 里原子地改，靠 `UPDATE ... WHERE <还有额度>` 的 affected rows
// 判断有没有扣成功 —— 这样并发请求也不会超发。
//
// 这个文件会被打进 Worker bundle，所以**不能**出现任何 node: 导入。
import { SCHEMA } from './schema.mjs';

export const FREE_LIMIT = 5; // 每个注册用户的免费次数

/* ============================================================
 * D1 实现
 * ============================================================ */
export function createD1Store(db) {
  const q = (sql, ...args) => db.prepare(sql).bind(...args);

  // 表结构只建一次，之后每个请求都是免费的白读一遍这个 promise。
  // 见 server/schema.mjs 开头的说明：这一步是为了免掉「手动去 Console 粘 SQL」。
  let schemaReady = null;
  let schemaError = '';

  return {
    persistent: true,
    kind: 'd1',

    /** 幂等建表。失败不抛给调用方，而是记下来，由 /api/health 如实报告。 */
    async ensureSchema() {
      if (schemaReady) return schemaReady;
      schemaReady = (async () => {
        for (const sql of SCHEMA) {
          await db.prepare(sql).run();
        }
        return true;
      })().catch((e) => {
        schemaError = String(e?.message || e);
        schemaReady = null; // 下次再试（也许只是这一瞬间的网络问题）
        return false;
      });
      return schemaReady;
    },
    schemaError: () => schemaError,

    async getUserByEmail(email) {
      return (await q('SELECT * FROM users WHERE email = ?', email).first()) || null;
    },
    async getUserById(id) {
      return (await q('SELECT * FROM users WHERE id = ?', id).first()) || null;
    },
    async createUser({ email, hash, salt }) {
      const r = await q('INSERT INTO users (email, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?)', email, hash, salt, Date.now()).run();
      return { id: r.meta.last_row_id, email, free_used: 0, credits: 0 };
    },

    /**
     * 扣一次。先试免费额度，再试余额。
     * 两条 UPDATE 都带 WHERE 条件，靠 affected rows 判断是否真的扣到了 ——
     * 这样并发下也不会把 5 次用成 6 次。
     * @returns {'free'|'credits'|null} null 表示额度用尽
     */
    async spendOne(userId) {
      const free = await q('UPDATE users SET free_used = free_used + 1 WHERE id = ? AND free_used < ?', userId, FREE_LIMIT).run();
      if (free.meta.changes === 1) return 'free';
      const paid = await q('UPDATE users SET credits = credits - 1 WHERE id = ? AND credits > 0', userId).run();
      if (paid.meta.changes === 1) return 'credits';
      return null;
    },

    /** 这一稿没生成成功就把次数还回去 */
    async refundOne(userId, kind) {
      if (kind === 'free') await q('UPDATE users SET free_used = CASE WHEN free_used > 0 THEN free_used - 1 ELSE 0 END WHERE id = ?', userId).run();
      else if (kind === 'credits') await q('UPDATE users SET credits = credits + 1 WHERE id = ?', userId).run();
    },

    async addCredits(userId, n) {
      await q('UPDATE users SET credits = credits + ? WHERE id = ?', n, userId).run();
      const u = await this.getUserById(userId);
      return u ? u.credits : 0;
    },

    async logUsage(userId, kind, form) {
      await q('INSERT INTO usage_log (user_id, at, kind, form) VALUES (?, ?, ?, ?)', userId, Date.now(), kind, form || null).run();
    },
    async listUsage(userId, limit = 20) {
      return (await q('SELECT at, kind, form, refunded FROM usage_log WHERE user_id = ? ORDER BY at DESC LIMIT ?', userId, limit).all()).results || [];
    },

    async createClaim(userId, note) {
      const r = await q('INSERT INTO claims (user_id, at, note, status) VALUES (?, ?, ?, ?)', userId, Date.now(), note || null, 'pending').run();
      return r.meta.last_row_id;
    },
    async listClaims(status = 'pending') {
      return (
        await q(
          `SELECT c.*, u.email FROM claims c JOIN users u ON u.id = c.user_id
            WHERE c.status = ? ORDER BY c.at ASC LIMIT 200`,
          status
        ).all()
      ).results || [];
    },
    async decideClaim(id, approve, credits) {
      const r = await q('UPDATE claims SET status = ?, decided_at = ?, credits = ? WHERE id = ? AND status = ?', approve ? 'approved' : 'rejected', Date.now(), approve ? credits : 0, id, 'pending').run();
      if (r.meta.changes !== 1) return null;
      const row = await q('SELECT user_id FROM claims WHERE id = ?', id).first();
      if (approve && row) await this.addCredits(row.user_id, credits);
      return row ? row.user_id : null;
    },

    async createCodes(list) {
      for (const c of list) {
        await q('INSERT INTO redeem_codes (code, credits, created_at, note) VALUES (?, ?, ?, ?)', c.code, c.credits, Date.now(), c.note || null).run();
      }
      return list.length;
    },
    async redeem(code, userId) {
      // 原子占位：只有 used_by 为空时才写得进去，两个人同时兑换同一码只会有一个成功
      const r = await q('UPDATE redeem_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL', userId, Date.now(), code).run();
      if (r.meta.changes !== 1) {
        const row = await q('SELECT used_by FROM redeem_codes WHERE code = ?', code).first();
        return row ? { ok: false, reason: '这个兑换码已经被用过了' } : { ok: false, reason: '没有这个兑换码' };
      }
      const row = await q('SELECT credits FROM redeem_codes WHERE code = ?', code).first();
      const credits = row ? row.credits : 0;
      const balance = await this.addCredits(userId, credits);
      return { ok: true, credits, balance };
    },
    async listCodes(limit = 50) {
      return (await q('SELECT code, credits, created_at, used_by, used_at, note FROM redeem_codes ORDER BY created_at DESC LIMIT ?', limit).all()).results || [];
    },

    /** 滑动窗口限流：窗口内超过 max 次就不放行 */
    async bumpTry(table, ip, { max, windowMs }) {
      const now = Date.now();
      const row = await q(`SELECT at, n FROM ${table} WHERE ip = ?`, ip).first();
      if (!row || now - row.at > windowMs) {
        await q(`INSERT INTO ${table} (ip, at, n) VALUES (?, ?, 1) ON CONFLICT(ip) DO UPDATE SET at = ?, n = 1`, ip, now, now).run();
        return { allowed: true, left: max - 1 };
      }
      if (row.n >= max) return { allowed: false, left: 0 };
      await q(`UPDATE ${table} SET n = n + 1 WHERE ip = ?`, ip).run();
      return { allowed: true, left: max - row.n - 1 };
    },
  };
}

/* ============================================================
 * 内存实现（测试 / 本地）
 *
 * 语义刻意与 D1 版逐条对齐 —— 本地测通了，线上才敢说同一句话。
 * snapshot / restore 是给 store-file.mjs 做持久化用的。
 * ============================================================ */
export function createMemoryStore(seed = null) {
  const s = seed || { users: [], usage: [], claims: [], codes: [], tries: {} };
  let nextUser = s.users.reduce((m, u) => Math.max(m, u.id), 0) + 1;
  let nextClaim = s.claims.reduce((m, c) => Math.max(m, c.id), 0) + 1;

  const store = {
    persistent: true,
    kind: 'memory',
    async ensureSchema() {
      return true; // 内存实现没有表要建
    },
    schemaError: () => '',

    async getUserByEmail(email) {
      return s.users.find((u) => u.email === email) || null;
    },
    async getUserById(id) {
      return s.users.find((u) => u.id === id) || null;
    },
    async createUser({ email, hash, salt }) {
      if (s.users.some((u) => u.email === email)) {
        const e = new Error('duplicate');
        e.code = 'DUPLICATE';
        throw e;
      }
      const u = { id: nextUser++, email, pw_hash: hash, pw_salt: salt, created_at: Date.now(), free_used: 0, credits: 0 };
      s.users.push(u);
      return u;
    },

    async spendOne(userId) {
      const u = s.users.find((x) => x.id === userId);
      if (!u) return null;
      if (u.free_used < FREE_LIMIT) {
        u.free_used++;
        return 'free';
      }
      if (u.credits > 0) {
        u.credits--;
        return 'credits';
      }
      return null;
    },
    async refundOne(userId, kind) {
      const u = s.users.find((x) => x.id === userId);
      if (!u) return;
      if (kind === 'free') u.free_used = Math.max(0, u.free_used - 1);
      else if (kind === 'credits') u.credits++;
    },
    async addCredits(userId, n) {
      const u = s.users.find((x) => x.id === userId);
      if (!u) return 0;
      u.credits += n;
      return u.credits;
    },

    async logUsage(userId, kind, form) {
      s.usage.push({ user_id: userId, at: Date.now(), kind, form: form || null, refunded: 0 });
    },
    async listUsage(userId, limit = 20) {
      return s.usage.filter((x) => x.user_id === userId).sort((a, b) => b.at - a.at).slice(0, limit);
    },

    async createClaim(userId, note) {
      const id = nextClaim++;
      s.claims.push({ id, user_id: userId, at: Date.now(), note: note || null, status: 'pending', decided_at: null, credits: null });
      return id;
    },
    async listClaims(status = 'pending') {
      return s.claims
        .filter((c) => c.status === status)
        .sort((a, b) => a.at - b.at)
        .slice(0, 200)
        .map((c) => ({ ...c, email: (s.users.find((u) => u.id === c.user_id) || {}).email || '(已注销)' }));
    },
    async decideClaim(id, approve, credits) {
      const c = s.claims.find((x) => x.id === id && x.status === 'pending');
      if (!c) return null;
      c.status = approve ? 'approved' : 'rejected';
      c.decided_at = Date.now();
      c.credits = approve ? credits : 0;
      if (approve) await store.addCredits(c.user_id, credits);
      return c.user_id;
    },

    async createCodes(list) {
      for (const c of list) s.codes.push({ code: c.code, credits: c.credits, created_at: Date.now(), used_by: null, used_at: null, note: c.note || null });
      return list.length;
    },
    async redeem(code, userId) {
      const c = s.codes.find((x) => x.code === code);
      if (!c) return { ok: false, reason: '没有这个兑换码' };
      if (c.used_by != null) return { ok: false, reason: '这个兑换码已经被用过了' };
      c.used_by = userId;
      c.used_at = Date.now();
      const balance = await store.addCredits(userId, c.credits);
      return { ok: true, credits: c.credits, balance };
    },
    async listCodes(limit = 50) {
      return s.codes.slice(-limit).reverse();
    },

    async bumpTry(table, ip, { max, windowMs }) {
      const now = Date.now();
      const k = table + '|' + ip;
      const row = s.tries[k];
      if (!row || now - row.at > windowMs) {
        s.tries[k] = { at: now, n: 1 };
        return { allowed: true, left: max - 1 };
      }
      if (row.n >= max) return { allowed: false, left: 0 };
      row.n++;
      return { allowed: true, left: max - row.n };
    },

    snapshot() {
      return JSON.parse(JSON.stringify(s));
    },
  };
  return store;
}
