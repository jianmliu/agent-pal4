#!/usr/bin/env node
/**
 * render-frames.mjs — 从原版零售 CPK 确定性重放并光栅化渲染全流程 3D 实机画面
 *
 *   node bench/render-frames.mjs [--run bench/out/opus-20261105T061222]
 *
 * 通过 agent-pal4-host 内置的软件 GLES3 光栅化管线 (render_frame)，
 * 将通关轨迹中每一个 (world, scene, leader, position) 状态渲染为原版 3D 画面，
 * 输出至 web/frames/ 与 bench/out/frames/ 并生成 manifest.json 供回放器调用。
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEpisodeLog } from "./verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOST_BIN =
  process.env.AGENT_PAL4_HOST_BIN || path.resolve(ROOT, "build/agent-pal4-host");
const GAME_DATA =
  process.env.AGENT_PAL4_GAME_DATA ||
  "/Volumes/T7-Data/pal/pal4-data/仙剑奇侠传4/gamedata";
const WEB_FRAMES_DIR = path.resolve(ROOT, "web/frames");
const OUT_FRAMES_DIR = path.resolve(ROOT, "bench/out/frames");

export function makePosKey(st) {
  const w = st?.world || st?.w || "";
  const sc = st?.scene || st?.sc || "";
  const ldrName = st?.leader?.name || st?.ldr?.n || "云天河";
  const rawPos = st?.leader?.position || st?.ldr?.p || [0, 0, 0];
  const p = rawPos.map((x) => Math.round((Number(x) || 0) / 10) * 10).join(",");
  return `${w}/${sc}@${ldrName}@${p}`;
}

export function makeSceneLeaderKey(st) {
  const w = st?.world || st?.w || "";
  const sc = st?.scene || st?.sc || "";
  const ldrName = st?.leader?.name || st?.ldr?.n || "云天河";
  return `${w}/${sc}@${ldrName}`;
}

export function makeSceneKey(st) {
  const w = st?.world || st?.w || "";
  const sc = st?.scene || st?.sc || "";
  return `${w}/${sc}`;
}

class HostProcess {
  constructor(mode = "pure", gameData = GAME_DATA) {
    const args = ["--game-data", gameData];
    if (mode === "pure") args.push("--mode", "pure");
    this.proc = spawn(HOST_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.buf = "";
    this.waiters = [];
    this.proc.stdout.on("data", (chunk) => {
      this.buf += chunk.toString();
      const lines = this.buf.split("\n");
      this.buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        const resolve = this.waiters.shift();
        if (resolve) resolve(msg);
      }
    });
  }

  send(cmd, extra = {}) {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.proc.stdin.write(JSON.stringify({ cmd, ...extra }) + "\n");
    });
  }

  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

async function main() {
  const runDir =
    process.argv[2] || path.resolve(ROOT, "bench/out/opus-20261105T061222");
  const logPath = path.join(runDir, "episode.jsonl");
  const log = readEpisodeLog(logPath);

  fs.mkdirSync(WEB_FRAMES_DIR, { recursive: true });
  fs.mkdirSync(OUT_FRAMES_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pal4-frames-"));

  const host = new HostProcess("pure", GAME_DATA);
  const manifest = {
    width: 512,
    height: 288,
    generatedAt: new Date().toISOString(),
    byPos: {},
    bySceneLeader: {},
    byScene: {},
    byWorld: {},
    substepsByStep: {},
    substepsByTransition: {},
  };

  const renderedPosKeys = new Map();
  const extraBmpJobs = [];
  let frameCounter = 0;
  let substepCounter = 0;

  async function captureIfNeeded(st) {
    if (!st || !st.world) return;
    const posKey = makePosKey(st);
    const scLdrKey = makeSceneLeaderKey(st);
    const scKey = makeSceneKey(st);
    const wKey = st.world;

    let fileName = renderedPosKeys.get(posKey);
    if (!fileName) {
      frameCounter++;
      const slug = `${st.world}_${st.scene}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      fileName = `f_${String(frameCounter).padStart(3, "0")}_${slug}.jpg`;
      const bmpPath = path.join(tmpDir, `${frameCounter}.bmp`);
      await host.send("render_frame", {
        path: bmpPath,
        width: 512,
        height: 288,
      });
      renderedPosKeys.set(posKey, fileName);
      renderedPosKeys.set(`__bmp_${frameCounter}`, { bmpPath, fileName });
    }

    manifest.byPos[posKey] = fileName;
    if (!manifest.bySceneLeader[scLdrKey]) {
      manifest.bySceneLeader[scLdrKey] = fileName;
    }
    if (!manifest.byScene[scKey]) {
      manifest.byScene[scKey] = fileName;
    }
    if (!manifest.byWorld[wKey]) {
      manifest.byWorld[wKey] = fileName;
    }
  }

  try {
    await host.send("set_time_scale", { scale: 30.0 });
    let prevSt = await host.send("observe");
    await captureIfNeeded(prevSt);

    for (let i = 0; i < log.calls.length; i++) {
      const c = log.calls[i];
      const stepNum = c.step || i + 1;

      if (
        (c.tool === "interact" && c.args?.target) ||
        c.tool === "move_to" ||
        c.tool === "walk_to"
      ) {
        const subPrefix = path.join(tmpDir, `sub_${stepNum}`);
        const subReq = {
          target: String(c.args?.target || ""),
          prefix: subPrefix,
          width: 512,
          height: 288,
          max_substeps: 3,
        };
        if (typeof c.args?.x === "number") {
          subReq.x = c.args.x;
          subReq.y = Number(c.args.y || 0);
          subReq.z = Number(c.args.z || 0);
        }
        const subRes = await host.send("render_substeps", subReq);
        if (subRes?.ok && Array.isArray(subRes.substeps) && subRes.substeps.length > 0) {
          const slug = `${subRes.world}_${subRes.scene}`.replace(/[^a-zA-Z0-9_-]/g, "_");
          const stepSubs = [];
          for (let sIdx = 0; sIdx < subRes.substeps.length; sIdx++) {
            const sub = subRes.substeps[sIdx];
            substepCounter++;
            const subFile = `s_${String(stepNum).padStart(3, "0")}_${sIdx + 1}_${slug}.jpg`;
            extraBmpJobs.push({ bmpPath: sub.path, fileName: subFile });
            stepSubs.push({
              w: subRes.world,
              sc: subRes.scene,
              p: (sub.p || [0, 0, 0]).map((v) => Math.round(Number(v) * 10) / 10),
              yaw: Math.round(Number(sub.yaw || 0)),
              img: subFile,
              target: String(c.args?.target || ""),
            });
          }
          manifest.substepsByStep[String(stepNum)] = stepSubs;
          if (prevSt?.world && c.args?.target) {
            const transKey = `${prevSt.world}/${prevSt.scene}->${c.args.target}`;
            if (!manifest.substepsByTransition[transKey]) {
              manifest.substepsByTransition[transKey] = stepSubs;
            }
          }
        }
      }

      const st = await host.send(c.tool, c.args || {});
      await captureIfNeeded(st);
      prevSt = st;
      if ((i + 1) % 25 === 0 || i === log.calls.length - 1) {
        console.log(
          `[render-frames] Step ${i + 1}/${log.calls.length} (${st.world}/${st.scene}) — ${frameCounter} key frames + ${substepCounter} sub-step frames rendered`,
        );
      }
    }
  } finally {
    host.close();
  }

  // Batch convert all BMPs to optimized JPEGs using Python Pillow
  const jobs = [];
  for (let i = 1; i <= frameCounter; i++) {
    const info = renderedPosKeys.get(`__bmp_${i}`);
    if (info) jobs.push(info);
  }
  for (const job of extraBmpJobs) {
    jobs.push(job);
  }

  const pyScript = `
import sys, json, shutil
from pathlib import Path
from PIL import Image

jobs = json.loads(sys.stdin.read())
web_dir = Path(${JSON.stringify(WEB_FRAMES_DIR)})
out_dir = Path(${JSON.stringify(OUT_FRAMES_DIR)})

for j in jobs:
    bmp = Path(j["bmpPath"])
    if not bmp.exists():
        continue
    im = Image.open(bmp)
    dst_web = web_dir / j["fileName"]
    dst_out = out_dir / j["fileName"]
    im.save(dst_web, format="JPEG", quality=78, optimize=True)
    shutil.copy2(dst_web, dst_out)
`;
  execFileSync("python3", ["-c", pyScript], {
    input: JSON.stringify(jobs),
    stdio: ["pipe", "inherit", "inherit"],
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });

  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  fs.writeFileSync(path.join(WEB_FRAMES_DIR, "manifest.json"), manifestJson);
  fs.writeFileSync(path.join(OUT_FRAMES_DIR, "manifest.json"), manifestJson);

  console.log(
    `[render-frames] Done! Generated ${frameCounter} 3D frames in web/frames/ and bench/out/frames/.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
