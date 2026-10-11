# 栖云 · 部署说明

> 写下你的场景，它自己挑体裁。
> 一个零依赖的 Node 服务：左边是它怎么想的，中间是诗，右边是你提要求的地方。

## 一、跑起来

需要 **Node 18 以上**（本包在 Node 22 上开发并测试）。

```bash
cd qiyun
node server.js
```

浏览器打开 **http://127.0.0.1:7788** 即可。

不需要 `npm install`——整个项目**没有任何第三方依赖**，只用 Node 内置模块。

## 二、配置 API Key（必做）

诗由 DeepSeek 大模型生成，必须先给它一把钥匙。

1. 到 https://platform.deepseek.com 申请一个 API Key；
2. 把本目录下的 `.env.example` 复制为 `.env`；
3. 把里面的 `sk-请换成你自己的密钥` 换成你的真 key；
4. 重新启动 `node server.js`。

服务端按这个顺序找钥匙，任选其一即可：

| 顺序 | 位置 |
| --- | --- |
| 1 | 环境变量 `DEEPSEEK_API_KEY` |
| 2 | 本目录下的 `.env` 文件 |
| 3 | `~/.dsh/.credentials.yaml` |

**密钥只留在服务端，浏览器全程接触不到它。**

### 可选配置

在 `.env` 里可以一并设置：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `7788` | 端口 |
| `HOST` | `127.0.0.1` | 仅本机可访问；要让局域网或公网访问，设成 `0.0.0.0` |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名 |
| `DEEPSEEK_ENDPOINT` | `https://api.deepseek.com/chat/completions` | 可换任何 OpenAI 兼容接口 |

## 三、放到服务器上

### 直接跑

```bash
HOST=0.0.0.0 PORT=7788 DEEPSEEK_API_KEY=sk-xxxx node server.js
```

### 用 Nginx 挡在前面（推荐）

```nginx
server {
    listen 80;
    server_name your.domain.com;

    location / {
        proxy_pass http://127.0.0.1:7788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # 流式返回必须关掉缓冲，否则诗会等全部写完才出现
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

> `proxy_buffering off;` 这一行很要紧。这个站是**流式**出诗的，开着缓冲就看不到逐句浮现。

### 常驻运行

用 `pm2`、`systemd` 或 Windows 的任务计划都行，例如 systemd：

```ini
[Unit]
Description=qiyun
After=network.target

[Service]
WorkingDirectory=/opt/qiyun
ExecStart=/usr/bin/node server.js
Environment=HOST=127.0.0.1
Environment=PORT=7788
EnvironmentFile=/opt/qiyun/.env
Restart=always

[Install]
WantedBy=multi-user.target
```

## 四、这个站在做什么

一次「落笔」走三步：

1. **择体**——先读你的场景，从 30 种已核验体裁（4 种近体诗 + 26 个词牌）里挑一个最合式的，说明理由；
   同时从 164 条典故里挑一条真正相扣的。
2. **成诗**——把该体裁的句式骨架、逐句平仄、韵位一并交给模型；写完立刻校律，
   不合就带着「具体到某字某句」的错误重写，最多 6 遍。
3. **润色**——成稿之后再当一次苛刻的评家，只挑真问题，据此重写一稿。
   左栏会把「它对自己上一稿的批评」和那一稿一并给你，好让你对照它改了什么。

### 它能校什么，不能校什么

**严格校**（来自《钦定词谱》词谱正文，可机械判定）：

- 句数、每句字数、分片
- 逐字平仄（词牌与近体诗都有谱）
- 韵脚是否同韵（《词林正韵》《平水韵》）
- 近体诗：偶句必押平声，律诗中间两联的对仗硬伤

**只能提示**：

- 词的换韵结构（部分词牌的韵位是从词谱批注推来的）
- 律诗中间两联「词性是否相对」——需要词性知识，无法机械判定

## 五、目录

```
qiyun/
├─ server.js              # 服务端：路由、择体、成诗、校律重写、润色、流式返回
├─ server/prompt.mjs      # 诗心准则（四病与治法）、择体策略、句式骨架
├─ server/tunes.mjs       # 26 个词牌的格律（自搜韵《钦定词谱》抽取并核验）
├─ server/shi.mjs         # 近体诗格律（由四种律句按粘对推出）
├─ server/rhyme.mjs       # 词林正韵 19 部
├─ server/pingshui.mjs    # 平水韵 106 韵目
├─ server/validator.mjs   # 校律 + 正文清洁
├─ server/poets.mjs       # 12 位诗人的笔法提要
├─ server/allusions.mjs   # 典故索引与「按场景挑典」
├─ server/allusions-a.mjs # 典故数据：先秦至唐 64 条
├─ server/allusions-b.mjs # 典故数据：宋至近现代 100 条
├─ server/deepseek.mjs    # 与 DeepSeek 的 SSE 流式对话
├─ public/index.html      # 页面结构（三栏）
├─ public/style.css       # 样式
├─ public/app.js          # 前端逻辑
├─ .env.example           # 配置模板（复制成 .env 使用）
└─ README.md              # 开发说明：数据来源、自测方式、已知局限
```

## 六、注意事项

- **不要直接双击 `public/index.html`**。浏览器会拦掉 ES 模块与接口，
  表现是「页面对着、点落笔没反应」。必须走服务端。页面已加了拦截提示。
- **这是要花 API 额度的**。一首诗会调用模型 2～8 次（择体、多次校律重写、自评、润色），
  长调更费。要省额度，可以把 `server.js` 里的 `MAX_TRIES` 调小。
- **平仄并非 100%**。页面会如实标出还剩几处出入，不假装完美。
- 词的押韵按《词林正韵》，近体诗按《平水韵》——两套标准，不要混用。

## 七、数据来源

| 数据 | 来源 |
| --- | --- |
| 26 个词牌的句式、平仄、韵位 | 搜韵[《钦定词谱》](https://www.sou-yun.cn/QueryCiTune.aspx)，抽取时逐条硬校验 |
| 近体诗平仄谱 | 由四种基本律句按「粘对」推出，与《春望》《山居秋暝》等名作逐句核对一致 |
| 《词林正韵》19 部 | 诗词家园，另两家交叉验证，部归属一致率 100.00% |
| 《平水韵》106 韵目 | 搜韵官方文档，另两家交叉验证 |
| 164 条典故 | 逐条网络检索核实出处，精确到篇名与卷次 |

更详细的开发说明、自测方式与已知局限，见 `README.md`。
