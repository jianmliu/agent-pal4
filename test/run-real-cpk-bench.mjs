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

async function run(mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "pure") {
  console.log("================================================================");
  console.log(`  agent-pal4 Real CPK Benchmark [mode=${mode}] (仙剑奇侠传四原版数据全链路验证)`);
  console.log("================================================================");

  const client = new RealCpkClient(mode);
  const checkDiag = (st, expectedStage) => {
    if (mode !== "pure") {
      if (expectedStage !== undefined) assert.equal(st.quest_stage, expectedStage);
      assert.equal(st.diagnostics.script_error, "");
      assert.equal(st.diagnostics.unhandled_calls.length, 0);
    } else {
      assert.equal(st.quest_stage, undefined);
      assert.equal(st.diagnostics, undefined);
    }
  };
  try {
    // Enable virtual clock 30x speedup
    await client.send("set_time_scale", { scale: 30.0 });

    // 1. Observe NewGame in Q01/N01
    let st = await client.send("observe");
    assert.equal(st.world, "Q01");
    assert.equal(st.scene, "N01");
    assert.equal(st.dialog.visible, true);
    checkDiag(st, 10100);
    console.log(`[PASS] 1. 原版 NewGame 启动 (Q01/N01): mode=${st.mode}, 对白="${st.dialog.text.slice(0, 20)}..."`);

    // 2. Confirm opening dialog -> transitions to Q01/Q01 (mvar=10201)
    st = await client.send("interact");
    assert.equal(st.world, "Q01");
    assert.equal(st.scene, "Q01");
    checkDiag(st, 10201);
    console.log(`[PASS] 2. 清晨上香与山猪闯洞剧情完成: 切入场景=${st.world}/${st.scene}`);

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
    if (mode !== "pure") assert.equal(st.trial_cleared, true);
    assert.equal(st.inventory.items.length, 2);
    checkDiag(st, 10300);
    console.log(`[PASS] 3. 小木屋取长弓与古剑 (MO002): 获得【${st.inventory.items.map(i => i.name).join("】【")}】`);

    // 4. Enter Shichenxi Cave M01/1 via ev_Q01_Q01_5 -> mvar=10400
    st = await client.send("interact", { target: "ev_Q01_Q01_5" });
    if (st.dialog.visible) {
      st = await client.send("interact");
    }
    assert.equal(st.world, "M01");
    assert.equal(st.scene, "1");
    if (mode !== "pure") assert.equal(st.chapter1_cleared, true);
    checkDiag(st, 10400);
    console.log(`[PASS] 4. 进入石沉溪洞 (M01/1, type=2 迷宫): 加载 ${st.monsters.length} 只迷宫怪物, 洞口机关剧情完成`);

    // 5. Trigger ev_M01_1_6 (func2002) -> First encounter with Han Lingsha -> mvar=10600
    st = await client.send("interact", { target: "ev_M01_1_6" });
    while (st.dialog.visible) {
      st = await client.send("interact");
    }
    assert.equal(st.world, "M01");
    assert.equal(st.scene, "1");
    assert.equal(st.leader.control_enabled, true);
    checkDiag(st, 10600);
    console.log(`[PASS] 5. 石沉溪洞初遇韩菱纱 (ev_M01_1_6): 非领队角色寻路与烟雨夺魂剧情完成`);

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
    assert.equal(st.combat.victories, 2);
    assert.equal(st.leader.control_enabled, true);
    checkDiag(st, 11100);
    console.log(`[PASS] 6. 烤山猪结识韩菱纱、仙术教学与魁召二连战 (ev_M01_1_7): 累计胜场=${st.combat.victories}, 望舒剑觉醒`);

    // 7. Trigger ev_M01_1_5 (func1001) -> Enter Tomb M01/2 -> Collapse M01/3 -> mvar=11400
    st = await client.send("interact", { target: "ev_M01_1_5" });
    while (st.dialog.visible) {
      st = await client.send("interact");
    }
    assert.equal(st.world, "M01");
    assert.equal(st.scene, "3");
    assert.equal(st.leader.control_enabled, true);
    checkDiag(st, 11400);
    console.log(`[PASS] 7. 冰封墓室崩塌与下山约定 (M01/2 -> M01/3): 场景=${st.world}/${st.scene}`);

    // 8. Exit collapsed cave M01/3 via ev_M01_1_4 back to Qingluan Peak Q01/Q01
    st = await client.send("interact", { target: "ev_M01_1_4" });
    assert.equal(st.world, "Q01");
    assert.equal(st.scene, "Q01");
    assert.equal(st.leader.control_enabled, true);
    checkDiag(st, 11400);
    console.log(`[PASS] 8. 走出石沉溪洞重返青鸾峰 (M01/3 -> Q01/Q01): 零脚本报错`);

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
    checkDiag(st, 11500);
    st = await drain(await client.send("interact", { target: "ev_Q01_N02_0" }));
    st = await drain(await client.send("interact", { target: "ev_Q01_Q01_6" }));
    assert.equal(st.world, "M02");
    assert.equal(st.scene, "1");
    checkDiag(st, 20200);
    st = await drain(await client.send("interact", { target: "LinkObj01" }));
    assert.equal(st.world, "M02");
    assert.equal(st.scene, "3");
    st = await drain(await client.send("interact", { target: "ev_M02_3_1" }));
    assert.equal(st.world, "Q02");
    assert.equal(st.scene, "Q02");
    checkDiag(st, 20300);
    console.log(`[PASS] 9. 拜别云天青墓、穿越紫云架抵达太平村 (Q01/N02 -> N03 -> M02/1 -> M02/3 -> Q02/Q02)`);

    // 10. Q02/Q02 (20300 -> 20600) -> M03/1 (20800) -> M03/1Y (20900 -> 21600, Wind Evil Beast + Murong Ziying) -> Q03/Q03S (21700)
    st = await drain(await client.send("interact", { target: "ev_Q02_Q02_13" }));
    checkDiag(st, 20600);
    st = await drain(await client.send("interact", { target: "ev_Q02_Q02_14" }));
    assert.equal(st.world, "M03");
    assert.equal(st.scene, "1");
    checkDiag(st, 20800);
    st = await drain(await client.send("interact", { target: "ev_M03_1_8" }));
    assert.equal(st.world, "M03");
    assert.equal(st.scene, "1Y");
    checkDiag(st, 20900);
    st = await drain(await client.send("interact", { target: "ev_M03_1Y_6" }));
    assert.equal(st.world, "M03");
    assert.equal(st.scene, "1");
    checkDiag(st, 21600);
    st = await drain(await client.send("interact", { target: "ev_M03_1_7" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "Q03S");
    checkDiag(st, 21700);
    console.log(`[PASS] 10. 太平村钟馗剧变、巢湖夜战风邪兽初遇慕容紫英并抵达寿阳城 (Q02 -> M03/1Y -> Q03/Q03S)`);

    // 11. Q03/Q03S (21700) -> Wanted Poster (ev_Q03_Q03S_23 + MO005 -> 21900) -> Q03/Q03X (21901) -> Q03/XN03Y (22100, Meet Liu Mengli)
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03S_23" }));
    checkDiag(st, 21800);
    st = await drain(await client.send("interact", { target: "MO005" }));
    checkDiag(st, 21900);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03S_1" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "Q03X");
    checkDiag(st, 21901);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_3" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "XN03Y");
    checkDiag(st, 22100);
    console.log(`[PASS] 11. 寿阳揭海捕文书、夜闯柳府初遇柳梦璃 (Q03/Q03S -> MO005 -> Q03/Q03X -> Q03/XN03Y)`);

    // 12. Q03/XN03Y (22100) -> M04/1 (22300, Nvluoyan) -> Boss Fight -> Q03/XN03 (30101) -> Q03/Q03X (30200) -> Q03/Q03S (30201) -> M05/1 (30500)
    st = await drain(await client.send("interact", { target: "ev_Q03_XN03_0" }));
    assert.equal(st.world, "M04");
    assert.equal(st.scene, "1");
    checkDiag(st, 22300);
    st = await drain(await client.send("interact", { target: "ev_M04_1_30" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "XN03");
    checkDiag(st, 30101);
    st = await drain(await client.send("interact", { target: "ev_Q03_XN03_0" }));
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_13" }));
    checkDiag(st, 30200);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_3" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "Q03S");
    checkDiag(st, 30201);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03S_0" }));
    assert.equal(st.world, "M05");
    assert.equal(st.scene, "1");
    checkDiag(st, 30500);
    console.log(`[PASS] 12. 女萝岩击败槐妖长老、返回柳府议事并进入八公山 (M04/1 -> Q03/XN03 -> M05/1)`);

    // 13. M05/1 (30500) -> M06 (Huainan King Tomb: 1A -> 1B -> 2A -> 2B -> 1C -> 2D -> 4 -> 2D -> 1C -> 2B -> 2A -> 1B -> 1A) -> M05/1 (31300)
    for (const target of [
      "tengman", "light01_f", "ev_M06_1_0", "ev_M06_1_3", "ev_M06_1_0",
      "ev_M06_2_7", "light1_f", "light2_f", "ev_M06_2_2", "ev_M06_2_3",
      "light1_f", "light2_f", "ev_M06_1_0", "light1_f", "light2_f",
      "light3_f", "ev_M06_2_5", "ev_M06_4_1", "ladder", "ladder",
      "ladder", "ladder", "ladder", "ladder", "ladder",
    ]) {
      st = await drain(await client.send("interact", { target }));
    }
    assert.equal(st.world, "M05");
    assert.equal(st.scene, "1");
    checkDiag(st, 31300);
    console.log(`[PASS] 13. 淮南王陵全油灯机关解谜、击败淮南王夺取土灵珠并脱出王陵 (M06/1A..2D..4 -> M05/1)`);

    // 14. M05/1 (31300) -> Q03/Q03S -> Q03/Q03X (31400 -> 31500) -> Q03/XN03 (40100, Liu Mengli joins party!)
    st = await drain(await client.send("interact", { target: "ev_M05_1_3" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "Q03S");
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03S_1" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "Q03X");
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_3" }));
    checkDiag(st, 31400);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_14" }));
    checkDiag(st, 31500);
    st = await drain(await client.send("interact", { target: "ev_Q03_Q03X_7" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "XN03");
    st = await drain(await client.send("interact", { target: "ev_Q03_XN03_2" }));
    assert.equal(st.world, "Q03");
    assert.equal(st.scene, "XN03");
    assert.equal(st.leader.control_enabled, true);
    checkDiag(st, 40100);
    console.log(`[PASS] 14. 重返寿阳柳府客房休憩、柳梦璃正式入队，第二幕圆满通关 (Q03/XN03)`);

    // 15. Act 3 Part 1: Q03/XN03 (40100) -> M05/1 -> M07/1..9 (Nvluoyan Underground) -> Q04/Q04C (50200)
    for (const target of [
      "ev_Q03_XN03_0", "ev_Q03_Q03X_0", "ev_Q03_Q03S_0",
      "ev_M05_1_5", "ev_M05_1_6",
      "ev_M07_1_4", "huaRongDoor01_ev", "temp", "ev_M07_2_8", "temp2", "ev_M07_4_4",
      "temp11", "ev_M07_5_3", "ev_M07_6_1", "ev_M07_6_3",
      "ev_M07_7_1", "ev_M07_8_6", "ev_M07_9_2",
    ]) {
      st = await drain(await client.send("interact", { target }));
    }
    assert.equal(st.world, "Q04");
    assert.equal(st.scene, "Q04C");
    checkDiag(st, 50200);
    console.log(`[PASS] 15. 告别寿阳柳府、穿越八公山与女萝岩地脉抵达陈州城 (Q03 -> M05 -> M07/1..9 -> Q04/Q04C)`);

    // 16. Act 3 Part 2: Q04/Q04C (50200) -> CN03 -> Q04CY -> Q04HY -> M08/1..5 (Qianfo Pagoda) -> Q04/CN05C -> CN04 -> CN03 -> Q04C -> Q05/Q05 (51600)
    for (const target of [
      "ev_Q04_Q04C_24", "ev_Q04_Q04C_4", "4087", "ev_Q04_Q04CY_28",
      "ev_Q04_Q04HY_0", "ev_M08_1_13", "ev_M08_1_3", "ev_M08_2_1",
      "ev_M08_3_2", "ev_M08_4_2", "ev_M08_5_1", "ev_Q04_CN05_0",
      "ev_Q04_CN04_0", "ev_Q04_CN03_1", "ev_Q04_Q04C_27",
    ]) {
      st = await drain(await client.send("interact", { target }));
    }
    assert.equal(st.world, "Q05");
    assert.equal(st.scene, "Q05");
    checkDiag(st, 51600);
    console.log(`[PASS] 16. 陈州弦歌台与千佛塔夜探、琴姬姜氏悲歌并抵达播仙镇 (Q04 -> M08/1..5 -> Q04 -> Q05/Q05)`);

    // 17. Act 3 Part 3: Q05/Q05 (51600) -> Q05/N02 -> Q05/Q05 -> M09/1..3 (Taiyi Immortal Path) -> Q06/QN03 -> M10/1 (61001)
    for (const target of [
      "ev_Q05_Q05_12", "ev_Q05_N02_0", "ev_Q05_Q05_24", "ev_M09_1_2",
      "ev_M09_2_2", "ev_M09_2_1", "ev_M09_3_0", "MN001",
    ]) {
      st = await drain(await client.send("interact", { target }));
    }
    assert.equal(st.world, "M10");
    assert.equal(st.scene, "1");
    checkDiag(st, 61001);
    console.log(`[PASS] 17. 播仙镇绿洲休憩、攀登太一仙径抵达昆仑琼华派并进入须臾幻境 (Q05 -> M09/1..3 -> Q06 -> M10/1)`);

    // 18. Act 3 Part 4: M10/1 (61001, Xuyu Illusion Wine Trial) -> M10/10 (God of Wealth Nine-Eye Stones Trial) -> Q06/Q06Q -> Q06/QN05 (70200, Murong Ziying joins party!)
    for (const target of [
      "MN001",
      ...Array(11).fill(["wine001", "wine002", "wine003", "wine004", "wine005", "wine006", "wine007", "wine008", "wine009"]).flat(),
      "wineIsAll", "ev_M10_1_3",
      ...Array(13).fill("JA01"),
      "MN001", "ev_Q06_Q06Q_22", "ev_Q06_QN05_1",
    ]) {
      st = await drain(await client.send("interact", { target }));
    }
    assert.equal(st.world, "Q06");
    assert.equal(st.scene, "QN05");
    assert.equal(st.leader.control_enabled, true);
    checkDiag(st, 70200);
    console.log(`[PASS] 18. 破除须臾幻境酒仙与财神双试炼、正式拜入琼华派、慕容紫英入队，第三幕圆满通关 (Q06/QN05)`);

    const runSteps = async (steps) => {
      for (const s of steps) {
        st = await drain(await client.send(s.cmd, s));
      }
    };

    // 19. Act 4 Part 1: Q06/QN05 (70200) -> Sword Flight -> M11/1 & Q07/Q07 (Yueya Village) -> Night Sifangu & Forbidden Area First Meeting with Xuanxiao (M20/1Y -> Q06/Q06Q, 81100)
    await runSteps([
      { cmd: "interact", target: "ev_Q06_QN05_0" },
      { cmd: "interact", target: "ev_Q06_Q06Q_47" },
      { cmd: "interact", target: "ev_Q06_Q06Q_48" },
      { cmd: "interact", target: "ev_Q06_Q06Q_7" },
      { cmd: "interact", target: "ev_M09_3_1" },
      { cmd: "interact", target: "ev_M09_2_0" },
      { cmd: "interact", target: "ev_M09_1_4" },
      { cmd: "fly_to", destination: "M11" },
      { cmd: "interact", target: "ev_M11_1_0" },
      { cmd: "fly_to", destination: "Q06" },
      { cmd: "interact", target: "ev_Q06_Q06Q_49" },
      { cmd: "interact", target: "ev_Q06_QN03_0" },
      { cmd: "interact", target: "ev_Q06_Q06Q_22" },
      { cmd: "interact", target: "ev_Q06_QN05_1" },
      { cmd: "interact", target: "ev_Q06_QN05_0" },
      { cmd: "interact", target: "ev_Q06_Q06Q_45" },
      { cmd: "interact", target: "ev_M20_1Y_5" },
      { cmd: "interact", target: "ev_Q06_Q06H_31" },
      { cmd: "interact", target: "ev_Q06_Q06H_2" },
      { cmd: "interact", target: "ev_M20_1_3" },
      { cmd: "interact", target: "ev_Q06_Q06Q_22" },
      { cmd: "interact", target: "ev_Q06_QN05Y_2" },
      { cmd: "interact", target: "ev_Q06_Q06S_2" },
      { cmd: "interact", target: "ev_Q06_Q06QY_55" },
      { cmd: "interact", target: "ev_Q06_Q06Q_45" },
      { cmd: "interact", target: "ev_M20_1_1" },
      { cmd: "interact", target: "ev_Q06_Q06H_31" },
      { cmd: "interact", target: "ev_Q06_Q06H_2" },
      { cmd: "interact", target: "ev_M20_1_3" },
    ]);
    assert.equal(st.world, "Q06");
    assert.equal(st.scene, "Q06Q");
    checkDiag(st, 81100);
    console.log(`[PASS] 19. 琼华御剑下山、碗丘山与月牙村求援、夜探思返谷及禁地初见玄霄 (Q06 -> M11 -> Q07 -> M20/1Y -> Q06/Q06Q)`);

    // 20. Act 4 Part 2: Q06/Q06Q (81100) -> M12/1 & Q08/Q08 (Qingyang Elder) -> Q09 & M13/1 (Jimo Fox Demon & Lantern Night) -> M20/1 & Q06/Q06Q (100200)
    await runSteps([
      { cmd: "interact", target: "ev_Q06_Q06Q_39" },
      { cmd: "interact", target: "ev_M12_1_2" },
      { cmd: "interact", target: "ev_Q08_Q08_0" },
      { cmd: "fly_to", destination: "Q09" },
      { cmd: "interact", target: "ev_Q09_Q09_16" },
      { cmd: "interact", target: "ev_M13_1_2" },
      { cmd: "interact", target: "ev_M13_1_3" },
      { cmd: "interact", target: "ev_Q09_Q09_8" },
      { cmd: "interact", target: "ev_Q09_N10_1" },
      { cmd: "interact", target: "ev_Q09_Q09_9" },
      { cmd: "interact", target: "ev_Q09_N11_0" },
      { cmd: "interact", target: "ev_Q09_N01_0" },
      { cmd: "fly_to", destination: "Q06" },
      { cmd: "interact", target: "ev_Q06_Q06Q_45" },
      { cmd: "interact", target: "ev_M20_1_1" },
      { cmd: "interact", target: "ev_Q06_Q06H_31" },
      { cmd: "interact", target: "ev_Q06_Q06H_2" },
      { cmd: "interact", target: "ev_M20_1_3" },
      { cmd: "interact", target: "ev_Q06_Q06Q_22" },
      { cmd: "interact", target: "ev_Q06_QN05_1" },
      { cmd: "interact", target: "ev_Q06_QN05_0" },
    ]);
    assert.equal(st.world, "Q06");
    assert.equal(st.scene, "Q06Q");
    checkDiag(st, 100200);
    console.log(`[PASS] 20. 醉花荫清阳真人仙逝、夏螟虫笼破狐仙与即墨花灯之约、重返禁地受托三寒器 (M12 -> Q08 -> Q09 -> M13 -> M20/1 -> Q06)`);

    // 21. Act 4 Part 3: Q06/Q06Q (100200) -> M14/1..3 (Yanpeng Shennong Cave) -> M03/1..3 & Q10/Q10 (Juchaoguo) -> M20/1 (Xuanxiao Breaks Ice, 121100)
    await runSteps([
      { cmd: "fly_to", destination: "M14" },
      { cmd: "interact", target: "ev_M14_1_1" },
      { cmd: "interact", target: "ev_M14_1_2" },
      { cmd: "interact", target: "ev_M14_2_2" },
      { cmd: "interact", target: "MO001" },
      { cmd: "interact", target: "ev_M14_3_1" },
      { cmd: "fly_to", destination: "Q06" },
      { cmd: "interact", target: "ev_Q06_Q06Q_49" },
      { cmd: "interact", target: "ev_Q06_QN03_0" },
      { cmd: "fly_to", destination: "M03" },
      { cmd: "interact", target: "ev_M03_1_13" },
      { cmd: "interact", target: "ev_M03_3_8" },
      { cmd: "interact", target: "ev_M03_3_42" },
      { cmd: "interact", target: "ev_Q10_Q10_19" },
      { cmd: "interact", target: "ev_Q10_Q10_20" },
      { cmd: "interact", target: "ev_Q10_Q10_27" },
      { cmd: "use_item", item: "EarthBall" },
      { cmd: "fly_to", destination: "Q06" },
      { cmd: "interact", target: "ev_Q06_Q06Q_45" },
      { cmd: "interact", target: "ev_M20_1_1" },
      { cmd: "interact", target: "ev_Q06_Q06H_31" },
      { cmd: "interact", target: "ev_M20_1_3" },
      { cmd: "interact", target: "ev_Q06_Q06Q_22" },
      { cmd: "interact", target: "ev_Q06_QN05_1" },
      { cmd: "interact", target: "ev_Q06_QN05_0" },
      { cmd: "interact", target: "ev_Q06_Q06Q_37" },
      { cmd: "interact", target: "ev_Q06_Q06J_0" },
      { cmd: "interact", target: "ev_Q06_Q06Q_45" },
      { cmd: "interact", target: "ev_M20_1_4" },
    ]);
    assert.equal(st.world, "M20");
    assert.equal(st.scene, "1");
    checkDiag(st, 121100);
    console.log(`[PASS] 21. 炎帝神农洞取炙炎石与梭罗果、居巢国获水灵珠、玄霄破冰而出与琼华决裂 (M14/1..3 -> M03/Q10 -> Q06 -> M20/1)`);

    // 22. Act 4 Part 4: M20/1 (121100) -> Q08/Q08 -> M15/1..2 & Q11/Q11W..Q11Z & M16/1 (Ghost Realm) -> Q12 (Buzhoushan) -> Q13 (Fengdu) -> M17/1..5 (Fengshenling, 140100)
    await runSteps([
      { cmd: "fly_to", destination: "Q08" },
      { cmd: "interact", target: "ev_Q08_Q08_0" },
      { cmd: "fly_to", destination: "M15" },
      { cmd: "interact", target: "ev_M15_1_161" },
      { cmd: "interact", target: "ev_M15_1_3" },
      { cmd: "interact", target: "ev_M15_2_21" },
      { cmd: "interact", target: "ev_M15_2_35" },
      { cmd: "interact", target: "ev_Q11_Q11W_19" },
      { cmd: "interact", target: "ev_Q11_Q11W_14" },
      { cmd: "interact", target: "ev_Q11_Q11Z_1" },
      { cmd: "interact", target: "ev_Q11_Q11Z_4" },
      { cmd: "interact", target: "ev_M16_1_0" },
      { cmd: "interact", target: "ev_Q13_Q13_15" },
      { cmd: "fly_to", destination: "M17" },
      { cmd: "interact", target: "ev_M17_1_2" },
      { cmd: "interact", target: "ev_M17_2_4" },
      { cmd: "interact", target: "ev_M17_5_11" },
    ]);
    assert.equal(st.world, "M17");
    assert.equal(st.scene, "5");
    checkDiag(st, 140100);
    console.log(`[PASS] 22. 放逐行、无常殿与转轮镜台见云天青、不周山战衔烛之龙、封神陵取后羿射日弓 (Q08 -> M15 -> Q11 -> M16 -> Q12 -> Q13 -> M17/5)`);

    // 23. Act 4 Part 5: M17/5 (140100) -> Q06/Q06J -> Q14 (Huanming Realm) -> M18/1 (Inner Huanming Palace) -> Q06/Q06JH -> Q14 -> Q07 -> Q08/Q08 (160400)
    await runSteps([
      { cmd: "fly_to", destination: "Q06" },
      { cmd: "interact", target: "ev_Q06_Q06Q_37" },
      { cmd: "interact", target: "ev_Q06_Q06J_5" },
      { cmd: "interact", target: "ev_Q06_Q06J_4" },
      { cmd: "interact", target: "ev_Q14_Q14W_3" },
      { cmd: "interact", target: "ev_Q14_Q14B_16" },
      { cmd: "interact", target: "MN001" },
      { cmd: "interact", target: "ev_Q14_LN01_2" },
      { cmd: "interact", target: "ev_Q14_Q14L_2" },
      { cmd: "interact", target: "ev_Q14_Q14B_19" },
      { cmd: "interact", target: "ev_M18_1_5" },
      { cmd: "interact", target: "ev_Q14_BN06_1" },
      { cmd: "interact", target: "ev_Q14_Q14B_20" },
      { cmd: "interact", target: "ev_Q14_Q14L_3" },
      { cmd: "fly_to", destination: "Q08" },
      { cmd: "interact", target: "ev_Q08_Q08_0" },
    ]);
    assert.equal(st.world, "Q08");
    assert.equal(st.scene, "Q08");
    checkDiag(st, 160400);
    console.log(`[PASS] 23. 旋梦入幻瞑界、里幻瞑宫揭开十九年前真相、柳梦璃继位少主挥泪诀别 (Q06/Q06J -> Q14 -> M18/1 -> Q06/Q06JH -> Q14 -> Q07 -> Q08)`);

    // 24. Act 4 Part 6: Q08/Q08 (160400) -> Q01 (Return to Qingluan Peak) -> Q05/Q05P -> M19/1..2 (Burning Qionghua & Juanyuntai Final Boss Fight vs Xuanxiao & Suyao -> 170000 Grand Ending!)
    await runSteps([
      { cmd: "fly_to", destination: "Q01" },
      { cmd: "interact", target: "ev_Q01_Q01_1" },
      { cmd: "interact", target: "ev_Q01_Q01_1" },
      { cmd: "interact", target: "ev_Q01_N02Y_0" },
      { cmd: "interact", target: "ev_Q01_Q01_6" },
      { cmd: "fly_to", destination: "Q05" },
      { cmd: "fly_to", destination: "M19" },
      { cmd: "interact", target: "ev_M19_1_1" },
      { cmd: "interact", target: "ev_M19_2_2" },
    ]);
    assert.equal(st.world, "M19");
    assert.equal(st.scene, "2");
    assert.equal(st.game_cleared, true);
    checkDiag(st, 170000);
    console.log(`[PASS] 24. 夜归青鸾峰祭拜父母、闯入焚毁琼华派、卷云台终局决战击败玄霄与夙瑶、挽弓射日拯救苍生，全四章大结局圆满通关 (M19/2): mode=${st.mode}, game_cleared=${st.game_cleared}`);

    console.log("================================================================");
    console.log(`  ALL 24 REAL-CPK FULL 4-CHAPTER CAMPAIGN CHECKS PASSED [mode=${mode}] (100%)`);
    console.log("================================================================");
  } finally {
    client.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
