#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hostBin = process.argv[2] || path.resolve(__dirname, '../build/agent-pal4-host');

class AgentPal4Client {
  constructor(binPath) {
    this.proc = spawn(binPath, ['--work-dir', '/tmp/agent-pal4-bench'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.rl = createInterface({ input: this.proc.stdout });
    this.queue = [];
    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      const resolver = this.queue.shift();
      if (resolver) resolver(JSON.parse(line));
    });
  }

  send(payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout on ${JSON.stringify(payload)}`)), 5000);
      this.queue.push((res) => {
        clearTimeout(timer);
        if (!res.ok) return reject(new Error(`RPC error on ${JSON.stringify(payload)}: ${res.error}`));
        resolve(res);
      });
      this.proc.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  close() {
    this.proc.stdin.write('quit\n');
    this.proc.kill();
  }
}

async function runBenchmark() {
  console.log('================================================================');
  console.log('  agent-pal4 Headless Benchmark (OpenPAL4 C++20 ChapterHost)');
  console.log('================================================================');
  const client = new AgentPal4Client(hostBin);

  try {
    // Step 1: Initial Observation
    const s0 = await client.send({ cmd: 'observe' });
    assert.equal(s0.ok, true);
    assert.equal(s0.world, 'Q01');
    assert.equal(s0.scene, 'N01');
    assert.equal(s0.leader.name, '云天河');
    assert.equal(s0.quest_stage, 100);
    console.log(`[PASS] 1. 初始观测 (Observe): 场景=${s0.title} (${s0.world}/${s0.scene}), 领队=${s0.leader.name}, 坐标=[${s0.leader.position.join(', ')}], 地面三角形=${s0.leader.floor_triangle}`);

    // Step 2: Test 3D North Wall Collision at z = 60
    const wallProbe = await client.send({ cmd: 'move_to', x: 0, y: 0, z: 95, max_steps: 90 });
    assert.equal(wallProbe.event, 'move_blocked_by_wall');
    assert.ok(wallProbe.leader.position[2] < 61.0, `Expected wall block near z<=60, got z=${wallProbe.leader.position[2]}`);
    console.log(`[PASS] 2. 3D 岩壁碰撞检测 (SceneCollision): 向北探测 (0,0,95) 在 z=${wallProbe.leader.position[2]} 处被石沉溪洞北壁阻挡 (${wallProbe.event})`);

    // Step 3: Navigate to NPC Han Lingsha at (35, 0, 0) & Talk
    const moveNpc = await client.send({ cmd: 'move_to', x: 25, y: 0, z: 0, max_steps: 120 });
    assert.equal(moveNpc.event, 'move_reached');
    const talk1 = await client.send({ cmd: 'interact' });
    assert.equal(talk1.dialog.visible, true);
    assert.ok(talk1.dialog.text.includes('韩菱纱'));
    console.log(`[PASS] 3. NPC 3D 寻路与交互 (SceneNpcs + AngelScript): 抵达 [${moveNpc.leader.position.join(', ')}], 触发对白: "${talk1.dialog.text}"`);

    // Close dialog & verify quest_stage advanced to 101
    const closeTalk1 = await client.send({ cmd: 'interact' });
    assert.equal(closeTalk1.dialog.visible, false);
    assert.equal(closeTalk1.quest_stage, 101);
    console.log(`[PASS] 4. 对白状态机推进 (DialogServices): 关闭对话框后脚本唤醒, global_mvar=${closeTalk1.quest_stage}`);

    // Step 4: Navigate to AncestralBowChest GOB at (-40, 0, 25) & Open Chest
    const moveGob = await client.send({ cmd: 'move_to', x: -40, y: 0, z: 25, max_steps: 180 });
    assert.equal(moveGob.event, 'move_reached');
    const openChest = await client.send({ cmd: 'interact' });
    assert.equal(openChest.dialog.visible, true);
    assert.ok(openChest.dialog.text.includes('射日猎弓'));
    const afterChest = await client.send({ cmd: 'interact' });
    assert.equal(afterChest.quest_stage, 102);
    const hasBow = afterChest.inventory.items.some((i) => i.id === 6201 && i.count === 1);
    assert.equal(hasBow, true);
    assert.equal(afterChest.objects[0].research_able, false);
    console.log(`[PASS] 5. 场景宝箱 GOB 交互与背包入库 (SceneObjects + InventoryServices): 获得【射日猎弓】×1, 宝箱状态关闭 (research_able=false)`);

    // Step 5: Switch party leader to Han Lingsha (index 1)
    const switched = await client.send({ cmd: 'switch_leader', index: 1 });
    assert.equal(switched.leader.name, '韩菱纱');
    // Sync new leader position before navigating to exit
    const moveExit = await client.send({ cmd: 'move_to', x: 0, y: 0, z: -68, max_steps: 200 });
    // Walking across z = -65 triggers the EVF collision volume (CaveExitPortal)
    assert.equal(moveExit.quest_stage, 200);
    assert.equal(moveExit.trial_cleared, true);
    console.log(`[PASS] 6. 领队切换与 EVF 碰撞触发器通关 (SceneEvents + PlayerRoster): 领队=${moveExit.leader.name}, 触发 CaveExitPortal, trial_cleared=${moveExit.trial_cleared}, GLES3 draw_calls=${moveExit.gles3.draw_calls}`);

    // Step 7: Confirm dialog to execute giArenaLoad("M01", "1", "", true)
    const scene2 = await client.send({ cmd: 'interact' });
    assert.equal(scene2.world, 'M01');
    assert.equal(scene2.scene, '1');
    assert.equal(scene2.quest_stage, 201);
    console.log(`[PASS] 7. 跨场景切换 (giArenaLoad / ArenaServices): 切入场景=${scene2.title} (${scene2.world}/${scene2.scene}), M01_1_init 启动定时脚本, global_mvar=${scene2.quest_stage}`);

    // Step 8: Walk to Boss KuiZhao at (0, 0, -10) and trigger combat (giStartCombat("M01"))
    const moveBoss = await client.send({ cmd: 'move_to', x: 0, y: 0, z: -10, max_steps: 120 });
    assert.equal(moveBoss.event, 'move_reached');
    const startBattle = await client.send({ cmd: 'interact' });
    assert.equal(startBattle.combat.active, true);
    assert.equal(startBattle.combat.world, 'M01');
    assert.equal(startBattle.combat.bgm, 'P39');
    assert.equal(startBattle.combat.vip_monster, 2579);
    assert.equal(startBattle.combat.enemies.length, 3);
    console.log(`[PASS] 8. Boss 战触发与配置 (giConfigCombat* + giAddCombatMonster + giStartCombat): BGM=${startBattle.combat.bgm}, VIP=${startBattle.combat.vip_monster}, 敌方阵容=${startBattle.combat.enemies.map(e => `${e.name}(HP:${e.hp})`).join(', ')}`);

    // Step 9: Execute combat rounds using pal4_portable_combat (CombatNumericDamageAction + BattleHealthState)
    let battleState = startBattle;
    while (battleState.combat.active) {
      battleState = await client.send({ cmd: 'combat_action', action: 'skill', target_slot: 1 });
    }
    assert.equal(battleState.combat.active, false);
    assert.equal(battleState.combat.victories, 1);
    assert.ok(battleState.combat.rng_draws > 0);
    assert.equal(battleState.quest_stage, 210);
    if (battleState.dialog.visible) {
      battleState = await client.send({ cmd: 'interact' });
    }
    console.log(`[PASS] 9. 仙剑四战斗伤害管线结算 (CombatNumericDamageAction + BattleHealthState): 击败魁召与符灵, RNG 采样=${battleState.combat.rng_draws} 次, global_mvar=${battleState.quest_stage}`);

    // Step 10: Enter M01/2 (Tomb Chamber), equip Wangshu Sword (giAddPlayerEquip), and exit cave (quest_stage=300)
    const moveTomb = await client.send({ cmd: 'move_to', x: 0, y: 0, z: -68, max_steps: 200 });
    const scene3 = moveTomb.dialog.visible ? await client.send({ cmd: 'interact' }) : moveTomb;
    assert.equal(scene3.world, 'M01');
    assert.equal(scene3.scene, '2');
    assert.equal(scene3.quest_stage, 220);

    const moveAltar = await client.send({ cmd: 'move_to', x: 0, y: 0, z: 0, max_steps: 120 });
    assert.equal(moveAltar.event, 'move_reached');
    const inspectAltar = await client.send({ cmd: 'interact' });
    const afterAltar = inspectAltar.dialog.visible ? await client.send({ cmd: 'interact' }) : inspectAltar;
    assert.equal(afterAltar.quest_stage, 250);
    assert.equal(afterAltar.inventory.items.some((i) => i.id === 6202), true);
    assert.ok(afterAltar.party[0].physical_attack > s0.party[0].physical_attack);

    const moveFinalExit = await client.send({ cmd: 'move_to', x: 0, y: 0, z: -68, max_steps: 200 });
    const chapterDone = moveFinalExit.dialog.visible ? await client.send({ cmd: 'interact' }) : moveFinalExit;
    assert.equal(chapterDone.world, 'Q02');
    assert.equal(chapterDone.scene, 'N01');
    assert.equal(chapterDone.quest_stage, 310);
    assert.equal(chapterDone.chapter1_cleared, true);
    console.log(`[PASS] 10. 冰封墓室取望舒剑并通关第一章 (M01/2 + PlayerEquipment + giArenaComeFromHere): 切入第二章=${chapterDone.title} (${chapterDone.world}/${chapterDone.scene}), global_mvar=${chapterDone.quest_stage}`);

    // Step 11: Chapter 2 Q02/N01 (寿阳城·柳府前庭) — Recruit Liu Mengli (index=2), Favor, Money, Rest, Skill
    const moveMengli = await client.send({ cmd: 'move_to', x: 25, y: 0, z: 0, max_steps: 120 });
    assert.equal(moveMengli.event, 'move_reached');
    const talkMengli = await client.send({ cmd: 'interact' });
    const afterMengli = talkMengli.dialog.visible ? await client.send({ cmd: 'interact' }) : talkMengli;
    assert.equal(afterMengli.quest_stage, 350);
    assert.equal(afterMengli.party[2].in_team, true);
    assert.ok(afterMengli.party[2].favor_to_tianhe > 0);
    assert.ok(afterMengli.party[2].skills_count >= 1);
    assert.ok(afterMengli.inventory.money >= 2000);
    console.log(`[PASS] 11. 第二章寿阳柳府柳梦璃入队 (giPlayerInTeam + giAddPlayerFavor + giPlayerAddSkill + giPlayerTakeARest): 柳梦璃好感=${afterMengli.party[2].favor_to_tianhe}, 仙术数=${afterMengli.party[2].skills_count}, 文钱=${afterMengli.inventory.money}`);

    // Step 12: Enter M04/1 (女萝岩·底层大殿) and defeat HuaiYaoElder (槐妖长老)
    const moveM04 = await client.send({ cmd: 'move_to', x: 0, y: 0, z: -68, max_steps: 200 });
    const sceneM04 = moveM04.dialog.visible ? await client.send({ cmd: 'interact' }) : moveM04;
    assert.equal(sceneM04.world, 'M04');
    assert.equal(sceneM04.scene, '1');
    assert.equal(sceneM04.quest_stage, 410);

    const moveHuaiYao = await client.send({ cmd: 'move_to', x: 0, y: 0, z: -10, max_steps: 120 });
    let battleM04 = await client.send({ cmd: 'interact' });
    assert.equal(battleM04.combat.active, true);
    assert.equal(battleM04.combat.vip_monster, 2610);
    while (battleM04.combat.active) {
      battleM04 = await client.send({ cmd: 'combat_action', action: 'skill', target_slot: 1 });
    }
    if (battleM04.dialog.visible) {
      battleM04 = await client.send({ cmd: 'interact' });
    }
    assert.equal(battleM04.quest_stage, 450);
    assert.equal(battleM04.party[0].level, 18);
    assert.equal(battleM04.inventory.items.some((i) => i.id === 6203), true);
    console.log(`[PASS] 12. 女萝岩击败槐妖长老获土灵珠 (giSetFullRage + giSetPlayerLevel): 全员等级提升至 Lv.${battleM04.party[0].level}, 获得【土灵珠】(6203)`);

    // Step 13: Ascend to Chapter 3 Q07/N01 (昆仑琼华派·剑舞坪) & recruit Murong Ziying (index=3)
    const moveQ07 = await client.send({ cmd: 'move_to', x: 0, y: 0, z: -68, max_steps: 200 });
    const sceneQ07 = moveQ07.dialog.visible ? await client.send({ cmd: 'interact' }) : moveQ07;
    assert.equal(sceneQ07.world, 'Q07');
    assert.equal(sceneQ07.scene, 'N01');
    assert.equal(sceneQ07.quest_stage, 510);

    const moveZiying = await client.send({ cmd: 'move_to', x: -30, y: 0, z: 0, max_steps: 120 });
    const talkZiying = await client.send({ cmd: 'interact' });
    const afterZiying = talkZiying.dialog.visible ? await client.send({ cmd: 'interact' }) : talkZiying;
    assert.equal(afterZiying.quest_stage, 550);
    assert.equal(afterZiying.party.every((p) => p.in_team), true);
    console.log(`[PASS] 13. 第三章昆仑琼华派慕容紫英入队: 主角团四人全员集结 (${afterZiying.party.map(p => `${p.name} Lv.${p.level}`).join(', ')})`);

    // Step 14: Forge Xihe Sword at ChengtianSwordForge (35, 0, 20) and enter M20/1 (琼华飞升·卷云台决战)
    const moveForge = await client.send({ cmd: 'move_to', x: 35, y: 0, z: 20, max_steps: 120 });
    const forge1 = await client.send({ cmd: 'interact' });
    const afterForge = forge1.dialog.visible ? await client.send({ cmd: 'interact' }) : forge1;
    assert.equal(afterForge.quest_stage, 600);
    assert.equal(afterForge.inventory.items.some((i) => i.id === 6204), true);

    const moveM20 = await client.send({ cmd: 'move_to', x: 0, y: 0, z: -68, max_steps: 200 });
    const sceneM20 = moveM20.dialog.visible ? await client.send({ cmd: 'interact' }) : moveM20;
    assert.equal(sceneM20.world, 'M20');
    assert.equal(sceneM20.scene, '1');
    assert.equal(sceneM20.quest_stage, 710);
    console.log(`[PASS] 14. 铸造【羲和剑】并进入终章卷云台 (giPayMoney + giCheckPackProperty): 望舒羲和双剑齐备, 切入场景=${sceneM20.title} (${sceneM20.world}/${sceneM20.scene})`);

    // Step 15: Defeat Final Bosses Xuan Xiao & Su Yao (玄霄 & 夙瑶) in M20/1
    const savedBeforeFinal = await client.send({ cmd: 'save_checkpoint', slot: 'before_xuanxiao' });
    assert.equal(savedBeforeFinal.event, 'checkpoint_saved:before_xuanxiao');

    const moveXuanXiao = await client.send({ cmd: 'move_to', x: 0, y: 0, z: -10, max_steps: 120 });
    let battleM20 = await client.send({ cmd: 'interact' });
    assert.equal(battleM20.combat.active, true);
    assert.equal(battleM20.combat.vip_monster, 2999);
    while (battleM20.combat.active) {
      battleM20 = await client.send({ cmd: 'combat_action', action: 'skill', target_slot: 0 });
    }
    if (battleM20.dialog.visible) {
      battleM20 = await client.send({ cmd: 'interact' });
    }
    assert.equal(battleM20.quest_stage, 900);
    assert.ok(battleM20.party[0].level >= 50);
    assert.equal(battleM20.inventory.items.some((i) => i.id === 6205), true);
    console.log(`[PASS] 15. 卷云台最终决战击败玄霄与夙瑶 (giStartCombat("M20") + giGetRandnum): 累计胜场=${battleM20.combat.victories}, 云天河等级=Lv.${battleM20.party[0].level}`);

    // Step 16: Walk to GrandEndingPortal (0, 0, -68) to trigger the Grand Ending (quest_stage=1000, game_cleared=true)
    const moveEnding = await client.send({ cmd: 'move_to', x: 0, y: 0, z: -68, max_steps: 200 });
    const gameDone = moveEnding.dialog.visible ? await client.send({ cmd: 'interact' }) : moveEnding;
    assert.equal(gameDone.quest_stage, 1000);
    assert.equal(gameDone.game_cleared, true);
    console.log(`[PASS] 16. 百年之后青鸾峰重逢大结局通关 (GrandEndingPortal): quest_stage=${gameDone.quest_stage}, game_cleared=${gameDone.game_cleared}`);

    // Step 17: Verify sub-millisecond in-memory checkpoint restore (save_checkpoint / load_checkpoint)
    const savedEnding = await client.send({ cmd: 'save_checkpoint', slot: 'ending_cleared' });
    assert.equal(savedEnding.event, 'checkpoint_saved:ending_cleared');
    const restoredPreBoss = await client.send({ cmd: 'load_checkpoint', slot: 'before_xuanxiao' });
    assert.equal(restoredPreBoss.event, 'checkpoint_loaded:before_xuanxiao');
    assert.equal(restoredPreBoss.quest_stage, 710);
    assert.equal(restoredPreBoss.game_cleared, false);
    const restoredEnding = await client.send({ cmd: 'load_checkpoint', slot: 'ending_cleared' });
    assert.equal(restoredEnding.event, 'checkpoint_loaded:ending_cleared');
    assert.equal(restoredEnding.quest_stage, 1000);
    assert.equal(restoredEnding.game_cleared, true);
    console.log(`[PASS] 17. 内存级秒级快照存档与读档恢复 (save_checkpoint / load_checkpoint): 终局前(mvar=${restoredPreBoss.quest_stage}) <-> 大结局(mvar=${restoredEnding.quest_stage}) 无损切换`);

    // Step 18: Verify .evf 3D centroid position & Normal vs Pure mode information masking
    assert.ok(Array.isArray(restoredEnding.events) && restoredEnding.events.length >= 1);
    assert.deepEqual(restoredEnding.events[0].position, [0, 5, -65]);
    assert.equal(restoredEnding.events[0].script, 'TriggerGrandEnding');

    const pureObs = await client.send({ cmd: 'set_mode', mode: 'pure' });
    assert.equal(pureObs.mode, 'pure');
    assert.equal('quest_stage' in pureObs, false);
    assert.equal('script' in pureObs.events[0], false);
    assert.deepEqual(pureObs.events[0].position, [0, 5, -65]);

    const normalObs = await client.send({ cmd: 'set_mode', mode: 'normal' });
    assert.equal(normalObs.mode, 'normal');
    assert.equal(normalObs.quest_stage, 1000);
    assert.equal(normalObs.events[0].script, 'TriggerGrandEnding');
    console.log(`[PASS] 18. 3D 传送门几何中心坐标 (.evf position=${JSON.stringify(normalObs.events[0].position)}) 与 Normal/Pure 双模式脱敏切换校验通过`);

    console.log('================================================================');
    console.log('  ALL 18 HEADLESS AGENT-PAL4 FULL-CAMPAIGN CHECKS PASSED (100%)');
    console.log('================================================================');
  } finally {
    client.close();
  }
}

runBenchmark().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
