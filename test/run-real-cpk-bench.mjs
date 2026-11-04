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

    const drain = async (state) => {
      while (state.dialog.visible || state.combat.active) {
        if (state.combat.active) {
          state = await client.send("combat_action", { action: "skill", target_slot: state.combat.enemies[0]?.slot || 1 });
        } else {
          state = await client.send("interact");
        }
      }
      return state;
    };

    // 9. Q01/Q01 (11400) -> Q01/N02 (11500) -> Q01/Q01 -> Q01/N03 (20200) -> M02/1 -> M02/3 -> Q02/Q02 (20300)
    st = await drain(await client.send("interact", { target: "ev_Q01_Q01_1" }));
    assert.equal(st.world, "Q01");
    assert.equal(st.scene, "N02");
    assert.equal(st.quest_stage, 11500);
    st = await drain(await client.send("interact", { target: "func1003" }));
    st = await drain(await client.send("interact", { target: "ev_Q01_Q01_6" }));
    assert.equal(st.world, "M02");
    assert.equal(st.scene, "1");
    assert.equal(st.quest_stage, 20200);
    st = await drain(await client.send("interact", { target: "LinkObj01" }));
    assert.equal(st.world, "M02");
    assert.equal(st.scene, "3");
    st = await drain(await client.send("interact", { target: "ev_M02_3_1" }));
    assert.equal(st.world, "Q02");
    assert.equal(st.scene, "Q02");
    assert.equal(st.quest_stage, 20300);
    assert.equal(st.diagnostics.script_error, "");
    assert.equal(st.diagnostics.unhandled_calls.length, 0);
    console.log(`[PASS] 9. 拜别云天青墓、穿越紫云架抵达太平村 (Q01/N02 -> N03 -> M02/1 -> M02/3 -> Q02/Q02): mvar=${st.quest_stage}`);

    // 10. Q02/Q02 (20300 -> 20600) -> M03/1 (20800) -> M03/1Y (20900 -> 21600, Wind Evil Beast + Murong Ziying) -> Q03/Q03S (21700)
    st = await drain(await client.send("interact", { target: "func2002" }));
    assert.equal(st.quest_stage, 20600);
    st = await drain(await client.send("interact", { target: "func1024" }));
    assert.equal(st.world, "M03");
    assert.equal(st.scene, "1");
    assert.equal(st.quest_stage, 20800);
    st = await drain(await client.send("interact", { target: "func2002" }));
    assert.equal(st.world, "M03");
    assert.equal(st.scene, "1Y");
    assert.equal(st.quest_stage, 20900);
    st = await drain(await client.send("interact", { target: "func2003" }));
    assert.equal(st.world, "M03");
    assert.equal(st.scene, "1");
    assert.equal(st.quest_stage, 21600);
    st = await drain(await client.send("interact", { target: "func1004" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "Q03S");
    assert.equal(st.quest_stage, 21700);
    assert.equal(st.diagnostics.script_error, "");
    assert.equal(st.diagnostics.unhandled_calls.length, 0);
    console.log(`[PASS] 10. 太平村钟馗剧变、巢湖夜战风邪兽初遇慕容紫英并抵达寿阳城 (Q02 -> M03/1Y -> Q03/Q03S): mvar=${st.quest_stage}`);

    // 11. Q03/Q03S (21700) -> Wanted Poster (ev_Q03_Q03S_23 + MO005 -> 21900) -> Q03/Q03X (21901) -> Q03/XN03Y (22100, Meet Liu Mengli)
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03S_23" }));
    assert.equal(st.quest_stage, 21800);
    st = await drain(await client.send("interact", { target: "MO005" }));
    assert.equal(st.quest_stage, 21900);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03S_1" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "Q03X");
    assert.equal(st.quest_stage, 21901);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_3" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "XN03Y");
    assert.equal(st.quest_stage, 22100);
    assert.equal(st.diagnostics.script_error, "");
    assert.equal(st.diagnostics.unhandled_calls.length, 0);
    console.log(`[PASS] 11. 寿阳揭海捕文书、夜闯柳府初遇柳梦璃 (Q03/Q03S -> MO005 -> Q03/Q03X -> Q03/XN03Y): mvar=${st.quest_stage}`);

    // 12. Q03/XN03Y (22100) -> M04/1 (22300, Nvluoyan) -> Boss Fight -> Q03/XN03 (30101) -> Q03/Q03X (30200) -> Q03/Q03S (30201) -> M05/1 (30500)
    st = await drain(await client.send("interact", { target: "ev_Q03_XN03_0" }));
    assert.equal(st.world, "M04");
    assert.equal(st.scene, "1");
    assert.equal(st.quest_stage, 22300);
    st = await drain(await client.send("interact", { target: "ev_M04_1_30" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "XN03");
    assert.equal(st.quest_stage, 30101);
    st = await drain(await client.send("interact", { target: "ev_Q03_XN03_0" }));
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_13" }));
    assert.equal(st.quest_stage, 30200);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_3" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "Q03S");
    assert.equal(st.quest_stage, 30201);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03S_0" }));
    assert.equal(st.world, "M05");
    assert.equal(st.scene, "1");
    assert.equal(st.quest_stage, 30500);
    assert.equal(st.diagnostics.script_error, "");
    assert.equal(st.diagnostics.unhandled_calls.length, 0);
    console.log(`[PASS] 12. 女萝岩击败槐妖长老、返回柳府议事并进入八公山 (M04/1 -> Q03/XN03 -> M05/1): mvar=${st.quest_stage}`);

    // 13. M05/1 (30500) -> M06 (Huainan King Tomb: 1A -> 1B -> 2A -> 2B -> 1C -> 2D -> 4 -> 2D -> 1C -> 2B -> 2A -> 1B -> 1A) -> M05/1 (31300)
    for (const fn of [
      "func1001", "func7001", "func1001", "func2001", "func1003",
      "func2002", "func7002", "func7003", "func1009", "func1013",
      "func7005", "func7006", "func1017", "func7008", "func7009",
      "func7010", "func1023", "func2003", "func1024", "func1018",
      "func1014", "func1010", "func1004", "func1002", "func1025",
    ]) {
      st = await drain(await client.send("interact", { target: fn }));
    }
    assert.equal(st.world, "M05");
    assert.equal(st.scene, "1");
    assert.equal(st.quest_stage, 31300);
    assert.equal(st.diagnostics.script_error, "");
    assert.equal(st.diagnostics.unhandled_calls.length, 0);
    console.log(`[PASS] 13. 淮南王陵全油灯机关解谜、击败淮南王夺取土灵珠并脱出王陵 (M06/1A..2D..4 -> M05/1): mvar=${st.quest_stage}`);

    // 14. M05/1 (31300) -> Q03/Q03S -> Q03/Q03X (31400 -> 31500) -> Q03/XN03 (40100, Liu Mengli joins party!)
    st = await drain(await client.send("interact", { target: "ev_M05_1_3" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "Q03S");
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03S_1" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "Q03X");
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_3" }));
    assert.equal(st.quest_stage, 31400);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_14" }));
    assert.equal(st.quest_stage, 31500);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_7" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "XN03");
    st = await drain(await client.send("interact", { target: "ev_Q03_XN03_2" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "XN03");
    assert.equal(st.quest_stage, 40100);
    assert.equal(st.leader.control_enabled, true);
    assert.equal(st.diagnostics.script_error, "");
    assert.equal(st.diagnostics.unhandled_calls.length, 0);
    console.log(`[PASS] 14. 重返寿阳柳府客房休憩、柳梦璃正式入队，第二幕圆满通关 (Q03/XN03): mvar=${st.quest_stage}, unhandled_calls=0`);

    console.log("================================================================");
    console.log("  ALL 14 REAL-CPK CHAPTER 1 & 2 CAMPAIGN CHECKS PASSED (100%)");
    console.log("================================================================");
  } finally {
    client.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
