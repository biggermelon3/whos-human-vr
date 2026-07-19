Who is Human - VR 展台包 (booth package)
========================================

架构:这台展台 PC 跑「kokoro 语音 + 游戏客户端」;游戏服务器和 6 个 AI
在你的 Vultr 上常开。服务器是单会话 -> 一次只能一个评委玩(展台轮流)。

    [ 展台 PC (本 zip) ]                         [ 你的 Vultr, 常开 ]
      kokoro TTS  (本地 :8000) --语音-->          who-is-human 服务器 :8787
      WhosHuman.exe                               + 7 个 claude agent (file 后端)
        baseUrl -> <Vultr公网IP>:8787  --游戏/AI-->


最终 zip 结构
-------------
  WhosHumanVR/
    start.bat            <- 每次开玩:起 kokoro -> 等就绪 -> 开游戏 -> 关游戏时停 kokoro
    setup-kokoro.bat     <- 一次性:在这台机装好 kokoro(联网, 几分钟)
    README.txt
    game/                <- 你的 Unity 构建
       WhosHuman.exe
       WhosHuman_Data/
    kokoro/              <- kokoro-local-tts 源码(不带 .venv / .env, setup 会现装)


组装步骤(你做一次)
--------------------
1) Unity 里 Build 出 Windows 版:
   - GameClient.baseUrl  设为  http://<你的Vultr公网IP>:8787
   - TtsClient.ttsBase   保持  http://127.0.0.1:8000
   - 不要在 StreamingAssets/server 里放本地服务器(留空)
     -> ServerBootstrap 会自动 no-op,游戏直接连 Vultr
   - 把 WhosHuman.exe + WhosHuman_Data/ 放进  game\
2) 把 kokoro-local-tts 整个文件夹复制进  kokoro\
   (删掉里面的 .venv 和任何 .env;setup 会重装)
3) Vultr 上确认:
   - who-is-human 服务器在跑:WIH_AGENT_BACKEND=file  WIH_FILE_TIMEOUT_MS=600000
   - 7 个 agent runner 在跑:CLI=claude MODEL=claude-haiku-4-5 ./tools/start-all-agents.sh
   - 防火墙放行 8787(注意:服务器无鉴权,建议只在展台期间开放,或用 Tailscale)


展台机上运行
------------
  Windows:
    第一次(联网, 几分钟):  双击  setup-kokoro.bat
    每次开玩:               双击  start.bat

  macOS(桌面/非 VR):
    Unity 里要 Build 成 macOS 版(target=macOS,产物是 WhosHuman.app,放进 game\)。
    macOS 上 PC-VR 跑不了,所以是鼠标桌面版(右键拖动看、点狐狸/按钮)。
    第一次:  chmod +x setup-kokoro.command && ./setup-kokoro.command   (或右键→打开)
    每次开玩: chmod +x start.command && ./start.command
    首次双击若被 Gatekeeper 拦:右键→打开;或对 .app 执行
             xattr -dr com.apple.quarantine game/WhosHuman.app
    英文语音若报 espeak 相关错:  brew install espeak-ng   (中文不需要)


评委怎么玩
----------
  戴头显 -> New Game -> 6 只狐狸里藏着人类(也可能你就是)。
  目标:揪出人类 / 自己别被认出来。一次一个人玩。


排错
----
  - 没声音:确认 setup-kokoro.bat 跑过、:8000 起来了(start.bat 会等它)。
  - 连不上 / 一直转:确认 Vultr 服务器在跑、8787 外网可达、baseUrl 里的 IP 正确。
  - 只有中英文有声音(正常;kokoro 只开了 en / zh)。
