# 在小内存 Linux 服务器上跑 who-is-human + Claude CLI agents

面向:一台**无显卡、约 1 GB 内存**的小 VPS(例:Vultr `951Mi` + `2.3Gi` swap),
用你的 **Claude 订阅**通过 `claude` CLI 驱动 6 个 AI agent —— **不需要付费 API key**,
也不在本机跑模型(推理在 Anthropic 云端,CLI 只是瘦客户端)。

## 为什么这台小机器能行

- `claude` CLI 不吃显卡、不吃算力,真正的推理在云端。
- 每次 `claude -p` 是**一次性无状态调用**(不带历史)——正好符合"各 agent context 不通"的需求;
  agent 需要的信息(公开状态 + 最近 40 条发言)已打包在请求 JSON 里。
- **关键**:`orchestrator` 的**夜晚**(狼人/预言家/医生)和**赛后审判**(6 个 AI 同时投票)
  是 `Promise.all` **并发**请求的。若不处理,会同时冒 4–6 个 `claude` 进程 → 1 GB 必 OOM。
  `tools/agent-runner.sh` 现已内置 **flock 全局锁**:无论哪个阶段,**同一时刻只跑一个
  `claude`**。游戏逻辑的 `Promise.all` 照常等,底层调用排队串行执行,峰值内存 = 1 个 `claude`。

## 内存预算(粗算)

| 组成 | 约用量 |
|---|---|
| OS + 你现有的其它服务 | 你截图里的 ~476 MB |
| who-is-human Node 服务器 | ~60 MB |
| 7 个 bash runner 轮询循环 | ~30 MB |
| **同时只有 1 个** `claude` CLI(Claude Code 运行时) | ~300–500 MB(峰值) |

峰值 ≈ 恰好顶到 951 MB → 会吃一点 **swap**(你有 2.3 GB,够),表现是"能跑、稍慢"。
建议:游戏期间尽量**停掉那 476 MB 的其它服务**腾内存;`buff/cache` 内核会自动回收。

> ⚠️ **语音(kokoro TTS)别放这台机器**:它要 torch + 模型(~1–2 GB 内存),和 claude 抢内存会爆。
> TTS 继续放你自己的 PC,或另找有内存/显卡的机器。这台只跑"游戏服务器 + 6 个文字 agent"。

---

## 一、装依赖(Ubuntu/Debian)

```bash
apt update && apt install -y git jq util-linux curl
# Node 需 >= 18。系统源里的可能太旧，用 NodeSource 装 Node 20：
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # 确认 >= 18
which flock jq   # 都要有（flock 来自 util-linux）
```

## 二、拿代码 + 安装

```bash
git clone <你的仓库地址> who-is-human      # 或用 scp 把项目传上来
cd who-is-human
npm install
```

## 三、装并登录 Claude CLI(用订阅,不是 API key)

```bash
npm install -g @anthropic-ai/claude-code
```

无头服务器登录二选一:

- **OAuth**:直接运行 `claude`,它会打印一个授权 URL;在你**本地浏览器**打开、授权,
  把回调 code 粘回终端。之后凭据存在 `~/.claude/`。
- **拷贝凭据**:把你 Windows 上已登录的 `C:\Users\<你>\.claude\` 整个目录传到服务器
  `~/.claude/`(最省事)。

验证:`echo '{}' | claude -p 'reply with {"ok":true}' --output-format json` 能返回 JSON 即 OK。

> 别设 `ANTHROPIC_API_KEY` —— 一旦设了,CLI 会走**计费 API** 而不是订阅。

## 四、起游戏服务器

```bash
mkdir -p logs
export WIH_AGENT_BACKEND=file
export WIH_FILE_TIMEOUT_MS=600000   # 审判阶段 6 个 agent 串行排队，别被默认 180s 切掉
export PORT=8787                    # Express 默认监听 0.0.0.0，外网可达
nohup npm start > logs/server.log 2>&1 &
tail -f logs/server.log             # 看到 "Who is Human — http://localhost:8787" 即成功
```

## 五、起 7 个 agent runner(claude + Haiku)

用 **Haiku**:一句话社交推理绰绰有余,更快、更省订阅额度、每次调用更轻:

```bash
CLI=claude MODEL=claude-haiku-4-5 ./tools/start-all-agents.sh
# 日志：logs/agent-A-0X.log
# 全部停止：kill $(cat logs/agent-pids.txt)
```

`start-all-agents.sh` 会拉起 7 个后台 runner;当前是人类的那个位子不会收到 turn 文件,自动闲置。
flock 全局锁已内置,所以并发阶段也只会一个一个跑 `claude`。

## 六、让 Unity / 浏览器连过来

游戏服务器**没有鉴权**,别直接裸奔公网。三选一:

1. **Tailscale(推荐)**:服务器和你的 Unity 机器都装 Tailscale,组进同一 tailnet,
   Unity 里连 `http://<服务器的 tailnet IP>:8787`。私有、免开公网端口。
2. **开放端口 + 限来源 IP**:在 Vultr 防火墙放行 8787,只允许你的出口 IP;
   Unity 连 `http://<服务器公网IP>:8787`。
3. **nginx 反代 + HTTPS(+ Basic Auth)**:想要域名/加密时用。

> Unity 用 `UnityWebRequest`,**不受浏览器 CORS 限制**,直接连即可。
> 若还想让**浏览器**远程访问,需要给 Express 加 CORS(现在只保证同源)。

## 七、日常运维

```bash
# 停游戏服务器
pkill -f "tsx src/server/server.ts"
# 停所有 agent
kill $(cat logs/agent-pids.txt) 2>/dev/null
# 重启一局：重开服务器即会自动开新游戏；agent runner 可一直挂着复用
```

## 注意事项

- **速率限制**:6 个 agent × 每局多回合 = 不少 `claude` 调用,订阅有用量上限;
  用 Haiku 已经省很多,但连开多局要留意别触顶。
- **延迟**:每回合 = `claude` 冷启动(~2–4s)+ Haiku 往返(~2–5s),且全局串行。
  一轮讨论(最多 6 人)大约 30–60s;回合制,能接受。慢主要来自冷启动 + swap。
- **只跑文字**:这台 1 GB 机器**不要**再叠语音/本地模型。
- **凭据安全**:`~/.claude/` 是你的订阅凭据,别提交进 git、别泄露。
