#!/usr/bin/env node
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST_BIN = process.env.AGENT_PAL4_HOST_BIN || path.resolve(__dirname, "../build/agent-pal4-host");
const GAME_DATA = process.env.AGENT_PAL4_GAME_DATA || "/Volumes/T7-Data/pal/pal4-data/仙剑奇侠传4/gamedata";

class RealCpkClient {
  constructor(mode = "normal") {
    this.proc = spawn(HOST_BIN, ["--game-data", GAME_DATA, "--mode", mode], {
      stdio: ["pipe", "pipe", "inherit"],
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

async function run() {
  console.log("================================================================");
  console.log("  agent-pal4 Real CPK Benchmark (仙剑奇侠传四原版数据全链路验证)");
  console.log("================================================================");

  const client = new RealCpkClient("normal");
  try {
    // 1. Observe NewGame in Q01/N01
    let st = await client.send("observe");
    assert.equal(st.world, "Q01");
    assert.equal(st.scene, "N01");
    assert.equal(st.quest_stage, 10100);
    assert.equal(st.dialog.visible, true);
    assert.equal(st.diagnostics.script_error, "");
    console.log(`[PASS] 1. 原版 NewGame 启动 (Q01/N01): mvar=${st.quest_stage}, 对白="${st.dialog.text.slice(0, 20)}..."`);

    // 2. Confirm opening dialog -> transitions to Q01/Q01 (mvar=10201)
    st = await client.send("interact");
    assert.equal(st.world, "Q01");
    assert.equal(st.scene, "Q01");
    assert.equal(st.quest_stage, 10201);
    assert.equal(st.diagnostics.script_error, "");
    console.log(`[PASS] 2. 清晨上香与山猪闯洞剧情完成: 切入场景=${st.world}/${st.scene}, mvar=${st.quest_stage}`);

    // 3. Enter cabin Q01/N01 via ev_Q01_Q01_1 and pick up bow & sword (MO002)
    st = await client.send("interact", { target: "ev_Q01_Q01_1" });
    assert.equal(st.world, "Q01");
    assert.equal(st.scene, "N01");
    st = await client.send("interact", { target: "MO002" });
    if (st.dialog.visible) {
      st = await client.send("interact");
    }
    assert.equal(st.world, "Q01");
    assert.equal(st.scene, "Q01");
    assert.equal(st.quest_stage, 10300);
    assert.equal(st.trial_cleared, true);
    assert.equal(st.inventory.items.length, 2);
    assert.equal(st.diagnostics.script_error, "");
    console.log(`[PASS] 3. 小木屋取长弓与古剑 (MO002): 获得【${st.inventory.items.map(i => i.name).join("】【")}】, mvar=${st.quest_stage}`);

    // 4. Enter Shichenxi Cave M01/1 via ev_Q01_Q01_5 -> mvar=10400
    st = await client.send("interact", { target: "ev_Q01_Q01_5" });
    if (st.dialog.visible) {
      st = await client.send("interact");
    }
    assert.equal(st.world, "M01");
    assert.equal(st.scene, "1");
    assert.equal(st.quest_stage, 10400);
    assert.equal(st.chapter1_cleared, true);
    assert.equal(st.diagnostics.script_error, "");
    console.log(`[PASS] 4. 进入石沉溪洞 (M01/1, type=2 迷宫): 加载 ${st.monsters.length} 只迷宫怪物, 洞口机关剧情完成, mvar=${st.quest_stage}`);

    // 5. Trigger ev_M01_1_6 (func2002) -> First encounter with Han Lingsha -> mvar=10600
    st = await client.send("interact", { target: "ev_M01_1_6" });
    while (st.dialog.visible) {
      st = await client.send("interact");
    }
    assert.equal(st.world, "M01");
    assert.equal(st.scene, "1");
    assert.equal(st.quest_stage, 10600);
    assert.equal(st.leader.control_enabled, true);
    assert.equal(st.diagnostics.script_error, "");
    assert.equal(st.diagnostics.unhandled_calls.length, 0);
    console.log(`[PASS] 5. 石沉溪洞初遇韩菱纱 (ev_M01_1_6 / func2002): 非领队角色寻路与烟雨夺魂剧情完成, mvar=${st.quest_stage}`);

    // 6. Trigger ev_M01_1_7 (func2003) -> Q01/Q01 roasted pig + Han Lingsha joins party + Kui Zhao Boss Fight 1 & 2 -> mvar=11100
    st = await client.send("interact", { target: "ev_M01_1_7" });
    while (st.dialog.visible || st.combat.active) {
      if (st.combat.active) {
        st = await client.send("combat_action", { action: "skill", target_slot: st.combat.enemies[0]?.slot || 1 });
      } else {
        st = await client.send("interact");
      }
    }
    assert.equal(st.world, "M01");
    assert.equal(st.scene, "1");
    assert.equal(st.quest_stage, 11100);
    assert.equal(st.combat.victories, 2);
    assert.equal(st.leader.control_enabled, true);
    assert.equal(st.diagnostics.script_error, "");
    assert.equal(st.diagnostics.unhandled_calls.length, 0);
    console.log(`[PASS] 6. 烤山猪结识韩菱纱、仙术教学与魁召二连战 (func2003/func2004): 累计胜场=${st.combat.victories}, 望舒剑觉醒, mvar=${st.quest_stage}`);

    // 7. Trigger ev_M01_1_5 (func1001) -> Enter Tomb M01/2 -> Collapse M01/3 -> mvar=11400
    st = await client.send("interact", { target: "ev_M01_1_5" });
    while (st.dialog.visible) {
      st = await client.send("interact");
    }
    assert.equal(st.world, "M01");
    assert.equal(st.scene, "3");
    assert.equal(st.quest_stage, 11400);
    assert.equal(st.leader.control_enabled, true);
    assert.equal(st.diagnostics.script_error, "");
    assert.equal(st.diagnostics.unhandled_calls.length, 0);
    console.log(`[PASS] 7. 冰封墓室崩塌与下山约定 (M01/2 -> M01/3): 场景=${st.world}/${st.scene}, mvar=${st.quest_stage}`);

    // 8. Exit collapsed cave M01/3 via ev_M01_1_4 back to Qingluan Peak Q01/Q01
    st = await client.send("interact", { target: "ev_M01_1_4" });
    assert.equal(st.world, "Q01");
    assert.equal(st.scene, "Q01");
    assert.equal(st.quest_stage, 11400);
    assert.equal(st.leader.control_enabled, true);
    assert.equal(st.diagnostics.script_error, "");
    assert.equal(st.diagnostics.unhandled_calls.length, 0);
    console.log(`[PASS] 8. 走出石沉溪洞重返青鸾峰 (M01/3 -> Q01/Q01): 零脚本报错、零未处理调用 (unhandled_calls=0)`);

    console.log("================================================================");
    console.log("  ALL 8 REAL-CPK CHAPTER 1 CAMPAIGN CHECKS PASSED (100%)");
    console.log("================================================================");
  } finally {
    client.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
