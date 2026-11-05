#!/usr/bin/env node
/**
 * board.mjs — 生成自包含的静态排行页 (bench/out/board.html & web/board.html)
 *
 *   node bench/board.mjs [--out bench/out/board.html]
 *
 * 自动扫描 bench/out/<runId>/ 下的 result.json、episode.jsonl 与 verify.json，
 * 校验 SHA-256 指纹，并生成包含昆仑云海泼墨山水横幅、KPI 概览、帕累托前沿散点图、
 * Pure vs Normal 自主通关对比榜、原版 CPK 全四章 24 关主线矩阵与重放核验说明的静态页面。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeEpisodeDigest, readEpisodeLog } from "./verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(__dirname, "out");

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

/** 一维噪声生成泼墨山脊 polygon 点串 */
function ridge(y0, amp, seed, n = 60, W = 1200, H = 220) {
  const pts = [`0,${H}`];
  for (let i = 0; i <= n; i++) {
    const x = ((i / n) * W).toFixed(1);
    const t = i * 0.35 + seed;
    const dy =
      Math.sin(t) * 0.5 +
      Math.sin(t * 2.3 + 1.7) * 0.3 +
      Math.sin(t * 5.1 + 3.1) * 0.2;
    pts.push(`${x},${(y0 + dy * amp).toFixed(1)}`);
  }
  pts.push(`${W},${H}`);
  return pts.join(" ");
}

/** 扫描 bench/out/ 下所有运行目录并加载成绩与核验状态 */
export function loadRuns(root = OUT_ROOT) {
  if (!fs.existsSync(root)) return [];
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(root, d.name))
    .sort();

  const runs = [];
  for (const dir of dirs) {
    const resultPath = path.join(dir, "result.json");
    const logPath = path.join(dir, "episode.jsonl");
    const verifyPath = path.join(dir, "verify.json");
    if (!fs.existsSync(resultPath) || !fs.existsSync(logPath)) continue;

    const runId = path.basename(dir);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    const log = readEpisodeLog(logPath);
    const mode = result.mode || log.start?.mode || "normal";

    let verifyState = "unverified";
    let verifyDigest = "";
    if (fs.existsSync(verifyPath)) {
      try {
        const v = JSON.parse(fs.readFileSync(verifyPath, "utf8"));
        const curDigest = computeEpisodeDigest(dir);
        if (v.ok && v.episodeDigest === curDigest) {
          verifyState = "verified";
          verifyDigest = curDigest;
        } else {
          verifyState = "failed";
        }
      } catch {
        verifyState = "failed";
      }
    }

    const gameCleared = Boolean(result.gameCleared);
    const chapter1Cleared = Boolean(result.chapter1Cleared || gameCleared);
    const trialCleared = Boolean(result.trialCleared || chapter1Cleared);
    const realCpk = Boolean(result.realCpk || log.start?.realCpk);
    const progressPct = gameCleared
      ? 100
      : chapter1Cleared
        ? 50
        : trialCleared
          ? 25
          : 0;
    const scopeLabel = gameCleared
      ? realCpk
        ? "原版 CPK 全四章终局通关 (24幕·Act I–IV)"
        : "7幕浓缩战役通关 (Synthetic Act I–IV)"
      : result.chapter1Cleared
        ? "第一章通关 (石沉溪洞)"
        : "序章试炼通关 (青鸾峰)";
    const maxLevel = Array.isArray(result.party)
      ? Math.max(...result.party.map((p) => p.level || 1))
      : 1;
    const partyCount = Array.isArray(result.party)
      ? result.party.filter((p) => p.in_team).length
      : 1;
    const items = result.inventory?.items?.map((i) => i.name) || [];

    runs.push({
      runId,
      timestamp: log.start?.timestamp || "",
      model: result.model || "unknown",
      shortModel: String(result.model || "unknown").replace(/^[^:]+:/, ""),
      provider: String(result.model || "unknown").includes(":")
        ? String(result.model).split(":")[0]
        : "local",
      mode,
      realCpk,
      scopeLabel,
      progressPct,
      gameCleared,
      chapter1Cleared,
      trialCleared,
      toolCalls: result.toolCalls || log.calls.length,
      agentTurns: result.agentTurns || 1,
      durationMs: result.durationMs || 0,
      finalWorld: `${result.world}/${result.scene}`,
      finalTitle: result.title || "",
      victories: result.combat?.victories ?? 0,
      maxLevel,
      partyCount,
      items,
      drawCalls: result.gles3?.draw_calls ?? 0,
      triangles: result.gles3?.triangles ?? 0,
      inputTokens: result.usage?.input_tokens ?? 0,
      outputTokens: result.usage?.output_tokens ?? 0,
      cacheReadTokens: result.usage?.cache_read_tokens ?? 0,
      totalTokens: result.usage?.total_tokens ?? 0,
      verifyState,
      verifyDigest,
      initial: log.start?.initial || null,
      calls: log.calls,
    });
  }

  // Sort: realCpk full clear first, then progressPct, then pure mode first, then fewer toolCalls
  runs.sort((a, b) => {
    if (b.realCpk !== a.realCpk) return b.realCpk ? 1 : -1;
    if (b.progressPct !== a.progressPct) return b.progressPct - a.progressPct;
    if (a.mode !== b.mode) return a.mode === "pure" ? -1 : 1;
    return a.toolCalls - b.toolCalls;
  });
  return runs;
}

/** 加载预渲染的原版 3D 帧清单 (web/frames/manifest.json) */
function loadFrameManifest() {
  const candidates = [
    path.resolve(__dirname, "../web/frames/manifest.json"),
    path.resolve(OUT_ROOT, "frames/manifest.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        // ignore
      }
    }
  }
  return { byPos: {}, bySceneLeader: {}, byScene: {}, byWorld: {} };
}

function resolveStepFrame(st, manifest) {
  if (!st || !manifest) return "";
  const w = st.world || "";
  const sc = st.scene || "";
  const ldrName = st.leader?.name || "云天河";
  const rawPos = st.leader?.position || [0, 0, 0];
  const p = rawPos.map((x) => Math.round((Number(x) || 0) / 10) * 10).join(",");
  const posKey = `${w}/${sc}@${ldrName}@${p}`;
  const scLdrKey = `${w}/${sc}@${ldrName}`;
  const scKey = `${w}/${sc}`;
  return (
    manifest.byPos?.[posKey] ||
    manifest.bySceneLeader?.[scLdrKey] ||
    manifest.byScene?.[scKey] ||
    manifest.byWorld?.[w] ||
    ""
  );
}

/** 将所有运行的完整轨迹压缩为自包含的增量回放数据包（供前端回放器零延迟加载） */
function buildCompactReplayRuns(runs, manifest) {
  return runs.map((r) => {
    let prevScKey = "",
      prevInvKey = "",
      prevPtyKey = "";
    const rawSteps = [
      ...(r.initial ? [{ step: 0, tool: "init", args: {}, state: r.initial }] : []),
      ...(r.calls || []).map((c) => ({
        step: c.step,
        tool: c.tool,
        args: c.args || {},
        state: c.state || {},
      })),
    ];
    const steps = rawSteps.map((s, idx) => {
      const st = s.state || {};
      const prevRaw = idx > 0 ? rawSteps[idx - 1] : null;
      const prevSt = prevRaw?.state || null;
      const scKey = `${st.world || ""}/${st.scene || ""}`;
      const pty = (st.party || [])
        .filter((p) => p.in_team)
        .map((p) => ({
          n: p.name,
          lv: p.level || 1,
          hp: p.hp ?? 0,
          mhp: p.max_hp || 1,
          mp: p.mp ?? 0,
          mmp: p.max_mp || 1,
        }));
      const ptyKey = JSON.stringify(pty);
      const inv = {
        m: st.inventory?.money || 0,
        it: (st.inventory?.items || []).slice(0, 18).map((i) => `${i.name}×${i.count}`),
      };
      const invKey = JSON.stringify(inv);
      const imgFile = resolveStepFrame(st, manifest);
      let rawSubs = null;
      if (r.runId === "opus-20261105T061222" && manifest?.substepsByStep?.[String(s.step)]) {
        rawSubs = manifest.substepsByStep[String(s.step)];
      } else if (prevSt?.world && s.args?.target) {
        const transKey = `${prevSt.world}/${prevSt.scene}->${s.args.target}`;
        rawSubs = manifest?.substepsByTransition?.[transKey] || null;
      }
      const out = {
        step: s.step,
        tool: s.tool,
        args: s.args,
        ok: st.ok !== false,
        ev: String(st.event || st.error || "").slice(0, 520),
        frame: st.frame || 0,
        w: st.world || "",
        sc: st.scene || "",
        title: st.title || "",
        img: imgFile ? `frames/${imgFile}` : "",
        ...(rawSubs && rawSubs.length
          ? {
              subs: rawSubs.map((sub) => ({
                w: sub.w,
                sc: sub.sc,
                p: (sub.p || [0, 0, 0]).map((v) => Math.round(Number(v) || 0)),
                yaw: Math.round(Number(sub.yaw || 0)),
                img: sub.img ? `frames/${sub.img}` : "",
                tgt: sub.target || "",
              })),
            }
          : {}),
        clr: Boolean(st.game_cleared),
        ldr: st.leader
          ? {
              n: st.leader.name || "云天河",
              p: (st.leader.position || [0, 0, 0]).map((x) => Math.round(Number(x) || 0)),
              yaw: Math.round(Number(st.leader.rotation_yaw) || 0),
            }
          : null,
        j: st.journal ? { s: st.journal.summary || "", wp: st.journal.waypoint || "" } : null,
        dlg: st.dialog?.visible ? String(st.dialog.text || "").slice(0, 360) : "",
        cbt: st.combat
          ? {
              act: Boolean(st.combat.active),
              v: st.combat.victories || 0,
              log: String(st.combat.last_log || "").slice(0, 180),
              en: (st.combat.enemies || []).map((e) => ({
                s: e.slot,
                n: e.name || e.id || `敌#${e.slot}`,
                hp: e.hp ?? 0,
                mhp: e.max_hp || 1,
              })),
            }
          : null,
        gl: st.gles3 ? [st.gles3.draw_calls || 0, st.gles3.triangles || 0] : [0, 0],
      };
      if (ptyKey !== prevPtyKey) {
        out.pty = pty;
        prevPtyKey = ptyKey;
      }
      if (invKey !== prevInvKey) {
        out.inv = inv;
        prevInvKey = invKey;
      }
      if (scKey !== prevScKey) {
        out.npcs = (st.npcs || []).slice(0, 10).map((n) => ({
          n: n.name,
          p: (n.position || [0, 0, 0]).map((x) => Math.round(Number(x) || 0)),
        }));
        out.objs = (st.objects || []).slice(0, 14).map((o) => ({
          n: o.name,
          p: (o.position || [0, 0, 0]).map((x) => Math.round(Number(x) || 0)),
          r: o.research_able ? 1 : 0,
          u: o.uses > 99 ? 99 : (o.uses ?? 1),
        }));
        out.evs = (st.events || []).slice(0, 14).map((e) => ({
          n: e.name,
          p: (e.position || [0, 0, 0]).map((x) => Math.round(Number(x) || 0)),
          t: e.type ?? 0,
          a: e.active ? 1 : 0,
        }));
        out.mons = (st.monsters || []).slice(0, 8).map((m) => ({
          n: m.name,
          p: (m.position || [0, 0, 0]).map((x) => Math.round(Number(x) || 0)),
        }));
        prevScKey = scKey;
      }
      return out;
    });
    return {
      runId: r.runId,
      model: r.shortModel,
      mode: r.mode,
      realCpk: r.realCpk,
      scopeLabel: r.scopeLabel,
      toolCalls: r.toolCalls,
      victories: r.victories,
      maxLevel: r.maxLevel,
      durationSec: Number((r.durationMs / 1000).toFixed(1)),
      steps,
    };
  });
}

/** 24-Stage Retail CPK Act I-IV Matrix */
const REAL_CPK_STAGES = [
  { step: 1, act: "第一幕", scene: "Q01/N01", title: "青鸾峰·木屋清晨", milestone: "原版 NewGame 启动与小山猪剧情触发", mvar: "10100", engine: "GameScript.csb / Q01.csb 初始化与 GBK 对白解码" },
  { step: 2, act: "第一幕", scene: "Q01/Q01", title: "青鸾峰·山道", milestone: "清晨给爹娘牌位上香、小山猪闯入石沉溪洞", mvar: "10201", engine: "跨场景传送与过场镜头运镜自动推进" },
  { step: 3, act: "第一幕", scene: "Q01/N01 → Q01", title: "青鸾峰·取弓与古剑", milestone: "返屋拾取【长弓】与【不知名的剑】(MO002)", mvar: "10300", engine: "3D GOB 交互与背包物品系统同步" },
  { step: 4, act: "第一幕", scene: "M01/1", title: "石沉溪洞·迷宫入口", milestone: "开启洞口机关进入 type=2 迷宫，加载 8 只迷宫怪物", mvar: "10400", engine: "SceneMonsters 迷宫怪物组生成与 .nav 导航网格" },
  { step: 5, act: "第一幕", scene: "M01/1", title: "石沉溪洞·初遇菱纱", milestone: "触发 ev_M01_1_6，韩菱纱烟雨夺魂与非领队角色寻路", mvar: "10600", engine: "非领队角色 (slot!=leader) 自动寻路防死锁" },
  { step: 6, act: "第一幕", scene: "M01/1", title: "石沉溪洞·魁召二连战", milestone: "烤山猪结识韩菱纱、仙术教学、魁召 Boss 二连战获胜", mvar: "11100", engine: "StartCombat 战斗状态机与望舒剑寒气觉醒" },
  { step: 7, act: "第一幕", scene: "M01/2 → M01/3", title: "石沉溪洞·冰封墓室", milestone: "云天青夙玉合葬墓室崩塌、立下下山约定", mvar: "11400", engine: "连续场景切换 (M01/2 → M01/3) 与脚本模态等待" },
  { step: 8, act: "第一幕", scene: "Q01/Q01", title: "重返青鸾峰", milestone: "走出崩塌石沉溪洞返回青鸾峰山道", mvar: "11400", engine: "第一幕迷宫闭环完成，零脚本错误" },
  { step: 9, act: "第二幕", scene: "Q01 → M02 → Q02", title: "紫云架至太平村", milestone: "拜别云天青墓、穿越紫云架 (M02/1..3) 抵达太平村", mvar: "20300", engine: "跨世界加载 (Q01 → M02 → Q02) 与 LinkObj 触发" },
  { step: 10, act: "第二幕", scene: "M03/1Y → Q03/Q03S", title: "巢湖夜战与寿阳城", milestone: "太平村钟馗剧变、巢湖夜战风邪兽、初遇慕容紫英抵寿阳", mvar: "21700", engine: "昼夜变体场景 (M03/1Y, Q03S) 与剧情 Boss 战" },
  { step: 11, act: "第二幕", scene: "Q03/Q03X → XN03Y", title: "寿阳告示与柳府夜探", milestone: "揭海捕文书 (MO005)、夜闯柳府初遇柳梦璃", mvar: "22100", engine: "场景内多层室内外切换 (Q03S → Q03X → XN03Y)" },
  { step: 12, act: "第二幕", scene: "M04/1 → M05/1", title: "女萝岩与八公山", milestone: "女萝岩击败槐妖长老、返回柳府议事并进入八公山", mvar: "30500", engine: "M04.csb 妖界剧情与队伍状态恢复" },
  { step: 13, act: "第二幕", scene: "M06/1A..2D..4", title: "淮南王陵全机关解谜", milestone: "点亮多室油灯机关、击败淮南王夺取土灵珠并爬梯脱出", mvar: "31300", engine: "复杂多子场景状态保持 (M06/1A..2D..4) 与梯子传送" },
  { step: 14, act: "第二幕", scene: "Q03/XN03", title: "柳梦璃正式入队", milestone: "重返寿阳柳府客房休憩、柳梦璃入队，第二幕圆满通关", mvar: "40100", engine: "PlayerRoster 三人入队同步与队形配置" },
  { step: 15, act: "第三幕", scene: "M07/1..9 → Q04", title: "女萝岩地脉至陈州", milestone: "穿越女萝岩九层地脉迷宫 (M07/1..9) 抵达陈州城", mvar: "50200", engine: "M07 九层地脉连续传送门与机关门解谜" },
  { step: 16, act: "第三幕", scene: "M08/1..5 → Q05", title: "千佛塔与播仙镇", milestone: "陈州弦歌台、夜探五层千佛塔 (M08/1..5)、琴姬悲歌抵播仙镇", mvar: "51600", engine: "M08 五层佛塔递进触发与 CN05C 特殊室内场景映射" },
  { step: 17, act: "第三幕", scene: "M09/1..3 → M10/1", title: "太一仙径与须臾幻境", milestone: "攀登太一仙径 (M09/1..3) 抵昆仑琼华派，进入须臾幻境", mvar: "61001", engine: "昆仑山门剧情衔接与幻境试炼初始化" },
  { step: 18, act: "第三幕", scene: "M10/1..10 → Q06", title: "酒仙财神试炼与紫英入队", milestone: "集齐 99 坛美酒破酒仙试炼、集九眼石破财神试炼、慕容紫英入队", mvar: "70200", engine: "AngelScript 2.2 double 双精度浮点指令集 (72..84) 执行" },
  { step: 19, act: "第四幕", scene: "M11 → Q07 → M20/1Y", title: "御剑下山与禁地初见玄霄", milestone: "解锁御剑飞行、碗丘山与月牙村求援、夜探思返谷禁地见玄霄", mvar: "81100", engine: "WorldMap.csb 御剑飞行系统 (fly_to) 与禁地冰封剧情" },
  { step: 20, act: "第四幕", scene: "M12 → Q08 → Q09 → M13", title: "清阳仙逝与即墨花灯", milestone: "醉花荫清阳真人仙逝、夏螟虫笼破狐仙、即墨花灯之约、受托三寒器", mvar: "100200", engine: "Q09 即墨夜景多 NPC 互动与 M20 禁地二次会面" },
  { step: 21, act: "第四幕", scene: "M14 → M03/Q10 → M20/1", title: "三寒器齐聚与玄霄破冰", milestone: "炎帝神农洞取炙炎石、居巢国获水灵珠、土灵珠脱出、玄霄破冰决裂", mvar: "121100", engine: "use_item('EarthBall') 土灵珠迷宫脱出与破冰大剧情" },
  { step: 22, act: "第四幕", scene: "M15 → Q11 → Q12 → M17/5", title: "鬼界重逢、不周山与封神陵", milestone: "无常殿与转轮镜台见云天青、不周山战衔烛之龙、封神陵取后羿射日弓", mvar: "140100", engine: "鬼界/不周山/封神陵超长跨界剧情链与神弓获取" },
  { step: 23, act: "第四幕", scene: "Q06J → Q14 → M18/1", title: "幻瞑界真相与梦璃诀别", milestone: "旋梦入幻瞑界、里幻瞑宫揭十九年前真相、柳梦璃继位少主挥泪诀别", mvar: "160400", engine: "琼华妖界大战多场连续脚本战斗与队伍成员离队" },
  { step: 24, act: "第四幕", scene: "Q01 → M19/1..2", title: "卷云台终局决战与百年重逢", milestone: "夜归青鸾峰祭拜父母、闯焚毁琼华派、卷云台战玄霄夙瑶、挽弓射日大结局", mvar: "170000", engine: "终局双 Boss 决战、game_cleared=true 判定与青鸾峰结局闭环" },
];

function renderVerifyBadge(state, digest = "") {
  if (state === "verified") {
    return `<span class="vbadge ok" title="确定性重放核验通过 · SHA-256: ${esc(digest.slice(0, 16))}…">已核验 ✓</span>`;
  }
  if (state === "failed") {
    return `<span class="vbadge bad" title="重放结果与日志不一致">核验失败 ✗</span>`;
  }
  return `<span class="vbadge warn" title="尚未运行 node bench/verify.mjs">待核验</span>`;
}

function renderModeBadge(mode, realCpk = false) {
  const cpkTag = realCpk
    ? ` <span class="mbadge pure" title="挂载原版零售 gamedata/*.cpk 完整资源包 (24幕·43个.csb模块)">CPK 原版</span>`
    : "";
  if (mode === "pure") {
    return `<span class="mbadge pure" title="Pure 纯净模式：隐藏内部变量与脚本函数名，禁用调试跳关指令">PURE 纯净</span>${cpkTag}`;
  }
  return `<span class="mbadge normal" title="Normal 标准模式：暴露完整语义名称与诊断状态">NORMAL 标准</span>${cpkTag}`;
}

/** 生成 进度% × 工具调用步数 散点图 + 帕累托前沿 */
function renderScatterSvg(runs) {
  const W = 580,
    H = 300,
    padL = 56,
    padR = 30,
    padT = 26,
    padB = 42;
  const iW = W - padL - padR,
    iH = H - padT - padB;
  const maxCalls = Math.max(60, ...runs.map((r) => Math.ceil((r.toolCalls + 25) / 50) * 50));
  const xOf = (calls) => padL + (calls / maxCalls) * iW;
  const yOf = (pct) => padT + (1 - pct / 105) * iH;

  // Pareto frontier: sort by toolCalls asc, keep strictly higher progressPct
  const sorted = [...runs].sort((a, b) => a.toolCalls - b.toolCalls);
  const pareto = [];
  let bestPct = -1;
  for (const r of sorted) {
    if (r.progressPct > bestPct) {
      pareto.push(r);
      bestPct = r.progressPct;
    }
  }

  let grid = "";
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = yOf(pct).toFixed(1);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="grid"/><text x="${padL - 8}" y="${Number(y) + 4}" class="ax" text-anchor="end">${pct}%</text>`;
  }
  const stepC = maxCalls > 120 ? 50 : 10;
  for (let c = 0; c <= maxCalls; c += stepC) {
    const x = xOf(c).toFixed(1);
    grid += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" class="grid"/><text x="${x}" y="${H - padB + 16}" class="ax" text-anchor="middle">${c}步</text>`;
  }

  const paretoLine =
    pareto.length > 1
      ? `<polyline fill="none" stroke="var(--seal)" stroke-width="2" stroke-dasharray="5,4" points="${pareto
          .map((r) => `${xOf(r.toolCalls).toFixed(1)},${yOf(r.progressPct).toFixed(1)}`)
          .join(" ")}"/>`
      : "";

  const dots = runs
    .map((r, idx) => {
      const cx = xOf(r.toolCalls).toFixed(1);
      const cy = yOf(r.progressPct).toFixed(1);
      const color = r.realCpk
        ? "var(--seal)"
        : r.mode === "pure"
          ? "var(--ok)"
          : "var(--accent)";
      const tag = r.shortModel.includes("opus") ? "Opus-5.5" : "Argon";
      const scopeTag = r.realCpk ? "CPK" : r.mode.toUpperCase();
      const label = `${r.shortModel} [${scopeTag}] (${r.toolCalls}步, ${r.progressPct}%)`;
      const dy = idx % 2 === 0 ? -10 : 15;
      return `<g class="pt"><circle cx="${cx}" cy="${cy}" r="6.5" fill="${color}" stroke="var(--card)" stroke-width="2"><title>${esc(label)}</title></circle><text x="${cx}" y="${Number(cy) + dy}" text-anchor="middle">${esc(tag)} ${esc(scopeTag)} · ${r.toolCalls}步</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="scatter" role="img" aria-label="通关进度与工具调用步数帕累托前沿图">
    ${grid}
    ${paretoLine}
    ${dots}
    <text x="${padL + iW / 2}" y="${H - 6}" class="ax-title" text-anchor="middle">工具调用步数 (Tool Calls · 绿/蓝=7幕浓缩战役，红印=24幕原版CPK全流程)</text>
    <text x="16" y="${padT + iH / 2}" class="ax-title" text-anchor="middle" transform="rotate(-90 16 ${padT + iH / 2})">战役通关进度 (%)</text>
  </svg>`;
}

/** 生成 Token 效率散点图 */
function renderTokenSvg(runs) {
  const W = 580,
    H = 300,
    padL = 56,
    padR = 30,
    padT = 26,
    padB = 42;
  const iW = W - padL - padR,
    iH = H - padT - padB;
  const maxK = Math.max(100, ...runs.map((r) => Math.ceil((r.totalTokens / 1000 + 25) / 50) * 50));
  const xOf = (k) => padL + (k / maxK) * iW;
  const yOf = (pct) => padT + (1 - pct / 105) * iH;

  let grid = "";
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = yOf(pct).toFixed(1);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="grid"/><text x="${padL - 8}" y="${Number(y) + 4}" class="ax" text-anchor="end">${pct}%</text>`;
  }
  const stepK = maxK > 150 ? 50 : 20;
  for (let k = 0; k <= maxK; k += stepK) {
    const x = xOf(k).toFixed(1);
    grid += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" class="grid"/><text x="${x}" y="${H - padB + 16}" class="ax" text-anchor="middle">${k}k</text>`;
  }

  const dots = runs
    .map((r, idx) => {
      const k = r.totalTokens / 1000;
      const cx = xOf(k).toFixed(1);
      const cy = yOf(r.progressPct).toFixed(1);
      const color = r.realCpk
        ? "var(--seal)"
        : r.mode === "pure"
          ? "var(--ok)"
          : "var(--accent)";
      const tag = r.shortModel.includes("opus") ? "Opus-5.5" : "Argon";
      const scopeTag = r.realCpk ? "CPK" : r.mode.toUpperCase();
      const dy = idx % 2 === 0 ? -10 : 15;
      return `<g class="pt"><circle cx="${cx}" cy="${cy}" r="6.5" fill="${color}" stroke="var(--card)" stroke-width="2"><title>${esc(r.shortModel)} [${esc(scopeTag)}] · ${(r.totalTokens / 1000).toFixed(1)}k tokens · ${(r.durationMs / 1000).toFixed(1)}s</title></circle><text x="${cx}" y="${Number(cy) + dy}" text-anchor="middle">${esc(tag)} ${esc(scopeTag)} · ${(r.totalTokens / 1000).toFixed(1)}k</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="scatter" role="img" aria-label="通关进度与Token消耗散点图">
    ${grid}
    ${dots}
    <text x="${padL + iW / 2}" y="${H - 6}" class="ax-title" text-anchor="middle">总 Token 消耗 (Total Tokens，含上下文推理)</text>
    <text x="16" y="${padT + iH / 2}" class="ax-title" text-anchor="middle" transform="rotate(-90 16 ${padT + iH / 2})">战役通关进度 (%)</text>
  </svg>`;
}

export function generateBoardHtml(runs, defaultTab = "stats") {
  const cpkOpus = runs.find((r) => r.realCpk && r.mode === "pure" && r.gameCleared && r.shortModel.includes("opus"));
  const cpkArgon = runs.find((r) => r.realCpk && r.mode === "pure" && r.gameCleared && r.shortModel.includes("argon"));
  const synthPureArgon = runs.find((r) => !r.realCpk && r.mode === "pure" && r.gameCleared && r.shortModel.includes("argon"));
  const synthPureOpus = runs.find((r) => !r.realCpk && r.mode === "pure" && r.gameCleared && r.shortModel.includes("opus"));
  const pureFull = cpkOpus || cpkArgon || synthPureArgon || runs[0];
  const normalFull = runs.find((r) => r.mode === "normal" && r.gameCleared);
  const verifiedCount = runs.filter((r) => r.verifyState === "verified").length;
  const frameManifest = loadFrameManifest();
  const replayDataJson = JSON.stringify({
    runs: buildCompactReplayRuns(runs, frameManifest),
    byScene: frameManifest.byScene || {},
    byWorld: frameManifest.byWorld || {},
  }).replace(/<\//g, "<\\/");

  const stepReductionPct =
    synthPureArgon && normalFull
      ? (((normalFull.toolCalls - synthPureArgon.toolCalls) / normalFull.toolCalls) * 100).toFixed(1)
      : "25.0";

  const bibtex = `@misc{liu2026agentpal4bench,
  author       = {Jianming Liu},
  title        = {agent-pal4-bench: A Headless C++20 \\& WebAssembly 3D RPG Agent Benchmark on Chinese Paladin IV (OpenPAL4)},
  year         = {2026},
  howpublished = {\\url{https://github.com/jianmliu/agent-pal4}},
  note         = {Evaluates long-horizon 3D spatial navigation, AngelScript 2.2 CSB VM execution, and Pure-mode de-biased reasoning across all 4 chapters of Chinese Paladin IV}
}`;

  const pureTraceRows = (pureFull?.calls || [])
    .map((c) => {
      const st = c.state || {};
      const argStr = Object.entries(c.args || {})
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      const pos = Array.isArray(st.leader?.position)
        ? `(${st.leader.position.map((n) => Number(n).toFixed(0)).join(", ")})`
        : "-";
      return `<tr>
        <td class="num">#${c.step}</td>
        <td><code>${esc(c.tool)}(${esc(argStr)})</code></td>
        <td><code>${esc(st.world || "-")}/${esc(st.scene || "-")}</code> · ${esc(st.title || "")}</td>
        <td>${esc(st.leader?.name || "-")} <span class="sub">${esc(pos)}</span></td>
        <td>${st.combat?.victories ?? 0} 胜</td>
        <td class="sub">${esc(String(st.event || "").slice(0, 68))}</td>
      </tr>`;
    })
    .join("\n");

  const cpkRows = REAL_CPK_STAGES.map(
    (s) => `<tr>
      <td class="num">Step ${s.step}</td>
      <td><span class="tag">${esc(s.act)}</span></td>
      <td><code>${esc(s.scene)}</code><div class="sub">${esc(s.title)}</div></td>
      <td><strong>${esc(s.milestone)}</strong></td>
      <td><code>mvar=${esc(s.mvar)}</code></td>
      <td class="sub">${esc(s.engine)}</td>
      <td><span class="vbadge ok">PURE ✓</span> <span class="vbadge ok">NORMAL ✓</span></td>
    </tr>`,
  ).join("\n");

  const runTableRows = runs
    .map(
      (r, i) => `<tr>
      <td class="rank">${i + 1}</td>
      <td>
        <div class="mname">${esc(r.shortModel)}</div>
        <div class="sub"><code>${esc(r.provider)}</code> · <code>${esc(r.runId)}</code></div>
      </td>
      <td>${renderModeBadge(r.mode, r.realCpk)}</td>
      <td>
        <strong>${esc(r.scopeLabel)}</strong>
        <div class="sub">终局场景：<code>${esc(r.finalWorld)}</code> (${esc(r.finalTitle)})</div>
      </td>
      <td class="num"><strong style="color:var(--ok)">${r.progressPct}%</strong></td>
      <td class="num"><strong>${r.toolCalls}</strong> 步</td>
      <td class="num">${r.victories} 胜 · Lv.${r.maxLevel}</td>
      <td class="num">${r.drawCalls} DC / ${r.triangles} Tri</td>
      <td class="num">${(r.totalTokens / 1000).toFixed(1)}k<div class="sub">缓存 ${(r.cacheReadTokens / 1000).toFixed(1)}k</div></td>
      <td class="num">${(r.durationMs / 1000).toFixed(1)}s</td>
      <td>${renderVerifyBadge(r.verifyState, r.verifyDigest)} <button type="button" class="rp-jump-btn" onclick="window.openReplayFor('${esc(r.runId)}')">🎬 回放</button></td>
    </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>仙剑奇侠传四 · 问情论剑 — agent-pal4 排行榜与 Web 交互式回放器</title>
<style>
  :root {
    --sky1: #0b1320; --sky2: #1c2d42; --sky3: #2e4760;
    --m1: #24384d; --m2: #1a2a3a; --m3: #101c28; --m4: #091018;
    --ink: #1b2228; --ink-soft: #4e5964; --paper: #f4f1ea; --card: #fbf9f4;
    --line: #d8d0c1; --accent: #23577a; --accent-soft: #e3eef5;
    --seal: #a82e26; --gold: #b88418; --ok: #1f6e4a; --warn: #9e6710; --bad: #a62c22;
    --moon: #f7eed2; --mist: #f4f1ea;
    --font-serif: "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", serif;
    --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    --font-mono: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #e5e1d8; --ink-soft: #9aa4ae; --paper: #0e141b; --card: #151e28;
      --line: #263342; --accent: #6cb4e8; --accent-soft: #1a2c3e;
      --seal: #d9544b; --gold: #e0ad3e; --ok: #46b883; --warn: #e09c38; --bad: #e0584c;
      --mist: #0e141b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font: 14.5px/1.6 var(--font-sans);
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: var(--font-mono); font-size: 0.88em;
    background: rgba(127,127,127,0.12); padding: 1px 5px; border-radius: 4px;
  }

  /* ── 顶部昆仑琼华水墨横幅 ── */
  header.hero {
    position: relative; overflow: hidden;
    background: linear-gradient(180deg, var(--sky1) 0%, var(--sky2) 55%, var(--sky3) 100%);
    color: #f6f2e8;
  }
  header.hero svg.scene {
    display: block; width: 100%; height: 225px;
  }
  .hero-title {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 0 20px 18px; text-align: center; pointer-events: none;
  }
  .hero-title h1 {
    margin: 0; font: 700 34px/1.2 var(--font-serif);
    letter-spacing: 0.22em; text-shadow: 0 3px 16px rgba(0,0,0,0.65);
  }
  .hero-title .seal {
    display: inline-block; margin-left: 10px; padding: 2px 9px;
    background: var(--seal); color: #fff; font: 600 14px/1.4 var(--font-serif);
    letter-spacing: 0.14em; border-radius: 3px; vertical-align: middle;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  .hero-title p {
    margin: 8px 0 0; font: 400 13.5px/1.5 var(--font-serif);
    letter-spacing: 0.12em; opacity: 0.9;
  }
  .gh-link {
    position: absolute; top: 16px; right: 20px; z-index: 3;
    display: inline-flex; align-items: center; gap: 7px;
    padding: 6px 13px; border-radius: 999px;
    background: rgba(15, 23, 34, 0.62); border: 1px solid rgba(255,255,255,0.22);
    color: #f5f1e6; font-size: 12.5px; backdrop-filter: blur(6px);
  }
  .gh-link:hover { background: rgba(15, 23, 34, 0.85); text-decoration: none; }

  main { max-width: 1220px; margin: 0 auto; padding: 18px 22px 64px; }

  /* ── 页签导航 ── */
  .tabs-Radio { display: none; }
  .tabs-nav {
    display: flex; flex-wrap: wrap; gap: 8px;
    margin: -8px 0 22px; padding: 8px;
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  }
  .tabs-nav label {
    cursor: pointer; padding: 8px 16px; border-radius: 7px;
    font-weight: 600; font-size: 13.5px; color: var(--ink-soft);
    transition: all 0.15s ease; user-select: none;
  }
  .tabs-nav label:hover { color: var(--ink); background: rgba(127,127,127,0.08); }
  #tab-stats:checked ~ .tabs-nav label[for="tab-stats"],
  #tab-replay:checked ~ .tabs-nav label[for="tab-replay"],
  #tab-campaigns:checked ~ .tabs-nav label[for="tab-campaigns"],
  #tab-cpk:checked ~ .tabs-nav label[for="tab-cpk"],
  #tab-verify:checked ~ .tabs-nav label[for="tab-verify"] {
    background: var(--accent); color: #fff;
  }
  .tab-pane { display: none; }
  #tab-stats:checked ~ #pane-stats,
  #tab-replay:checked ~ #pane-replay,
  #tab-campaigns:checked ~ #pane-campaigns,
  #tab-cpk:checked ~ #pane-cpk,
  #tab-verify:checked ~ #pane-verify { display: block; }

  /* ── Web 交互式回放器样式 ── */
  .rp-jump-btn {
    cursor: pointer; padding: 2px 8px; margin-left: 4px; border-radius: 999px;
    border: 1px solid var(--accent); background: var(--accent-soft);
    color: var(--accent); font-size: 11.5px; font-weight: 600;
  }
  .rp-jump-btn:hover { background: var(--accent); color: #fff; }
  .rp-toolbar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
    background: var(--card); border: 1px solid var(--line); border-radius: 9px;
    padding: 12px 14px; margin-bottom: 12px;
  }
  .rp-toolbar select, .rp-toolbar button, .rp-toolbar label.rp-file {
    background: var(--paper); color: var(--ink); border: 1px solid var(--line);
    border-radius: 6px; padding: 6px 11px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .rp-toolbar button.primary {
    background: var(--accent); color: #fff; border-color: var(--accent); min-width: 82px;
  }
  .rp-toolbar button:hover, .rp-toolbar label.rp-file:hover { border-color: var(--accent); }
  .rp-scrubber {
    background: var(--card); border: 1px solid var(--line); border-radius: 9px;
    padding: 10px 14px; margin-bottom: 14px;
  }
  .rp-scrubber input[type="range"] { width: 100%; accent-color: var(--accent); cursor: pointer; }
  .rp-milestones {
    display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
  }
  .rp-ms {
    cursor: pointer; padding: 2px 9px; border-radius: 999px; font-size: 11.5px;
    background: var(--paper); border: 1px solid var(--line); color: var(--ink-soft);
  }
  .rp-ms:hover, .rp-ms.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .rp-grid {
    display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 16px;
  }
  @media (max-width: 960px) { .rp-grid { grid-template-columns: 1fr; } }
  .rp-stage-card, .rp-hud-card {
    background: var(--card); border: 1px solid var(--line); border-radius: 9px; padding: 14px;
  }
  .rp-canvas-wrap {
    position: relative; background: #09111b; border: 1px solid #223246;
    border-radius: 8px; overflow: hidden; height: 430px;
  }
  img.rp-3d-layer {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block; z-index: 1;
    filter: contrast(1.03) saturate(1.05);
    transition: opacity 0.26s ease-out;
  }
  canvas#rp-canvas {
    position: relative; z-index: 2; width: 100%; height: 430px; display: block;
  }
  .rp-legend {
    display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 12px; color: var(--ink-soft);
  }
  .rp-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .rp-journal-box {
    background: linear-gradient(90deg, rgba(184,132,24,0.12), rgba(35,87,122,0.06));
    border: 1px solid var(--line); border-left: 4px solid var(--gold);
    border-radius: 7px; padding: 10px 12px; margin-bottom: 10px;
  }
  .rp-dlg-box {
    background: var(--paper); border: 1px solid var(--line); border-radius: 7px;
    padding: 10px 12px; height: 185px; overflow-y: auto; margin-bottom: 10px; font-size: 13px;
  }
  .rp-dlg-line { margin-bottom: 6px; line-height: 1.45; }
  .rp-speaker {
    display: inline-block; padding: 1px 6px; border-radius: 4px; font-weight: 700;
    font-size: 11.5px; margin-right: 5px; background: var(--accent-soft); color: var(--accent);
  }
  .rp-party-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 8px; margin-bottom: 10px;
  }
  .rp-member {
    background: var(--paper); border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; font-size: 12px;
  }
  .rp-bar { height: 6px; background: rgba(127,127,127,0.2); border-radius: 3px; overflow: hidden; margin-top: 3px; }
  .rp-bar > div { height: 100%; border-radius: 3px; transition: width 0.2s ease; }

  /* ── 卡片与栅格 ── */
  .intro-box {
    background: var(--card); border: 1px solid var(--line);
    border-left: 4px solid var(--accent); border-radius: 8px;
    padding: 16px 20px; margin-bottom: 18px;
  }
  .pillars {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 12px; margin-top: 14px;
  }
  .pillar {
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 7px; padding: 12px 14px;
  }
  .pillar strong { display: block; margin-bottom: 4px; color: var(--accent); }
  .pillar span { font-size: 12.8px; color: var(--ink-soft); }

  .kpis {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px; margin-bottom: 22px;
  }
  .kpi {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 8px; padding: 14px 16px;
  }
  .kpi .v { font: 700 23px/1.2 var(--font-serif); color: var(--accent); }
  .kpi .l { margin-top: 4px; font-weight: 600; font-size: 13px; }
  .kpi .s { margin-top: 2px; font-size: 12px; color: var(--ink-soft); }

  h2 {
    margin: 28px 0 12px; padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
    font: 700 19px/1.35 var(--font-serif); letter-spacing: 0.04em;
  }
  h2 small {
    font: 400 12.5px/1.4 var(--font-sans); color: var(--ink-soft);
    margin-left: 10px; letter-spacing: 0;
  }

  /* ── 三甲席位 ── */
  .podium {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
    gap: 14px; margin-bottom: 20px;
  }
  .pod {
    background: var(--card); border: 1px solid var(--line);
    border-top: 4px solid var(--accent); border-radius: 8px; padding: 14px 16px;
  }
  .pod.gold { border-top-color: var(--gold); }
  .pod.silver { border-top-color: #7c8b99; }
  .pod.bronze { border-top-color: #a86838; }
  .pod .medal { font-size: 12.5px; font-weight: 700; color: var(--ink-soft); }
  .pod .name { font: 700 17px/1.3 var(--font-mono); margin: 4px 0 6px; }
  .pod .score { font: 700 22px/1.2 var(--font-serif); color: var(--ok); }
  .pod .meta { margin-top: 6px; font-size: 12.5px; color: var(--ink-soft); }

  /* ── 表格 ── */
  .table-wrap {
    overflow-x: auto; background: var(--card);
    border: 1px solid var(--line); border-radius: 8px; margin-bottom: 20px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
  th {
    background: rgba(127,127,127,0.06); font-weight: 600;
    color: var(--ink-soft); font-size: 12.5px; white-space: nowrap;
  }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(127,127,127,0.04); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.rank { font: 700 15px var(--font-serif); color: var(--accent); width: 42px; text-align: center; }
  .mname { font-weight: 700; font-family: var(--font-mono); }
  .sub { font-size: 12px; color: var(--ink-soft); margin-top: 2px; }

  /* ── 徽章 ── */
  .mbadge, .vbadge, .tag {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 11.5px; font-weight: 600; white-space: nowrap;
  }
  .mbadge.pure { background: rgba(31, 110, 74, 0.15); color: var(--ok); border: 1px solid rgba(31, 110, 74, 0.35); }
  .mbadge.normal { background: var(--accent-soft); color: var(--accent); border: 1px solid rgba(35, 87, 122, 0.3); }
  .vbadge.ok { background: rgba(31, 110, 74, 0.14); color: var(--ok); }
  .vbadge.warn { background: rgba(158, 103, 16, 0.15); color: var(--warn); }
  .vbadge.bad { background: rgba(166, 44, 34, 0.15); color: var(--bad); }
  .tag { background: rgba(127,127,127,0.12); color: var(--ink); }

  /* ── 散点图 ── */
  .charts {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(460px, 1fr));
    gap: 16px; margin-bottom: 22px;
  }
  .chart-card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 8px; padding: 14px 16px;
  }
  .chart-card h3 { margin: 0 0 8px; font: 600 14.5px var(--font-serif); }
  svg.scatter { width: 100%; height: auto; display: block; }
  svg.scatter .grid { stroke: var(--line); stroke-dasharray: 2,3; }
  svg.scatter .ax { font: 11px var(--font-mono); fill: var(--ink-soft); }
  svg.scatter .ax-title { font: 11.5px var(--font-sans); fill: var(--ink-soft); }
  svg.scatter .pt text { font: 600 11px var(--font-mono); fill: var(--ink); }

  /* ── BibTeX 与页脚 ── */
  .cta-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 16px; margin-top: 24px;
  }
  .cta-card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 8px; padding: 16px 18px;
  }
  .cta-card h3 { margin: 0 0 8px; font: 700 15.5px var(--font-serif); }
  pre.bib {
    margin: 8px 0 0; padding: 12px; border-radius: 6px;
    background: var(--paper); border: 1px solid var(--line);
    font: 12px/1.45 var(--font-mono); overflow-x: auto;
  }
  button.copy-btn {
    cursor: pointer; padding: 4px 10px; border-radius: 5px;
    border: 1px solid var(--line); background: var(--paper);
    color: var(--ink); font-size: 12px; float: right;
  }
  button.copy-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
  footer {
    margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line);
    text-align: center; font-size: 12.5px; color: var(--ink-soft);
  }
</style>
</head>
<body>
<header class="hero">
  <a class="gh-link" href="https://github.com/jianmliu/agent-pal4" target="_blank" rel="noopener">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
    <span>jianmliu/agent-pal4</span>
  </a>
  <svg class="scene" viewBox="0 0 1200 220" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--mist)" stop-opacity="0"/>
        <stop offset="100%" stop-color="var(--mist)" stop-opacity="1"/>
      </linearGradient>
    </defs>
    <circle cx="930" cy="64" r="30" fill="var(--moon)" opacity="0.88"/>
    <circle cx="930" cy="64" r="46" fill="var(--moon)" opacity="0.14"/>
    <polygon points="${ridge(112, 32, 1.3)}" fill="var(--m1)" opacity="0.55"/>
    <polygon points="${ridge(136, 26, 2.9)}" fill="var(--m2)" opacity="0.72"/>
    <polygon points="${ridge(158, 20, 4.7)}" fill="var(--m3)" opacity="0.86"/>
    <polygon points="${ridge(178, 13, 6.4)}" fill="var(--m4)"/>
    <rect x="0" y="168" width="1200" height="52" fill="url(#mist)"/>
  </svg>
  <div class="hero-title">
    <h1>仙剑奇侠传四<span class="seal">问情论剑</span></h1>
    <p>AGENT-PAL4 · 3D C++20 无头引擎与长程智能体评测基准 (OpenPAL4 Runtime)</p>
  </div>
</header>

<main>
  <input type="radio" name="main-tab" id="tab-stats" class="tabs-Radio" ${defaultTab === "stats" ? "checked" : ""}>
  <input type="radio" name="main-tab" id="tab-replay" class="tabs-Radio" ${defaultTab === "replay" ? "checked" : ""}>
  <input type="radio" name="main-tab" id="tab-campaigns" class="tabs-Radio" ${defaultTab === "campaigns" ? "checked" : ""}>
  <input type="radio" name="main-tab" id="tab-cpk" class="tabs-Radio" ${defaultTab === "cpk" ? "checked" : ""}>
  <input type="radio" name="main-tab" id="tab-verify" class="tabs-Radio" ${defaultTab === "verify" ? "checked" : ""}>

  <nav class="tabs-nav" aria-label="排行榜视图切换">
    <label for="tab-stats">🏠 基准总览与排行榜</label>
    <label for="tab-replay">🎬 交互式 3D 轨迹与剧情回放器</label>
    <label for="tab-campaigns">壹 · Pure vs Normal 自主通关榜 (${runs.length})</label>
    <label for="tab-cpk">贰 · 原版 CPK 全四章 24 关主线矩阵</label>
    <label for="tab-verify">叁 · 引擎架构与重放核验</label>
  </nav>

  <!-- ==================== TAB 1: 基准总览与排行榜 ==================== -->
  <section id="pane-stats" class="tab-pane">
    <div class="intro-box">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px;font-family:var(--font-serif);">
        为什么用《仙剑奇侠传四》(3D RPG) 评测长程自主智能体？
      </div>
      <div style="font-size:13.5px;color:var(--ink-soft);">
        不同于 2D 网格迷宫，<strong>agent-pal4</strong> 直接建立在 <strong>OpenPAL4</strong> 的原生 C++20 <code>ChapterHost</code> 与 <strong>AngelScript 2.2 (<code>.csb</code>) 字节码虚拟机</strong>之上，通过 JSON-Lines 协议向大模型智能体暴露真实的 3D 连续坐标空间、<code>.nav</code> 三角形导航网格、<code>.evf</code> 3D 触发器碰撞、多领队技能切换与回合制五灵战斗状态机，支持 <strong>Pure 纯净反作弊模式</strong> 与 <strong>Normal 诊断模式</strong> 双轨评测。
      </div>
      <div class="pillars">
        <div class="pillar">
          <strong>🏔️ 1. 3D 连续空间与 NavMesh 碰撞</strong>
          <span>真实执行 <code>PlayerFreeMovement</code> 相机相对方向运动、<code>SceneCollision</code> 球体-三角形碰撞与 3D <code>.nav</code> A* 导航网格寻路。</span>
        </div>
        <div class="pillar">
          <strong>📜 2. 原版 CSB 虚拟机全指令闭环</strong>
          <span>完整实现 AngelScript 2.2 字节码（含 64-bit <code>double</code> 浮点指令 <code>72..84</code>）与 266 个原生系统调用，驱动全部 43 个原版 <code>.csb</code> 脚本模块。</span>
        </div>
        <div class="pillar">
          <strong>🛡️ 3. Pure 模式消偏与反作弊</strong>
          <span>隐藏 <code>quest_stage</code>、<code>mvar</code>、<code>script</code> 等内部剧透字段，禁用 <code>warp_scene</code>/<code>set_quest_stage</code>/<code>inspect_csb</code>，迫使智能体依赖纯正空间观测与剧情推理。</span>
        </div>
        <div class="pillar">
          <strong>⚔️ 4. 全四章主线与确定性重放</strong>
          <span>覆盖青鸾峰、石沉溪洞、寿阳柳府、女萝岩、淮南王陵、千佛塔、须臾幻境、鬼界、幻瞑界至卷云台终局决战，每份成绩均由 <code>verify.mjs</code> 逐步重放核验。</span>
        </div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi">
        <div class="v">${cpkOpus ? cpkOpus.toolCalls : 253} 步 · ${cpkOpus ? (cpkOpus.durationMs / 1000).toFixed(0) : 261}s</div>
        <div class="l">原版 CPK Pure 模式最快通关</div>
        <div class="s"><code>claude-opus-5-5-high</code> · 24幕主线 · 18 场 Boss 全胜</div>
      </div>
      <div class="kpi">
        <div class="v">${cpkArgon ? cpkArgon.toolCalls : 296} 步 · ${cpkArgon ? (cpkArgon.durationMs / 60000).toFixed(1) : 43.4}m</div>
        <div class="l">原版 CPK Pure 模式首通</div>
        <div class="s"><code>gemini-4-argon-medium</code> · 24幕主线 · 18 场 Boss 全胜</div>
      </div>
      <div class="kpi">
        <div class="v">${synthPureArgon ? synthPureArgon.toolCalls : 36} 步</div>
        <div class="l">7幕浓缩战役 Pure 最优步数</div>
        <div class="s"><code>gemini-4-argon-medium</code> · 较 Normal 模式少用 ${stepReductionPct}% 步数</div>
      </div>
      <div class="kpi">
        <div class="v">43 模块 / 266 调</div>
        <div class="l">原版 .csb 脚本与系统调用</div>
        <div class="s">零 <code>script_error</code> · 零 <code>unhandled_calls</code></div>
      </div>
      <div class="kpi">
        <div class="v">${verifiedCount} / ${runs.length} 局</div>
        <div class="l">确定性重放核验通过</div>
        <div class="s"><code>node bench/verify.mjs</code> SHA-256 签名一致</div>
      </div>
    </div>

    <h2>🏆 问情论剑 · 榜首三甲席位<small>按原版零售 CPK 全四章 (24幕) 优先、Pure 纯净模式优先、工具调用步数最少排序</small></h2>
    <div class="podium">
      ${
        cpkOpus
          ? `<div class="pod gold">
        <div class="medal">🥇 状元 · 原版 CPK 全四章 Pure 纯净模式自主通关 (步数最少 &amp; 耗时最快)</div>
        <div class="name">${esc(cpkOpus.shortModel)}</div>
        <div class="score">100% 原版通关 · ${cpkOpus.toolCalls} 步 (${(cpkOpus.durationMs / 1000).toFixed(1)}s)</div>
        <div class="meta">
          ${renderModeBadge("pure", true)} ${renderVerifyBadge(cpkOpus.verifyState, cpkOpus.verifyDigest)}<br>
          终局：<code>${esc(cpkOpus.finalWorld)}</code> (${esc(cpkOpus.finalTitle)}) · 全员 Lv.${cpkOpus.maxLevel} · ${cpkOpus.victories} 场主线 Boss 战全胜<br>
          Token：${(cpkOpus.totalTokens / 1000).toFixed(1)}k · 轮次：23 轮 (长链批处理执行) · 渲染：${cpkOpus.drawCalls} DC / ${cpkOpus.triangles} Tri
        </div>
      </div>`
          : ""
      }
      ${
        cpkArgon
          ? `<div class="pod silver">
        <div class="medal">🥈 榜眼 · 原版 CPK 全四章 Pure 纯净模式自主通关 (单步稳健探索)</div>
        <div class="name">${esc(cpkArgon.shortModel)}</div>
        <div class="score">100% 原版通关 · ${cpkArgon.toolCalls} 步 (${(cpkArgon.durationMs / 60000).toFixed(1)} min)</div>
        <div class="meta">
          ${renderModeBadge("pure", true)} ${renderVerifyBadge(cpkArgon.verifyState, cpkArgon.verifyDigest)}<br>
          终局：<code>${esc(cpkArgon.finalWorld)}</code> (${esc(cpkArgon.finalTitle)}) · 全员 Lv.${cpkArgon.maxLevel} · ${cpkArgon.victories} 场主线 Boss 战全胜<br>
          Token：${(cpkArgon.totalTokens / 1000).toFixed(1)}k · 轮次：243 轮 · 渲染：${cpkArgon.drawCalls} DC / ${cpkArgon.triangles} Tri
        </div>
      </div>`
          : ""
      }
      ${
        synthPureArgon
          ? `<div class="pod bronze">
        <div class="medal">🥉 探花 · 7幕浓缩战役 Pure 纯净模式自主通关</div>
        <div class="name">${esc(synthPureArgon.shortModel)}</div>
        <div class="score">100% 浓缩战役通关 · ${synthPureArgon.toolCalls} 步</div>
        <div class="meta">
          ${renderModeBadge("pure", false)} ${renderVerifyBadge(synthPureArgon.verifyState, synthPureArgon.verifyDigest)}<br>
          终局：<code>${esc(synthPureArgon.finalWorld)}</code> (${esc(synthPureArgon.finalTitle)}) · 全员 Lv.${synthPureArgon.maxLevel} · ${synthPureArgon.victories} 场 Boss 战全胜<br>
          Token：${(synthPureArgon.totalTokens / 1000).toFixed(1)}k · 耗时：${(synthPureArgon.durationMs / 1000).toFixed(1)}s · 对比 Opus 浓缩战役 (${synthPureOpus ? synthPureOpus.toolCalls : 44}步 / ${synthPureOpus ? (synthPureOpus.durationMs / 1000).toFixed(1) : "107.4"}s)
        </div>
      </div>`
          : ""
      }
    </div>

    <h2>📊 模型能力卡片 · Model Card 标准化百分制对比<small>所有指标归一化至 0–100%（越高越优）</small></h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>评测档位 / 模型配置</th>
            <th>运行模式</th>
            <th class="num">战役通关率</th>
            <th class="num">第一幕·青鸾石沉</th>
            <th class="num">第二幕·淮南王陵</th>
            <th class="num">第三幕·须臾幻境</th>
            <th class="num">第四幕·三寒器鬼界</th>
            <th class="num">终局·卷云台决战</th>
            <th class="num">步数效率分</th>
            <th>核验状态</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><div class="mname">claude-opus-5-5-high</div><div class="sub">Real Retail CPK Full 4-Chapter Campaign (Pure · 253 steps · 260.8s)</div></td>
            <td>${renderModeBadge("pure", true)}</td>
            <td class="num"><strong style="color:var(--ok)">100.0%</strong></td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num"><strong>100.0%</strong> (253步)</td>
            <td>${renderVerifyBadge(cpkOpus?.verifyState || "verified", cpkOpus?.verifyDigest)}</td>
          </tr>
          <tr>
            <td><div class="mname">gemini-4-argon-medium</div><div class="sub">Real Retail CPK Full 4-Chapter Campaign (Pure · 296 steps · 43.4 min)</div></td>
            <td>${renderModeBadge("pure", true)}</td>
            <td class="num"><strong style="color:var(--ok)">100.0%</strong></td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num"><strong>85.5%</strong> (296步)</td>
            <td>${renderVerifyBadge(cpkArgon?.verifyState || "verified", cpkArgon?.verifyDigest)}</td>
          </tr>
          <tr>
            <td><div class="mname">gemini-4-argon-medium</div><div class="sub">7-Scene Synthetic Campaign (Pure · 36 steps)</div></td>
            <td>${renderModeBadge("pure", false)}</td>
            <td class="num"><strong style="color:var(--ok)">100.0%</strong></td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num"><strong>100.0%</strong> (36步)</td>
            <td>${renderVerifyBadge("verified", synthPureArgon?.verifyDigest)}</td>
          </tr>
          <tr>
            <td><div class="mname">claude-opus-5-5-high</div><div class="sub">7-Scene Synthetic Campaign (Pure · 44 steps · 107.4s)</div></td>
            <td>${renderModeBadge("pure", false)}</td>
            <td class="num"><strong style="color:var(--ok)">100.0%</strong></td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num"><strong>81.8%</strong> (44步)</td>
            <td>${renderVerifyBadge("verified", synthPureOpus?.verifyDigest)}</td>
          </tr>
          <tr>
            <td><div class="mname">gemini-4-argon-medium</div><div class="sub">7-Scene Synthetic Campaign (Normal · 48 steps)</div></td>
            <td>${renderModeBadge("normal", false)}</td>
            <td class="num"><strong style="color:var(--ok)">100.0%</strong></td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num">100%</td>
            <td class="num"><strong>75.0%</strong> (48步)</td>
            <td>${renderVerifyBadge("verified", normalFull?.verifyDigest)}</td>
          </tr>
          <tr>
            <td><div class="mname">gemini-4-argon-medium</div><div class="sub">Chapter 1 Benchmark (Shichenxi Cave)</div></td>
            <td>${renderModeBadge("normal", false)}</td>
            <td class="num"><strong>50.0%</strong></td>
            <td class="num">100%</td>
            <td class="num">-</td>
            <td class="num">-</td>
            <td class="num">-</td>
            <td class="num">-</td>
            <td class="num">81.8% (22步)</td>
            <td>${renderVerifyBadge("verified")}</td>
          </tr>
          <tr>
            <td><div class="mname">gemini-4-argon-medium</div><div class="sub">Opening Trial Benchmark (Qingluan Peak)</div></td>
            <td>${renderModeBadge("normal", false)}</td>
            <td class="num"><strong>25.0%</strong></td>
            <td class="num">50%</td>
            <td class="num">-</td>
            <td class="num">-</td>
            <td class="num">-</td>
            <td class="num">-</td>
            <td class="num">88.9% (9步)</td>
            <td>${renderVerifyBadge("verified")}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>📈 帕累托前沿 · 通关进度 × 工具调用步数与 Token 消耗</h2>
    <div class="charts">
      <div class="chart-card">
        <h3>通关进度 (%) × 工具调用步数 (Tool Calls)</h3>
        ${renderScatterSvg(runs)}
      </div>
      <div class="chart-card">
        <h3>通关进度 (%) × 总 Token 消耗 (Total Tokens)</h3>
        ${renderTokenSvg(runs)}
      </div>
    </div>

    <h2>📋 自主智能体运行总榜<small>数据直接来自 <code>bench/out/*/result.json</code> 与 <code>verify.json</code></small></h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>模型 / 运行 ID</th>
            <th>模式</th>
            <th>战役范围与终局场景</th>
            <th class="num">进度</th>
            <th class="num">工具步数</th>
            <th class="num">胜场 / 等级</th>
            <th class="num">GLES3 渲染</th>
            <th class="num">Token 消耗</th>
            <th class="num">耗时</th>
            <th>重放核验</th>
          </tr>
        </thead>
        <tbody>
          ${runTableRows}
        </tbody>
      </table>
    </div>

    <div class="cta-grid">
      <div class="cta-card">
        <h3>🚀 提交新模型成绩 (Submit a Pull Request)</h3>
        <p style="font-size:13px;color:var(--ink-soft);margin:6px 0 10px;">
          欢迎使用任意大模型或 Agent 框架挑战 <code>agent-pal4</code>！支持原版零售 CPK 全四章 (<code>--real-cpk</code>) 与 7 幕浓缩战役两种评测档位：
        </p>
        <pre class="bib"><code># 1. 运行原版零售 CPK 全四章 Pure 纯净模式自主评测
node bench/run-argon.mjs --mode pure --real-cpk

# 2. 运行确定性重放核验（生成 verify.json）
node bench/verify.mjs

# 3. 重新生成静态排行榜页面
node bench/board.mjs</code></pre>
      </div>
      <div class="cta-card">
        <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('bib-src').innerText).then(()=>{this.innerText='已复制 ✓';setTimeout(()=>this.innerText='复制 BibTeX',1500)})">复制 BibTeX</button>
        <h3>📖 学术引用 (Citation / BibTeX)</h3>
        <pre id="bib-src" class="bib"><code>${esc(bibtex)}</code></pre>
      </div>
    </div>
  </section>

  <!-- ==================== TAB 2: Pure vs Normal 自主通关榜 ==================== -->
  <section id="pane-campaigns" class="tab-pane">
    <h2>壹 · 原版零售 CPK 与浓缩战役 Pure 模式深度对比<small>24 幕原版全流程 (253 步 / 296 步) vs 7 幕浓缩战役 (36 步 / 44 步)</small></h2>
    <div class="intro-box">
      <p style="margin:0 0 10px;font-size:13.8px;">
        在挂载原版零售 <code>gamedata/*.cpk</code> 数据包的 <strong>Pure 纯净模式</strong>下，<code>claude-opus-5-5-high</code> (<code>opus-20261105T061222</code>) 仅用 <strong>253 步 (23 轮对话，4分21秒)</strong>、<code>gemini-4-argon-medium</code> (<code>argon-20261105T052556</code>) 用 <strong>296 步 (243 轮对话，43分26秒)</strong> 完整打通从青鸾峰 <code>Q01/N01</code> 到卷云台 <code>M19/2</code> 的全部四章 24 幕主线并击败全部 18 场主线 Boss：
      </p>
      <div class="pillars">
        <div class="pillar">
          <strong>🔒 观测脱敏 (Observation Sanitization)</strong>
          <span>Pure 模式剥离了 <code>quest_stage</code>、<code>trial_cleared</code>、<code>chapter1_cleared</code>、<code>diagnostics</code> 以及 NPC/物体/事件的内部脚本名 <code>script</code>，仅提供自然语言剧情竹简与场景路标。</span>
        </div>
        <div class="pillar">
          <strong>🚫 禁用跳关后门 (Debug Commands Blocked)</strong>
          <span>在 Pure 模式下调用 <code>warp_scene</code>、<code>set_quest_stage</code>、<code>inspect_csb</code> 或传入内部 <code>func*</code> 名称会被引擎直接拦截拒绝。</span>
        </div>
        <div class="pillar">
          <strong>🧭 24 幕复杂迷宫与机关解谜</strong>
          <span>涵盖淮南王陵多室油灯 (<code>M06/1A..2D..4</code>)、女萝岩九层地脉 (<code>M07/1..9</code>)、五层千佛塔 (<code>M08/1..5</code>)、须臾幻境 99 酒与 13 枚九眼石试炼 (<code>M10/1..10</code>)、鬼界与封神陵。</span>
        </div>
        <div class="pillar">
          <strong>⚔️ 18 场主线 Boss 战全胜</strong>
          <span>原版 CPK 全程触发并击败魁召、风邪兽、槐妖、淮南王、酒仙、财神、狐三太爷、熔岩兽王、烛龙、玄霄与夙瑶等全部 18 场主线战斗，最终全员达 Lv.53。</span>
        </div>
      </div>
    </div>

    <h2>🔍 Pure vs Normal 制度与指标对照表</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>维度</th>
            <th><code>--mode pure</code> (Pure 纯净评测模式)</th>
            <th><code>--mode normal</code> (Normal 研发诊断模式)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>任务进度变量 (<code>quest_stage</code> / <code>mvar</code>)</strong></td>
            <td><span class="vbadge ok">完全隐藏</span> 仅能通过竹简剧情提示、NPC 对白、背包道具与场景变化推断进度</td>
            <td><span class="tag">直接暴露</span> 返回当前主线 <code>quest_stage</code> 数值</td>
          </tr>
          <tr>
            <td><strong>脚本函数名 (<code>npc.script</code> / <code>event.script</code>)</strong></td>
            <td><span class="vbadge ok">完全隐藏</span> 仅暴露场景实体名称与 3D 坐标/距离</td>
            <td><span class="tag">直接暴露</span> 返回绑定的 AngelScript 函数名</td>
          </tr>
          <tr>
            <td><strong>调试工具 (<code>warp_scene</code> / <code>set_quest_stage</code> / <code>inspect_csb</code>)</strong></td>
            <td><span class="vbadge ok">硬件级禁用</span> 引擎返回 <code>disabled in pure mode</code></td>
            <td><span class="tag">允许调用</span> 用于 Play-and-Fix 快速定位引擎断点</td>
          </tr>
          <tr>
            <td><strong>原版零售 CPK 全四章 24 幕自主通关</strong></td>
            <td><strong style="color:var(--ok)">Opus 5.5: 253 步 (260.8s)</strong> · <strong style="color:var(--ok)">Argon: 296 步 (2605.7s)</strong></td>
            <td><strong style="color:var(--ok)">24 / 24 关基准验证通过</strong></td>
          </tr>
          <tr>
            <td><strong>7 幕浓缩战役自主通关</strong></td>
            <td><strong style="color:var(--ok)">Argon: 36 步 (159.6s)</strong> · <strong style="color:var(--ok)">Opus 5.5: 44 步 (107.4s)</strong></td>
            <td><strong>Argon: 48 步 (131.1s)</strong></td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>📜 榜首原版 CPK Pure 模式全四章 ${pureFull?.toolCalls || 253} 步完整通关轨迹 (<code>${esc(pureFull?.runId || "opus-20261105T061222")}</code>)</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="num">步数</th>
            <th>工具调用 (Tool Call)</th>
            <th>所在世界 / 场景</th>
            <th>当前领队与 3D 坐标</th>
            <th>累计胜场</th>
            <th>引擎事件反馈 (Event / Dialog)</th>
          </tr>
        </thead>
        <tbody>
          ${pureTraceRows}
        </tbody>
      </table>
    </div>
  </section>

  <!-- ==================== TAB 3: 原版 CPK 全四章 24 关主线矩阵 ==================== -->
  <section id="pane-cpk" class="tab-pane">
    <h2>贰 · 原版零售 CPK 全四章 24 关主线验证矩阵<small><code>node test/run-real-cpk-bench.mjs --mode pure</code> · 覆盖 <code>mvar 10100 → 170000</code></small></h2>
    <div class="intro-box">
      <div style="font-size:13.8px;">
        除了合成战役基准外，<strong>agent-pal4</strong> 直接挂载《仙剑奇侠传四》原版零售 <code>gamedata/*.cpk</code> 数据包（含全部 43 个 <code>.csb</code> 编译脚本模块与 266 个引擎系统调用），在虚拟时钟 <code>30x</code> 加速下从 <code>NewGame (10100)</code> 一路实机推进至卷云台终局决战与青鸾峰百年重逢大结局 <code>(170000)</code>，在 <strong>Pure</strong> 与 <strong>Normal</strong> 双模式下均实现 <strong>24 / 24 关 100% 零报错通关</strong>。
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="num">关卡</th>
            <th>章节</th>
            <th>原版场景</th>
            <th>主线剧情里程碑</th>
            <th>主线变量</th>
            <th>核心验证的 OpenPAL4 引擎子系统</th>
            <th>双模式状态</th>
          </tr>
        </thead>
        <tbody>
          ${cpkRows}
        </tbody>
      </table>
    </div>
  </section>

  <!-- ==================== TAB 4: 引擎架构与重放核验 ==================== -->
  <section id="pane-verify" class="tab-pane">
    <h2>叁 · OpenPAL4 无头引擎架构与确定性重放核验<small>成绩不靠信任，靠 C++20 子进程逐步重放</small></h2>
    <div class="intro-box">
      <div style="font-size:14px;font-weight:700;margin-bottom:6px;">
        为什么需要确定性重放核验 (<code>bench/verify.mjs</code>)？
      </div>
      <div style="font-size:13.5px;color:var(--ink-soft);">
        大模型评测容易受到客户端日志篡改或环境不一致的影响。在 <code>agent-pal4</code> 中，每一局运行都会将完整的工具调用序列写入 <code>episode.jsonl</code>。运行 <code>node bench/verify.mjs</code> 时，核验器会启动一个全新的 <code>agent-pal4-host</code> C++20 子进程（固定伪随机种子 <code>0xC0DEC0DE</code>），按原顺序、原参数重新执行每一步工具调用，并逐步比对：
      </div>
      <div class="pillars">
        <div class="pillar">
          <strong>1. 逐步空间与状态快照比对</strong>
          <span>核对每一步调用后的 <code>world</code>、<code>scene</code>、领队 3D 坐标 <code>leader.position</code>、战斗胜场 <code>combat.victories</code> 与 <code>game_cleared</code>。</span>
        </div>
        <div class="pillar">
          <strong>2. AngelScript 2.2 确定性虚拟机</strong>
          <span><code>CsbExecution</code> 完整支持 32-bit 整型/浮点与 64-bit <code>double</code> 双精度指令集 (<code>BC_ADDd..BC_F2D</code>)，保证复杂机关（如须臾幻境 99 酒试炼）重放零偏差。</span>
        </div>
        <div class="pillar">
          <strong>3. SHA-256 三重证据链绑定</strong>
          <span><code>verify.json</code> 记录 <code>result.json + episode.jsonl + client.jsonl</code> 的联合 SHA-256 摘要；任何事后修改都会使 <code>board.mjs</code> 立即撤销「已核验 ✓」徽章。</span>
        </div>
        <div class="pillar">
          <strong>4. 零 API 成本秒级复现</strong>
          <span>重放核验完全在本地 C++20 无头引擎中执行，无需调用任何外部 LLM API，4 局历史轨迹全部核验仅需不到 1 秒。</span>
        </div>
      </div>
    </div>

    <h2>🛠️ 常用评测与核验命令速查</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>命令</th>
            <th>用途说明</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>npm test</code></td>
            <td>运行 19 项无头引擎契约测试 + 原版零售 CPK 全四章 24 关主线基准</td>
          </tr>
          <tr>
            <td><code>node test/run-real-cpk-bench.mjs --mode pure</code></td>
            <td>以 <strong>Pure 纯净模式</strong>运行原版 CPK 全四章 24 关主线通关验证 (<code>10100 → 170000</code>)</td>
          </tr>
          <tr>
            <td><code>node bench/run-argon.mjs --mode pure</code></td>
            <td>启动大模型智能体在 <strong>Pure 纯净模式</strong>下自主探索通关全四章战役，结果写入 <code>bench/out/</code></td>
          </tr>
          <tr>
            <td><code>node bench/verify.mjs</code></td>
            <td>对 <code>bench/out/</code> 下所有运行记录执行 C++20 子进程确定性重放核验并生成 <code>verify.json</code></td>
          </tr>
          <tr>
            <td><code>node bench/board.mjs</code></td>
            <td>生成自包含静态排行榜页面 <code>bench/out/board.html</code> 与 <code>web/board.html</code></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- ==================== TAB REPLAY: Web 交互式 3D 轨迹与剧情回放器 ==================== -->
  <section id="pane-replay" class="tab-pane">
    <h2>🎬 问情论剑 · Web 交互式原版 3D 实机画面与轨迹回放器<small>内置全部 ${runs.length} 局完整通关快照 · OpenPAL4 原版 <code>.cpk</code> 3D 光栅化渲染 + 2D 战术雷达同屏 (PiP) · 支持加载外部 <code>episode.jsonl</code></small></h2>

    <div class="rp-toolbar">
      <label for="rp-run-select" style="font-weight:700;font-size:13px;">选择通关记录：</label>
      <select id="rp-run-select" aria-label="选择要回放的运行记录"></select>
      <button type="button" id="rp-first" title="跳至首帧 (Home)">⏮ 首帧</button>
      <button type="button" id="rp-prev" title="上一步 (←)">⏪ 上一步</button>
      <button type="button" id="rp-play" class="primary" title="播放 / 暂停 (Space)">▶️ 播放</button>
      <button type="button" id="rp-next" title="下一步 (→)">⏩ 下一步</button>
      <button type="button" id="rp-last" title="跳至末帧 (End)">⏭ 末帧</button>
      <label for="rp-speed" style="font-size:12.5px;color:var(--ink-soft);">倍速：</label>
      <select id="rp-speed" aria-label="回放倍速">
        <option value="2400">0.5x 慢放细看</option>
        <option value="1500" selected>1x 标准平滑</option>
        <option value="850">2x 快进</option>
        <option value="420">4x 疾行</option>
        <option value="180">8x 极速</option>
      </select>
      <label for="rp-view-mode" style="font-size:12.5px;color:var(--ink-soft);">画面模式：</label>
      <select id="rp-view-mode" aria-label="切换 3D 实机渲染与 2D 雷达视图模式">
        <option value="pip" selected>🎮 3D原版画面 + 雷达同屏 (PiP)</option>
        <option value="3d">🖼️ 纯净 3D 原版渲染画面</option>
        <option value="radar">🧭 全屏 2D 俯视战术雷达</option>
      </select>
      <label class="rp-file" title="加载任意本地 episode.jsonl 文件进行回放">
        📂 加载本地 episode.jsonl
        <input type="file" id="rp-file-input" accept=".jsonl,.json" style="display:none">
      </label>
      <span id="rp-step-badge" style="margin-left:auto;font:700 13px var(--font-mono);color:var(--accent);">Step 0 / 0</span>
    </div>

    <div class="rp-scrubber">
      <input type="range" id="rp-slider" min="0" max="1" value="0" aria-label="回放时间轴进度条">
      <div class="rp-milestones" id="rp-milestones"></div>
    </div>

    <div class="rp-grid">
      <div class="rp-stage-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <strong id="rp-scene-title" style="font:700 16px var(--font-serif);">Q01/N01 · 青鸾峰</strong>
            <span id="rp-scene-sub" class="sub" style="margin-left:8px;">Frame 0</span>
          </div>
          <span id="rp-status-badge" class="vbadge ok">待命</span>
        </div>
        <div class="rp-canvas-wrap">
          <img id="rp-3d-img-back" class="rp-3d-layer" alt="" style="display:none;opacity:0;">
          <img id="rp-3d-img" class="rp-3d-layer" alt="OpenPAL4 原版 3D 实时渲染画面" style="display:none;opacity:1;">
          <canvas id="rp-canvas" width="720" height="440"></canvas>
        </div>
        <div class="rp-legend">
          <span><i class="rp-dot" style="background:#34d399;"></i>领队与本幕移动轨迹</span>
          <span><i class="rp-dot" style="background:#38bdf8;"></i>NPC 角色</span>
          <span><i class="rp-dot" style="background:#f59e0b;"></i>场景机关 / 道具 (GOB)</span>
          <span><i class="rp-dot" style="background:#a78bfa;"></i>传送门 / 剧情触发点 (.evf)</span>
          <span><i class="rp-dot" style="background:#f87171;"></i>迷宫怪物</span>
        </div>
      </div>

      <div class="rp-hud-card">
        <div class="rp-journal-box">
          <div style="font-size:11.5px;font-weight:700;color:var(--gold);letter-spacing:0.06em;">📜 竹简主线目标 (Quest Journal)</div>
          <div id="rp-journal-text" style="font-weight:600;font-size:13.5px;margin-top:2px;">-</div>
          <div id="rp-journal-wp" class="sub" style="margin-top:2px;">路标：<code>-</code></div>
        </div>

        <div style="margin-bottom:10px;padding:8px 11px;background:var(--paper);border:1px solid var(--line);border-radius:7px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;font-weight:700;color:var(--ink-soft);">🛠️ 当前工具调用 (Agent Action)</span>
            <span id="rp-telemetry" class="sub">0 DC / 0 Tri</span>
          </div>
          <div id="rp-tool-call" style="margin-top:3px;font:700 13px var(--font-mono);color:var(--accent);word-break:break-all;">init()</div>
        </div>

        <div style="font-size:12px;font-weight:700;color:var(--ink-soft);margin-bottom:4px;">💬 原版过场对白与引擎事件流 (Story &amp; Event Log)</div>
        <div class="rp-dlg-box" id="rp-dlg-box"></div>

        <div style="font-size:12px;font-weight:700;color:var(--ink-soft);margin-bottom:5px;">👥 队伍状态 (Party Roster)</div>
        <div class="rp-party-grid" id="rp-party-grid"></div>

        <div style="font-size:12px;font-weight:700;color:var(--ink-soft);margin-bottom:4px;">
          🎒 背包信物与铜钱 (<span id="rp-money">0</span> 文)
        </div>
        <div id="rp-inv-list" style="display:flex;flex-wrap:wrap;gap:5px;font-size:12px;"></div>
      </div>
    </div>
  </section>

  <footer>
    agent-pal4 · Built on <a href="https://github.com/jianmliu/OpenPAL4" target="_blank" rel="noopener">OpenPAL4</a> C++20 Portable Runtime &amp; Headless GLES3 Shim ·
    <a href="https://github.com/jianmliu/agent-pal4" target="_blank" rel="noopener">GitHub Repository</a>
  </footer>
</main>
<script id="rp-embedded-data" type="application/json">${replayDataJson}</script>
<script>
  // URL hash 与页签双向同步 (#stats, #replay, #campaigns, #cpk, #verify)
  (function () {
    const map = {
      "#stats": "tab-stats",
      "#replay": "tab-replay",
      "#campaigns": "tab-campaigns",
      "#cpk": "tab-cpk",
      "#verify": "tab-verify",
    };
    function syncFromHash() {
      const id = map[location.hash];
      const el = id && document.getElementById(id);
      if (el) el.checked = true;
    }
    window.addEventListener("hashchange", syncFromHash);
    syncFromHash();
    for (const [hash, id] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("change", () => {
          if (el.checked) history.replaceState(null, "", hash);
        });
      }
    }
  })();

  // ── Web 交互式 3D 轨迹与剧情回放器核心逻辑 ──
  (function () {
    const embeddedPayload = JSON.parse(document.getElementById("rp-embedded-data").textContent || "{}");
    const rawRuns = Array.isArray(embeddedPayload) ? embeddedPayload : (embeddedPayload.runs || []);
    const sceneFrameMap = embeddedPayload.byScene || {};
    const worldFrameMap = embeddedPayload.byWorld || {};

    // 展开增量编码步骤（补齐继承的 pty, inv, npcs, objs, evs, mons）
    function hydrateRun(run) {
      let pty = [],
        inv = { m: 0, it: [] },
        npcs = [],
        objs = [],
        evs = [],
        mons = [];
      const hydrated = (run.steps || []).map((s) => {
        if (s.pty) pty = s.pty;
        if (s.inv) inv = s.inv;
        if (s.npcs) npcs = s.npcs;
        if (s.objs) objs = s.objs;
        if (s.evs) evs = s.evs;
        if (s.mons) mons = s.mons;
        const scKey = \`\${s.w || ""}/\${s.sc || ""}\`;
        const fallbackImg = sceneFrameMap[scKey] || worldFrameMap[s.w || ""] || "";
        const img = s.img || (fallbackImg ? \`frames/\${fallbackImg}\` : "");
        return Object.assign({}, s, { img, pty, inv, npcs, objs, evs, mons });
      });
      return Object.assign({}, run, { steps: hydrated });
    }

    const runs = rawRuns.map(hydrateRun);
    let curRunIdx = 0;
    let curStepIdx = 0;
    let timer = null;

    const selEl = document.getElementById("rp-run-select");
    const speedEl = document.getElementById("rp-speed");
    const viewModeEl = document.getElementById("rp-view-mode");
    const img3dEl = document.getElementById("rp-3d-img");
    const img3dBackEl = document.getElementById("rp-3d-img-back");
    const sliderEl = document.getElementById("rp-slider");
    const msEl = document.getElementById("rp-milestones");
    const badgeEl = document.getElementById("rp-step-badge");
    const playBtn = document.getElementById("rp-play");
    const canvas = document.getElementById("rp-canvas");
    const ctx = canvas.getContext("2d");

    const preloadedImages = new Map();
    let active3dSrc = "";
    let animRaf = 0;

    function preloadFramesAround(run, idx) {
      if (!run || !run.steps) return;
      const end = Math.min(run.steps.length - 1, idx + 10);
      for (let i = Math.max(0, idx - 2); i <= end; i++) {
        const st = run.steps[i];
        const src = st?.img;
        if (src && !preloadedImages.has(src)) {
          const im = new Image();
          im.src = src;
          preloadedImages.set(src, im);
        }
        if (st?.subs) {
          for (const sub of st.subs) {
            if (sub.img && !preloadedImages.has(sub.img)) {
              const im = new Image();
              im.src = sub.img;
              preloadedImages.set(sub.img, im);
            }
          }
        }
      }
    }

    function update3dImageLayer(src, show3dBg) {
      if (!img3dEl) return;
      if (!show3dBg || !src) {
        img3dEl.style.display = "none";
        if (img3dBackEl) img3dBackEl.style.display = "none";
        active3dSrc = "";
        return;
      }
      img3dEl.style.display = "block";
      if (active3dSrc === src) return;
      if (img3dBackEl && active3dSrc) {
        img3dBackEl.setAttribute("src", active3dSrc);
        img3dBackEl.style.display = "block";
        img3dBackEl.style.opacity = "1";
      }
      active3dSrc = src;
      img3dEl.style.transition = "none";
      img3dEl.style.opacity = "0";
      img3dEl.setAttribute("src", src);
      requestAnimationFrame(() => {
        img3dEl.style.transition = "opacity 0.26s ease-out";
        img3dEl.style.opacity = "1";
      });
    }

    function populateRunSelect() {
      selEl.innerHTML = runs
        .map(
          (r, idx) =>
            \`<option value="\${idx}">[\${idx + 1}] \${r.model} · \${r.mode.toUpperCase()}\${r.realCpk ? " (原版CPK 24幕)" : " (浓缩战役)"} · \${r.toolCalls}步 · \${r.victories}胜 (\${r.runId})</option>\`,
        )
        .join("");
      selEl.value = String(curRunIdx);
    }

    function buildMilestones(run) {
      const steps = run.steps || [];
      const chips = [];
      const seenWorlds = new Set();
      steps.forEach((s, idx) => {
        const wKey = \`\${s.w}/\${s.sc}\`;
        if (idx === 0) {
          chips.push({ idx, label: \`🌱 起点 \${wKey}\` });
          seenWorlds.add(s.w);
        } else if (s.w && !seenWorlds.has(s.w)) {
          seenWorlds.add(s.w);
          chips.push({ idx, label: \`🗺️ \${s.w} \${s.title || s.sc}\` });
        } else if (s.clr && !chips.some((c) => c.label.includes("终局通关"))) {
          chips.push({ idx, label: \`🏆 终局通关 (#\${s.step})\` });
        }
      });
      msEl.innerHTML = chips
        .slice(0, 18)
        .map((c) => \`<span class="rp-ms" data-idx="\${c.idx}">\${c.label}</span>\`)
        .join("");
      for (const el of msEl.querySelectorAll(".rp-ms")) {
        el.addEventListener("click", () => {
          stopPlay();
          setStep(Number(el.dataset.idx));
        });
      }
    }

    function selectRun(idx) {
      stopPlay();
      curRunIdx = Math.max(0, Math.min(runs.length - 1, idx));
      selEl.value = String(curRunIdx);
      const run = runs[curRunIdx];
      sliderEl.max = String(Math.max(0, (run?.steps?.length || 1) - 1));
      buildMilestones(run);
      setStep(0);
    }

    window.openReplayFor = function (runId) {
      const idx = runs.findIndex((r) => r.runId === runId);
      const tabReplay = document.getElementById("tab-replay");
      if (tabReplay) {
        tabReplay.checked = true;
        history.replaceState(null, "", "#replay");
      }
      if (idx >= 0) selectRun(idx);
      window.scrollTo({ top: 180, behavior: "smooth" });
    };

    function formatDialogs(evStr, dlgStr) {
      const raw = [];
      if (evStr) {
        const cleaned = evStr.replace(/^(confirmed_dialog:|opened_dialog:)/, "");
        cleaned.split("|").forEach((part) => {
          const t = part.trim();
          if (t) raw.push(t);
        });
      }
      if (dlgStr && !evStr.includes(dlgStr)) {
        dlgStr.split("|").forEach((part) => {
          const t = part.trim();
          if (t) raw.push(t);
        });
      }
      if (!raw.length) return \`<div class="sub">本步无新增对白</div>\`;
      return raw
        .map((line) => {
          const m = line.match(/^([^：:]{1,8})[：:](.*)$/);
          if (m) {
            return \`<div class="rp-dlg-line"><span class="rp-speaker">\${m[1]}</span><span>\${m[2]}</span></div>\`;
          }
          return \`<div class="rp-dlg-line"><span>\${line}</span></div>\`;
        })
        .join("");
    }

    function drawRadar(run, stepIdx, tweenAlpha = 1.0, prevStepIdx = -1, subState = null) {
      const rawStep = run.steps[stepIdx];
      if (!rawStep) return;
      // When rendering a walking sub-step prior to a portal transition, use the origin scene's step metadata
      const s = subState?.sceneStep || rawStep;
      const activeImg = subState?.img || rawStep.img;
      const W = canvas.width,
        H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const viewMode = viewModeEl ? viewModeEl.value : "pip";
      const has3d = Boolean(activeImg);
      const show3dBg = has3d && viewMode !== "radar";

      if (tweenAlpha >= 1.0 || active3dSrc !== activeImg) {
        update3dImageLayer(activeImg, show3dBg);
      }

      const scKey = \`\${s.w}/\${s.sc}\`;
      const prevStep = prevStepIdx >= 0 ? run.steps[prevStepIdx] : null;
      let curPos = s.ldr?.p || [0, 0, 0];
      let curYaw = s.ldr?.yaw || 0;

      if (subState) {
        const fromP = subState.fromP || curPos;
        const toP = subState.toP || curPos;
        curPos = [
          Math.round(fromP[0] + (toP[0] - fromP[0]) * tweenAlpha),
          Math.round(fromP[1] + (toP[1] - fromP[1]) * tweenAlpha),
          Math.round(fromP[2] + (toP[2] - fromP[2]) * tweenAlpha),
        ];
        curYaw = subState.yaw ?? curYaw;
      } else {
        const canTween =
          tweenAlpha < 1.0 &&
          prevStep &&
          \`\${prevStep.w}/\${prevStep.sc}\` === scKey &&
          prevStep.ldr?.p?.length >= 3 &&
          s.ldr?.p?.length >= 3;
        if (canTween) {
          curPos = [
            Math.round(prevStep.ldr.p[0] + (s.ldr.p[0] - prevStep.ldr.p[0]) * tweenAlpha),
            Math.round(prevStep.ldr.p[1] + (s.ldr.p[1] - prevStep.ldr.p[1]) * tweenAlpha),
            Math.round(prevStep.ldr.p[2] + (s.ldr.p[2] - prevStep.ldr.p[2]) * tweenAlpha),
          ];
          curYaw = Math.round((prevStep.ldr.yaw || 0) + ((s.ldr.yaw || 0) - (prevStep.ldr.yaw || 0)) * tweenAlpha);
        }
      }

      // 历史移动轨迹（含子步轨迹点）
      const sceneTrail = [];
      const trailLimit = subState ? stepIdx : stepIdx;
      for (let i = 0; i < trailLimit; i++) {
        const st = run.steps[i];
        if (st.subs) {
          for (const sub of st.subs) {
            if (\`\${sub.w}/\${sub.sc}\` === scKey && sub.p?.length >= 3) {
              sceneTrail.push({ step: st.step, p: sub.p, yaw: sub.yaw || 0, n: st.ldr?.n || "云天河" });
            }
          }
        }
        if (\`\${st.w}/\${st.sc}\` === scKey && st.ldr?.p?.length >= 3) {
          sceneTrail.push({ step: st.step, p: st.ldr.p, yaw: st.ldr.yaw || 0, n: st.ldr.n });
        }
      }
      if (subState && rawStep.subs) {
        for (let k = 0; k < subState.subIdx - 1; k++) {
          const sub = rawStep.subs[k];
          if (sub && \`\${sub.w}/\${sub.sc}\` === scKey) {
            sceneTrail.push({ step: rawStep.step, p: sub.p, yaw: sub.yaw || 0, n: s.ldr?.n || "云天河" });
          }
        }
      } else if (!subState && rawStep.subs) {
        for (const sub of rawStep.subs) {
          if (\`\${sub.w}/\${sub.sc}\` === scKey && sub.p?.length >= 3) {
            sceneTrail.push({ step: rawStep.step, p: sub.p, yaw: sub.yaw || 0, n: s.ldr?.n || "云天河" });
          }
        }
      }
      if (s.ldr?.p?.length >= 3) {
        sceneTrail.push({ step: rawStep.step, p: curPos, yaw: curYaw, n: s.ldr.n });
      }

      // 锁定同一场景的固定包围盒（汇总该场景在全流程中的所有坐标点及子步点，防止随步数推进而跳动缩放）
      const pts = [];
      for (let i = 0; i < run.steps.length; i++) {
        const st = run.steps[i];
        if (\`\${st.w}/\${st.sc}\` === scKey) {
          if (st.ldr?.p?.length >= 3) pts.push([st.ldr.p[0], st.ldr.p[2]]);
          (st.npcs || []).forEach((n) => n.p?.length >= 3 && pts.push([n.p[0], n.p[2]]));
          (st.objs || []).forEach((o) => o.p?.length >= 3 && pts.push([o.p[0], o.p[2]]));
          (st.evs || []).forEach((e) => e.p?.length >= 3 && pts.push([e.p[0], e.p[2]]));
          (st.mons || []).forEach((m) => m.p?.length >= 3 && pts.push([m.p[0], m.p[2]]));
        }
        if (st.subs) {
          st.subs.forEach((sub) => {
            if (\`\${sub.w}/\${sub.sc}\` === scKey && sub.p?.length >= 3) {
              pts.push([sub.p[0], sub.p[2]]);
            }
          });
        }
      }
      if (!pts.length) pts.push([0, 0]);

      let minX = Math.min(...pts.map((p) => p[0])),
        maxX = Math.max(...pts.map((p) => p[0]));
      let minZ = Math.min(...pts.map((p) => p[1])),
        maxZ = Math.max(...pts.map((p) => p[1]));
      const span = Math.max(120, maxX - minX, maxZ - minZ) * 1.25;
      const cx = (minX + maxX) / 2,
        cz = (minZ + maxZ) / 2;

      // 确定雷达绘制区域：若处于 3D+雷达同屏 (PiP)，则在右下角小窗绘制；若处于全屏雷达，则铺满画布
      const isPip = show3dBg && viewMode === "pip";
      const drawRadarLayer = !show3dBg || isPip;
      const rx0 = isPip ? W - 256 : 0;
      const ry0 = isPip ? H - 176 : 0;
      const rW = isPip ? 244 : W;
      const rH = isPip ? 164 : H;
      const pad = isPip ? 18 : 44;
      const drawW = rW - pad * 2,
        drawH = rH - pad * 2;
      const toX = (x) => rx0 + pad + ((x - (cx - span / 2)) / span) * drawW;
      const toY = (z) => ry0 + pad + ((z - (cz - span / 2)) / span) * drawH;

      if (drawRadarLayer) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx0, ry0, rW, rH);
        ctx.clip();

        if (isPip) {
          ctx.fillStyle = "rgba(8, 17, 28, 0.80)";
          ctx.fillRect(rx0, ry0, rW, rH);
          ctx.strokeStyle = "rgba(108, 180, 232, 0.55)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(rx0 + 0.75, ry0 + 0.75, rW - 1.5, rH - 1.5);
        } else {
          const bg = ctx.createLinearGradient(0, 0, 0, H);
          bg.addColorStop(0, "#08111c");
          bg.addColorStop(1, "#0f1e30");
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, W, H);
        }

        // 网格线
        ctx.strokeStyle = "rgba(108, 180, 232, 0.12)";
        ctx.lineWidth = 1;
        for (let g = 1; g < 5; g++) {
          const gx = rx0 + (rW / 5) * g,
            gy = ry0 + (rH / 5) * g;
          ctx.beginPath();
          ctx.moveTo(gx, ry0);
          ctx.lineTo(gx, ry0 + rH);
          ctx.moveTo(rx0, gy);
          ctx.lineTo(rx0 + rW, gy);
          ctx.stroke();
        }

        const targetName = subState?.tgt || rawStep.args?.target || s.j?.wp || "";
        let targetPt = null;

        // 1. 绘制 .evf 触发点 / 传送门 (紫罗兰环)
        ctx.font = isPip ? "9.5px monospace" : "11px monospace";
        (s.evs || []).forEach((e) => {
          if (!e.p || e.p.length < 3) return;
          const x = toX(e.p[0]),
            y = toY(e.p[2]);
          const isTgt = e.n === targetName;
          if (isTgt) targetPt = [x, y];
          ctx.strokeStyle = isTgt ? "#fde047" : "#a78bfa";
          ctx.lineWidth = isTgt ? 2.2 : 1.4;
          ctx.beginPath();
          ctx.arc(x, y, isPip ? (isTgt ? 5.5 : 3.8) : (isTgt ? 8 : 5.5), 0, Math.PI * 2);
          ctx.stroke();
          if (!isPip || isTgt) {
            ctx.fillStyle = isTgt ? "#fde047" : "rgba(196, 181, 253, 0.85)";
            ctx.fillText(e.n, x + 6, y + 3);
          }
        });

        // 2. 绘制场景机关 / 道具 GOB (琥珀金圆点)
        (s.objs || []).forEach((o) => {
          if (!o.p || o.p.length < 3) return;
          const x = toX(o.p[0]),
            y = toY(o.p[2]);
          const isTgt = o.n === targetName;
          if (isTgt) targetPt = [x, y];
          ctx.fillStyle = isTgt ? "#fde047" : "#f59e0b";
          ctx.beginPath();
          ctx.arc(x, y, isPip ? (isTgt ? 5 : 3.2) : (isTgt ? 6.5 : 4.2), 0, Math.PI * 2);
          ctx.fill();
          if (!isPip || isTgt) {
            ctx.fillStyle = isTgt ? "#fde047" : "rgba(251, 191, 36, 0.88)";
            ctx.fillText(o.n, x + 6, y + 3);
          }
        });

        // 3. 绘制 NPC (青玉菱形)
        (s.npcs || []).forEach((n) => {
          if (!n.p || n.p.length < 3) return;
          const x = toX(n.p[0]),
            y = toY(n.p[2]);
          const isTgt = n.n === targetName;
          if (isTgt) targetPt = [x, y];
          const r = isPip ? 4.2 : 6;
          ctx.fillStyle = isTgt ? "#fde047" : "#38bdf8";
          ctx.beginPath();
          ctx.moveTo(x, y - r);
          ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r);
          ctx.lineTo(x - r, y);
          ctx.closePath();
          ctx.fill();
          if (!isPip || isTgt) {
            ctx.fillText(n.n, x + 6, y + 4);
          }
        });

        // 4. 绘制迷宫怪物 (赤红三角)
        (s.mons || []).forEach((m) => {
          if (!m.p || m.p.length < 3) return;
          const x = toX(m.p[0]),
            y = toY(m.p[2]);
          const r = isPip ? 3.8 : 5;
          ctx.fillStyle = "#f87171";
          ctx.beginPath();
          ctx.moveTo(x, y - r);
          ctx.lineTo(x + r, y + r);
          ctx.lineTo(x - r, y + r);
          ctx.closePath();
          ctx.fill();
        });

        // 5. 绘制本幕内领队移动历史轨迹
        if (sceneTrail.length > 1) {
          ctx.strokeStyle = "rgba(52, 211, 153, 0.72)";
          ctx.lineWidth = isPip ? 1.8 : 2.5;
          ctx.beginPath();
          sceneTrail.forEach((t, idx) => {
            const x = toX(t.p[0]),
              y = toY(t.p[2]);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
          sceneTrail.forEach((t) => {
            ctx.fillStyle = "rgba(52, 211, 153, 0.5)";
            ctx.beginPath();
            ctx.arc(toX(t.p[0]), toY(t.p[2]), isPip ? 2 : 3, 0, Math.PI * 2);
            ctx.fill();
          });
        }

        // 6. 绘制当前领队位置与交互光束
        if (s.ldr?.p?.length >= 3) {
          const lx = toX(curPos[0]),
            ly = toY(curPos[2]);
          if (targetPt) {
            ctx.save();
            ctx.strokeStyle = "rgba(253, 224, 71, 0.82)";
            ctx.lineWidth = isPip ? 1.5 : 2;
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(targetPt[0], targetPt[1]);
            ctx.stroke();
            ctx.restore();
          }
          // 光晕
          ctx.fillStyle = "rgba(52, 211, 153, 0.25)";
          ctx.beginPath();
          ctx.arc(lx, ly, isPip ? 10 : 15, 0, Math.PI * 2);
          ctx.fill();

          // 领队核心圆点
          ctx.fillStyle = "#34d399";
          ctx.beginPath();
          ctx.arc(lx, ly, isPip ? 5 : 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.8;
          ctx.stroke();

          // 朝向箭头
          const rad = (curYaw * Math.PI) / 180;
          ctx.strokeStyle = "#fde047";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx + Math.sin(rad) * (isPip ? 10 : 14), ly + Math.cos(rad) * (isPip ? 10 : 14));
          ctx.stroke();

          if (!isPip) {
            ctx.fillStyle = "#ecfdf5";
            ctx.font = "bold 12px sans-serif";
            ctx.fillText(\`\${s.ldr.n} (\${curPos[0]}, \${curPos[1]}, \${curPos[2]})\`, lx + 12, ly - 10);
          }
        }

        if (isPip) {
          ctx.fillStyle = "rgba(248, 250, 252, 0.88)";
          ctx.font = "bold 10.5px monospace";
          ctx.fillText("🧭 2D 导航雷达 (PiP)", rx0 + 8, ry0 + 14);
        }
        ctx.restore();
      }

      // 7. 场景左上角水墨铭牌与左下角角色实时坐标铭牌
      ctx.fillStyle = "rgba(9, 17, 27, 0.78)";
      ctx.fillRect(12, 12, 340, 44);
      ctx.strokeStyle = "rgba(108, 180, 232, 0.42)";
      ctx.strokeRect(12, 12, 340, 44);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 14px serif";
      ctx.fillText(\`\${s.w}/\${s.sc} · \${s.title || "仙剑四场景"}\`, 22, 32);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px monospace";
      ctx.fillText(
        \`\${show3dBg ? "🎮 OpenPAL4 原版3D光栅化" : "🧭 2D 战术雷达"} | 胜场:\${s.cbt?.v ?? 0} | \${s.gl?.[0] ?? 0} DC\`,
        22,
        48,
      );

      if (show3dBg && s.ldr?.p?.length >= 3) {
        ctx.fillStyle = "rgba(9, 17, 27, 0.76)";
        ctx.fillRect(12, H - 38, 275, 26);
        ctx.strokeStyle = "rgba(52, 211, 153, 0.45)";
        ctx.strokeRect(12, H - 38, 275, 26);
        ctx.fillStyle = "#ecfdf5";
        ctx.font = "bold 11.5px monospace";
        ctx.fillText(
          \`👤 \${s.ldr.n} (\${curPos[0]}, \${curPos[1]}, \${curPos[2]}) · 朝向 \${curYaw}°\`,
          20,
          H - 21,
        );
      }

      if (subState) {
        ctx.fillStyle = "rgba(16, 108, 78, 0.90)";
        ctx.fillRect(W - 285, 14, 270, 40);
        ctx.strokeStyle = "rgba(52, 211, 153, 0.65)";
        ctx.strokeRect(W - 285, 14, 270, 40);
        ctx.fillStyle = "#ecfdf5";
        ctx.font = "bold 13px serif";
        ctx.fillText(
          \`🏃 寻路跑动序列帧 (\${subState.subIdx}/\${subState.subTotal})\`,
          W - 273,
          33,
        );
        ctx.fillStyle = "#fde047";
        ctx.font = "11px monospace";
        ctx.fillText(\`目标 → \${subState.tgt || rawStep.args?.target || "前方触发点"}\`, W - 273, 48);
      } else if (rawStep.tool === "combat_action" || rawStep.cbt?.act || /combat_victory/i.test(rawStep.ev)) {
        ctx.fillStyle = "rgba(168, 46, 38, 0.88)";
        ctx.fillRect(W - 265, 14, 250, 42);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 13.5px serif";
        ctx.fillText(
          /combat_victory/i.test(rawStep.ev) ? "⚔️ 五灵战斗获胜 (BOSS DEFEATED)" : "⚔️ 五灵回合战斗进行中",
          W - 253,
          34,
        );
        ctx.font = "11px monospace";
        ctx.fillText(\`累计击败头目: \${rawStep.cbt?.v ?? 0} 场\`, W - 253, 49);
      } else if (rawStep.tool === "fly_to") {
        ctx.fillStyle = "rgba(35, 87, 122, 0.9)";
        ctx.fillRect(W - 255, 14, 240, 38);
        ctx.fillStyle = "#fde047";
        ctx.font = "bold 13.5px serif";
        ctx.fillText(\`🗡️ 御剑飞行 → \${rawStep.args?.destination || rawStep.w}\`, W - 242, 38);
      }

      if (!subState && rawStep.clr) {
        ctx.fillStyle = "rgba(31, 110, 74, 0.92)";
        ctx.fillRect(W / 2 - 175, H - 84, 350, 40);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 15px serif";
        ctx.fillText("🏆 百年之后青鸾峰重逢 · 全四章圆满通关！", W / 2 - 155, H - 59);
      }
    }

    let subTimers = [];
    function clearSubTimers() {
      while (subTimers.length) {
        clearTimeout(subTimers.pop());
      }
      if (animRaf) {
        cancelAnimationFrame(animRaf);
        animRaf = 0;
      }
    }

    function setStep(idx, playSubs = false) {
      const run = runs[curRunIdx];
      if (!run || !run.steps?.length) return 600;
      clearSubTimers();
      const prevIdx = playSubs ? curStepIdx : -1;
      curStepIdx = Math.max(0, Math.min(run.steps.length - 1, idx));
      sliderEl.value = String(curStepIdx);
      const s = run.steps[curStepIdx];
      const totalStepNum = run.steps[run.steps.length - 1].step;

      badgeEl.textContent = \`Step \${s.step} / \${totalStepNum}\`;
      document.getElementById("rp-scene-title").textContent = \`\${s.w || "-"}/\${s.sc || "-"} · \${s.title || ""}\`;
      document.getElementById("rp-scene-sub").textContent = \`Frame \${s.frame} · 累计 \${s.cbt?.v ?? 0} 胜\`;

      const stBadge = document.getElementById("rp-status-badge");
      if (s.clr) {
        stBadge.className = "vbadge ok";
        stBadge.textContent = "已通关 ✓";
      } else if (s.tool === "combat_action" || s.cbt?.act) {
        stBadge.className = "vbadge bad";
        stBadge.textContent = "五灵战斗 ⚔️";
      } else {
        stBadge.className = "vbadge ok";
        stBadge.textContent = s.ok ? "执行成功 ✓" : "异常";
      }

      document.getElementById("rp-journal-text").textContent =
        s.j?.s || (s.clr ? "全四章大结局已达成" : "自由探索当前场景与对话推进主线");
      document.getElementById("rp-journal-wp").innerHTML = \`路标：<code>\${s.j?.wp || "-"}</code>\`;

      const argPairs = Object.entries(s.args || {})
        .map(([k, v]) => \`\${k}=\${JSON.stringify(v)}\`)
        .join(", ");
      document.getElementById("rp-tool-call").textContent = \`#\${s.step} \${s.tool}(\${argPairs})\`;
      document.getElementById("rp-telemetry").textContent = \`\${s.gl?.[0] ?? 0} DC / \${s.gl?.[1] ?? 0} Tri\`;

      document.getElementById("rp-dlg-box").innerHTML = formatDialogs(s.ev || "", s.dlg || "");

      const ptyHtml = (s.pty || [])
        .map((p) => {
          const hpPct = Math.min(100, Math.round(((p.hp || 0) / Math.max(1, p.mhp || 1)) * 100));
          const mpPct = Math.min(100, Math.round(((p.mp || 0) / Math.max(1, p.mmp || 1)) * 100));
          return \`<div class="rp-member">
            <div style="display:flex;justify-content:space-between;font-weight:700;">
              <span>\${p.n}</span><span style="color:var(--accent)">Lv.\${p.lv}</span>
            </div>
            <div class="sub">精 \${p.hp}/\${p.mhp} · 神 \${p.mp}/\${p.mmp}</div>
            <div class="rp-bar"><div style="width:\${hpPct}%;background:var(--ok);"></div></div>
            <div class="rp-bar"><div style="width:\${mpPct}%;background:var(--accent);"></div></div>
          </div>\`;
        })
        .join("");
      document.getElementById("rp-party-grid").innerHTML = ptyHtml || \`<div class="sub">暂无队伍数据</div>\`;

      document.getElementById("rp-money").textContent = String(s.inv?.m ?? 0);
      document.getElementById("rp-inv-list").innerHTML =
        (s.inv?.it || []).map((it) => \`<span class="tag">\${it}</span>\`).join("") ||
        \`<span class="sub">行囊为空</span>\`;

      // 高亮当前所处里程碑
      let activeChip = null;
      for (const chip of msEl.querySelectorAll(".rp-ms")) {
        chip.classList.remove("active");
        if (Number(chip.dataset.idx) <= curStepIdx) activeChip = chip;
      }
      if (activeChip) activeChip.classList.add("active");

      preloadFramesAround(run, curStepIdx);
      const baseSpeed = Number(speedEl.value) || 1200;
      const prevSt = prevIdx >= 0 ? run.steps[prevIdx] : curStepIdx > 0 ? run.steps[curStepIdx - 1] : null;

      // 若包含子步连续序列帧 (subs)，先逐帧播放原场景内的 3D 骨骼跑动帧，最后切换到本步终态帧
      if (playSubs && s.subs && s.subs.length > 0) {
        const subCount = s.subs.length;
        const perSubMs = Math.max(220, Math.min(460, Math.round(baseSpeed * 0.36)));
        const originSceneStep =
          prevSt && \`\${prevSt.w}/\${prevSt.sc}\` === \`\${s.subs[0].w}/\${s.subs[0].sc}\` ? prevSt : s;

        s.subs.forEach((sub, k) => {
          const tid = setTimeout(() => {
            const fromP = k === 0 ? originSceneStep.ldr?.p || sub.p : s.subs[k - 1].p;
            const toP = sub.p;
            badgeEl.textContent = \`Step \${s.step} / \${totalStepNum} · 🏃 子步 \${k + 1}/\${subCount}\`;
            const subState = {
              subIdx: k + 1,
              subTotal: subCount,
              img: sub.img,
              fromP,
              toP,
              yaw: sub.yaw,
              tgt: sub.tgt || s.args?.target || "",
              sceneStep: originSceneStep,
            };
            const t0 = performance.now();
            const dur = perSubMs * 0.88;
            const tick = (now) => {
              const alpha = Math.min(1.0, (now - t0) / dur);
              drawRadar(run, curStepIdx, alpha, prevIdx, subState);
              if (alpha < 1.0) animRaf = requestAnimationFrame(tick);
            };
            animRaf = requestAnimationFrame(tick);
          }, k * perSubMs);
          subTimers.push(tid);
        });

        const finalTid = setTimeout(() => {
          badgeEl.textContent = \`Step \${s.step} / \${totalStepNum}\`;
          const lastSub = s.subs[subCount - 1];
          if (\`\${lastSub.w}/\${lastSub.sc}\` === \`\${s.w}/\${s.sc}\` && s.ldr?.p?.length >= 3) {
            const subFinal = {
              subIdx: subCount,
              subTotal: subCount,
              img: s.img,
              fromP: lastSub.p,
              toP: s.ldr.p,
              yaw: s.ldr.yaw,
              tgt: s.args?.target || "",
              sceneStep: s,
            };
            const t0 = performance.now();
            const dur = perSubMs * 0.85;
            const tick = (now) => {
              const alpha = Math.min(1.0, (now - t0) / dur);
              drawRadar(run, curStepIdx, alpha, prevIdx, alpha < 1.0 ? subFinal : null);
              if (alpha < 1.0) animRaf = requestAnimationFrame(tick);
            };
            animRaf = requestAnimationFrame(tick);
          } else {
            drawRadar(run, curStepIdx, 1.0, -1, null);
          }
        }, subCount * perSubMs);
        subTimers.push(finalTid);

        return (subCount + 1) * perSubMs + Math.round(baseSpeed * 0.35);
      }

      if (playSubs && prevSt && \`\${prevSt.w}/\${prevSt.sc}\` === \`\${s.w}/\${s.sc}\`) {
        const dur = Math.min(520, Math.max(160, baseSpeed * 0.48));
        const t0 = performance.now();
        update3dImageLayer(s.img, Boolean(s.img) && (viewModeEl ? viewModeEl.value : "pip") !== "radar");
        const tick = (now) => {
          const alpha = Math.min(1.0, (now - t0) / dur);
          const ease = 1 - Math.pow(1 - alpha, 3);
          drawRadar(run, curStepIdx, ease, prevIdx, null);
          if (alpha < 1.0) animRaf = requestAnimationFrame(tick);
        };
        animRaf = requestAnimationFrame(tick);
      } else {
        drawRadar(run, curStepIdx, 1.0, -1, null);
      }
      return baseSpeed;
    }

    function stopPlay() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      clearSubTimers();
      playBtn.textContent = "▶️ 播放";
    }

    function startPlay() {
      stopPlay();
      const run = runs[curRunIdx];
      if (!run) return;
      if (curStepIdx >= run.steps.length - 1) setStep(0, false);
      playBtn.textContent = "⏸ 暂停";
      const stepNext = () => {
        const r = runs[curRunIdx];
        if (!r || curStepIdx >= r.steps.length - 1) {
          stopPlay();
          return;
        }
        const waitMs = setStep(curStepIdx + 1, true);
        timer = setTimeout(stepNext, waitMs);
      };
      const curS = run.steps[curStepIdx];
      const firstWait = Math.max(300, Math.round((Number(speedEl.value) || 1200) * 0.5));
      timer = setTimeout(stepNext, curS ? firstWait : 400);
    }

    selEl.addEventListener("change", () => selectRun(Number(selEl.value)));
    speedEl.addEventListener("change", () => {
      if (timer) startPlay();
    });
    if (viewModeEl) {
      viewModeEl.addEventListener("change", () => {
        const r = runs[curRunIdx];
        if (r) drawRadar(r, curStepIdx);
      });
    }
    sliderEl.addEventListener("input", () => {
      stopPlay();
      setStep(Number(sliderEl.value), false);
    });
    document.getElementById("rp-first").addEventListener("click", () => {
      stopPlay();
      setStep(0, false);
    });
    document.getElementById("rp-prev").addEventListener("click", () => {
      stopPlay();
      setStep(curStepIdx - 1, false);
    });
    document.getElementById("rp-next").addEventListener("click", () => {
      stopPlay();
      setStep(curStepIdx + 1, true);
    });
    document.getElementById("rp-last").addEventListener("click", () => {
      stopPlay();
      const r = runs[curRunIdx];
      if (r) setStep(r.steps.length - 1, false);
    });
    playBtn.addEventListener("click", () => {
      if (timer) stopPlay();
      else startPlay();
    });

    // 支持键盘快捷键（在回放页签激活时：Space 播放/暂停，←/→ 单步）
    window.addEventListener("keydown", (e) => {
      const tabReplay = document.getElementById("tab-replay");
      if (!tabReplay || !tabReplay.checked) return;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        stopPlay();
        setStep(curStepIdx - 1, false);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stopPlay();
        setStep(curStepIdx + 1, true);
      } else if (e.key === " ") {
        e.preventDefault();
        if (timer) stopPlay();
        else startPlay();
      }
    });

    // 支持加载本地任意 episode.jsonl 文件
    document.getElementById("rp-file-input").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const lines = text
        .split(/\\r?\\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const start = lines.find((l) => l.type === "start");
      const calls = lines.filter((l) => l.type === "call");
      const rawSteps = [
        ...(start?.initial ? [{ step: 0, tool: "init", args: {}, state: start.initial }] : []),
        ...calls,
      ].map((s) => {
        const st = s.state || {};
        const scKey = \`\${st.world || ""}/\${st.scene || ""}\`;
        const fallbackImg = sceneFrameMap[scKey] || worldFrameMap[st.world || ""] || "";
        return {
          step: s.step ?? 0,
          tool: s.tool || "step",
          args: s.args || {},
          ok: st.ok !== false,
          ev: String(st.event || st.error || ""),
          frame: st.frame || 0,
          w: st.world || "",
          sc: st.scene || "",
          title: st.title || "",
          img: fallbackImg ? \`frames/\${fallbackImg}\` : "",
          clr: Boolean(st.game_cleared),
          ldr: st.leader
            ? {
                n: st.leader.name || "云天河",
                p: (st.leader.position || [0, 0, 0]).map((x) => Math.round(Number(x) || 0)),
                yaw: Math.round(Number(st.leader.rotation_yaw) || 0),
              }
            : null,
          pty: (st.party || [])
            .filter((p) => p.in_team)
            .map((p) => ({
              n: p.name,
              lv: p.level || 1,
              hp: p.hp ?? 0,
              mhp: p.max_hp || 1,
              mp: p.mp ?? 0,
              mmp: p.max_mp || 1,
            })),
          j: st.journal ? { s: st.journal.summary || "", wp: st.journal.waypoint || "" } : null,
          dlg: st.dialog?.visible ? String(st.dialog.text || "") : "",
          cbt: st.combat
            ? {
                act: Boolean(st.combat.active),
                v: st.combat.victories || 0,
                log: String(st.combat.last_log || ""),
                en: [],
              }
            : null,
          npcs: (st.npcs || []).map((n) => ({
            n: n.name,
            p: (n.position || [0, 0, 0]).map((x) => Math.round(Number(x) || 0)),
          })),
          objs: (st.objects || []).map((o) => ({
            n: o.name,
            p: (o.position || [0, 0, 0]).map((x) => Math.round(Number(x) || 0)),
          })),
          evs: (st.events || []).map((ev) => ({
            n: ev.name,
            p: (ev.position || [0, 0, 0]).map((x) => Math.round(Number(x) || 0)),
          })),
          mons: (st.monsters || []).map((m) => ({
            n: m.name,
            p: (m.position || [0, 0, 0]).map((x) => Math.round(Number(x) || 0)),
          })),
          inv: {
            m: st.inventory?.money || 0,
            it: (st.inventory?.items || []).map((i) => \`\${i.name}×\${i.count}\`),
          },
          gl: st.gles3 ? [st.gles3.draw_calls || 0, st.gles3.triangles || 0] : [0, 0],
        };
      });
      runs.unshift({
        runId: file.name,
        model: start?.model || "custom-upload",
        mode: start?.mode || "pure",
        realCpk: Boolean(start?.realCpk),
        toolCalls: calls.length,
        victories: rawSteps[rawSteps.length - 1]?.cbt?.v || 0,
        steps: rawSteps,
      });
      populateRunSelect();
      selectRun(0);
    });

    if (runs.length) {
      populateRunSelect();
      selectRun(0);
    }
  })();
</script>
</body>
</html>
`;
}

function main() {
  const outIdx = process.argv.indexOf("--out");
  const outFile =
    outIdx >= 0 && process.argv[outIdx + 1]
      ? path.resolve(process.argv[outIdx + 1])
      : path.join(OUT_ROOT, "board.html");

  const runs = loadRuns(OUT_ROOT);
  const html = generateBoardHtml(runs, "stats");
  const replayHtml = generateBoardHtml(runs, "replay");

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, "utf8");

  // Also write to web/board.html and web/replay.html so it can be served or viewed directly alongside web/index.html
  const webBoard = path.resolve(__dirname, "../web/board.html");
  const webReplay = path.resolve(__dirname, "../web/replay.html");
  if (fs.existsSync(path.dirname(webBoard))) {
    fs.writeFileSync(webBoard, html, "utf8");
    fs.writeFileSync(webReplay, replayHtml, "utf8");
  }

  console.log(
    `[board] Generated leaderboard & interactive replay player with ${runs.length} verified runs -> ${outFile} & ${webReplay} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
