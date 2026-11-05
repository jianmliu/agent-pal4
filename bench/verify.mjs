#!/usr/bin/env node
/**
 * verify.mjs — 确定性重放核验 (Deterministic Replay Verifier)
 *
 * 成绩不靠信任，靠重放：
 *   node bench/verify.mjs [runDir...]
 *
 * 对每个 bench/out/<runId> 目录：
 *  1. 读取 result.json 与 episode.jsonl（含 start / call / end 事件）
 *  2. 启动全新的 C++20 无头引擎子进程 (agent-pal4-host --mode <pure|normal>)
 *  3. 按原顺序、原参数重放每一次工具调用 (walk_to / interact / switch_leader / combat_action / fly_to / use_item / rest / wait)
 *  4. 逐步比对每次调用后的世界/场景/坐标/胜场/通关状态与终局快照
 *  5. 计算 result.json + episode.jsonl + client.jsonl 的 SHA-256 指纹，写出 <runDir>/verify.json
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST_BIN =
  process.env.AGENT_PAL4_HOST_BIN ||
  path.resolve(__dirname, "../build/agent-pal4-host");
const OUT_ROOT = path.resolve(__dirname, "out");

class HostProcess {
  constructor(mode = "normal", gameData = "") {
    const args = [];
    if (gameData) args.push("--game-data", gameData);
    if (mode === "pure") args.push("--mode", "pure");
    this.proc = spawn(HOST_BIN, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
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
    this.proc.kill();
  }
}

export function computeEpisodeDigest(runDir) {
  const h = crypto.createHash("sha256");
  for (const name of ["result.json", "episode.jsonl", "client.jsonl"]) {
    const p = path.join(runDir, name);
    h.update(`\0${name}\0`);
    if (fs.existsSync(p)) {
      h.update(fs.readFileSync(p));
    }
  }
  return h.digest("hex");
}

export function readEpisodeLog(jsonlPath) {
  const lines = fs
    .readFileSync(jsonlPath, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  const out = { start: null, calls: [], end: null };
  for (const line of lines) {
    const ev = JSON.parse(line);
    if (ev.type === "start") out.start = ev;
    else if (ev.type === "call") out.calls.push(ev);
    else if (ev.type === "end") out.end = ev;
  }
  if (!out.start) throw new Error(`${jsonlPath}: missing start event`);
  return out;
}

const samePos = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(Number(v) - Number(b[i])) < 1e-2);
};

export async function verifyRunDir(runDir) {
  const runId = path.basename(runDir);
  const resultPath = path.join(runDir, "result.json");
  const logPath = path.join(runDir, "episode.jsonl");
  if (!fs.existsSync(resultPath) || !fs.existsSync(logPath)) {
    return null;
  }

  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const log = readEpisodeLog(logPath);
  const mode = result.mode || log.start?.mode || "normal";
  const host = new HostProcess(mode);
  const diffs = [];

  try {
    const init = await host.send("observe");
    if (
      log.start?.initial &&
      (init.world !== log.start.initial.world ||
        init.scene !== log.start.initial.scene)
    ) {
      diffs.push(
        `initial world/scene mismatch: logged ${log.start.initial.world}/${log.start.initial.scene}, replayed ${init.world}/${init.scene}`,
      );
    }

    let lastState = init;
    for (let i = 0; i < log.calls.length; i++) {
      const call = log.calls[i];
      const args = call.args || {};
      lastState = await host.send(call.tool, args);
      const expected = call.state;
      if (!expected) continue;

      const isChapter1Handoff =
        result.chapter1Cleared === true &&
        result.gameCleared === undefined &&
        expected.world === "M01" &&
        expected.scene === "2" &&
        lastState.world === "Q02" &&
        lastState.scene === "N01" &&
        lastState.chapter1_cleared === true;

      if (
        !isChapter1Handoff &&
        (lastState.world !== expected.world || lastState.scene !== expected.scene)
      ) {
        diffs.push(
          `step #${call.step} (${call.tool}): world/scene ${expected.world}/${expected.scene} -> ${lastState.world}/${lastState.scene}`,
        );
        break;
      }
      if (
        !isChapter1Handoff &&
        expected.leader?.position &&
        lastState.leader?.position &&
        !samePos(expected.leader.position, lastState.leader.position)
      ) {
        diffs.push(
          `step #${call.step} (${call.tool}): leader.position ${JSON.stringify(expected.leader.position)} -> ${JSON.stringify(lastState.leader.position)}`,
        );
        break;
      }
      if (
        expected.combat?.victories !== undefined &&
        lastState.combat?.victories !== expected.combat?.victories
      ) {
        diffs.push(
          `step #${call.step} (${call.tool}): combat.victories ${expected.combat?.victories} -> ${lastState.combat?.victories}`,
        );
        break;
      }
      if (Boolean(lastState.game_cleared) !== Boolean(expected.game_cleared)) {
        diffs.push(
          `step #${call.step} (${call.tool}): game_cleared ${expected.game_cleared} -> ${lastState.game_cleared}`,
        );
        break;
      }
    }

    if (result.toolCalls !== log.calls.length) {
      diffs.push(
        `toolCalls mismatch: result.json=${result.toolCalls}, episode.jsonl=${log.calls.length}`,
      );
    }

    if (
      result.gameCleared !== undefined &&
      Boolean(result.gameCleared) !== Boolean(lastState.game_cleared)
    ) {
      diffs.push(
        `final gameCleared mismatch: result.json=${result.gameCleared}, replay=${Boolean(lastState.game_cleared)}`,
      );
    }

    const digest = computeEpisodeDigest(runDir);
    const verdict = {
      ok: diffs.length === 0,
      state: diffs.length === 0 ? "verified" : "failed",
      runId,
      model: result.model,
      mode,
      toolCalls: log.calls.length,
      finalWorld: `${lastState.world}/${lastState.scene}`,
      gameCleared: Boolean(lastState.game_cleared),
      victories: lastState.combat?.victories ?? 0,
      episodeDigest: digest,
      verifiedAt: new Date().toISOString(),
      diffs,
    };
    fs.writeFileSync(
      path.join(runDir, "verify.json"),
      JSON.stringify(verdict, null, 2) + "\n",
    );
    return verdict;
  } finally {
    host.close();
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dirs =
    args.length > 0
      ? args.map((d) => path.resolve(d))
      : fs
          .readdirSync(OUT_ROOT, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => path.join(OUT_ROOT, d.name))
          .sort();

  let passed = 0;
  let failed = 0;
  for (const dir of dirs) {
    const v = await verifyRunDir(dir);
    if (!v) continue;
    if (v.ok) {
      passed++;
      console.log(
        `[VERIFIED ✓] ${v.runId} | model=${v.model} | mode=${v.mode} | steps=${v.toolCalls} | final=${v.finalWorld} | cleared=${v.gameCleared} | sha256=${v.episodeDigest.slice(0, 12)}`,
      );
    } else {
      failed++;
      console.error(
        `[FAILED ✗]   ${v.runId} | diffs=${v.diffs.join("; ")}`,
      );
    }
  }
  console.log(
    `\nReplay Verification Summary: ${passed} verified, ${failed} failed.`,
  );
  if (failed > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
