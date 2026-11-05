#!/usr/bin/env node
/**
 * run-argon.mjs — 使用 agy-cli:gemini-4-argon 驱动 OpenPAL4 (agent-pal4-host) 进行无头 3D 闯关评测
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const HOST_BIN = process.env.AGENT_PAL4_HOST_BIN || path.join(ROOT_DIR, 'build', 'agent-pal4-host');
const DEFAULT_REAL_CPK = '/Volumes/T7-Data/pal/pal4-data/仙剑奇侠传4/gamedata';
function parseCliGameData() {
  const idx = process.argv.indexOf('--game-data');
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  if (process.argv.includes('--real-cpk')) {
    return DEFAULT_REAL_CPK;
  }
  return process.env.AGENT_PAL4_GAME_DATA || '';
}
const GAME_DATA = parseCliGameData();
const IS_REAL_CPK = Boolean(GAME_DATA);
const AGY_BIN = process.env.BENCH_AGY_BIN || path.join(os.homedir(), '.local', 'bin', 'agy');
function parseCliModel() {
  const idx = process.argv.indexOf('--model');
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return process.env.BENCH_MODEL || 'gemini-4-argon-medium';
}

const MODEL = parseCliModel();

function parseCliMode() {
  const idx = process.argv.indexOf('--mode');
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1].toLowerCase() === 'pure' ? 'pure' : 'normal';
  }
  return (process.env.BENCH_MODE || 'normal').toLowerCase() === 'pure' ? 'pure' : 'normal';
}

const MODE = parseCliMode();

class HostBridge {
  constructor(binPath, workDir, gameData, mode) {
    const args = ['--work-dir', workDir, '--mode', mode];
    if (gameData) args.push('--game-data', gameData);
    this.proc = spawn(binPath, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.queue = [];
    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      const resolver = this.queue.shift();
      if (resolver) resolver(JSON.parse(line));
    });
  }

  rpc(payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Host RPC timeout: ${JSON.stringify(payload)}`)), 30000);
      this.queue.push((res) => {
        clearTimeout(timer);
        resolve(res);
      });
      this.proc.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  close() {
    try {
      this.proc.stdin.write('quit\n');
      this.proc.kill();
    } catch {}
  }
}

const TOOLS = [
  {
    name: 'observe',
    description: 'Observe current 3D scene state, leader position, party members (in_team), dialog, inventory, NPCs, chests (objects), and events.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'move_to',
    description: 'Navigate leader in 3D world space toward (x, y, z) using camera-relative analog input and 3D collision detection.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Target X coordinate' },
        y: { type: 'number', description: 'Target Y coordinate (default 0)' },
        z: { type: 'number', description: 'Target Z coordinate' },
        max_steps: { type: 'number', description: 'Max simulation frames (default 180)' },
      },
      required: ['x', 'z'],
    },
  },
  {
    name: 'interact',
    description: 'If a dialog box is visible, advance/confirm the dialog. Otherwise interact with the nearest NPC or chest (GOB) within 14 units (or auto-walk to and interact with a named target NPC/object/event if `target` is specified). Supports optional `repeat` (1..120) for repetitive collection trials.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Optional NPC, object, or event name to approach and interact with' },
        repeat: { type: 'number', description: 'Optional repeat count (1..120) for repetitive collection trials' },
      },
    },
  },
  {
    name: 'wait',
    description: 'Advance simulation by `frames` (default 30 = 1 second) while waiting for cutscenes, camera pans, NPC movement, or timed scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        frames: { type: 'number', description: 'Frames to advance at 30 FPS (default 30)' },
      },
    },
  },
  {
    name: 'switch_leader',
    description: 'Switch the controlled party leader to slot index (0=云天河, 1=韩菱纱, 2=柳梦璃, 3=慕容紫英). Target member must have in_team=true.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Party member slot index (0..3)' },
      },
      required: ['index'],
    },
  },
  {
    name: 'combat_action',
    description: 'Execute a combat turn when combat.active is true. action can be "skill" (AOE magic skill hitting all enemies), "attack" (single-target physical attack on target_slot), or "item" (use 止血草 to heal party).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '"skill", "attack", or "item"' },
        target_slot: { type: 'number', description: 'Enemy slot index (0..2, default 1)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'save_checkpoint',
    description: 'Save an instant in-memory checkpoint of the current scene, party, inventory, and story globals.',
    inputSchema: {
      type: 'object',
      properties: {
        slot: { type: 'string', description: 'Checkpoint slot name (e.g. "ch1")' },
      },
      required: ['slot'],
    },
  },
  {
    name: 'load_checkpoint',
    description: 'Restore a previously saved in-memory checkpoint by slot name.',
    inputSchema: {
      type: 'object',
      properties: {
        slot: { type: 'string', description: 'Checkpoint slot name (e.g. "ch1")' },
      },
      required: ['slot'],
    },
  },
  {
    name: 'use_item',
    description: 'Use a special adventure item from inventory, such as "EarthBall" (土灵珠) to teleport to a dungeon entrance.',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Item name, e.g. "EarthBall" or "土灵珠"' },
      },
      required: ['item'],
    },
  },
  {
    name: 'fly_to',
    description: 'Use in-game Sword Flight (御剑江湖 via WorldMap.csb, available once unlocked in Chapter 4) to fly to a world map destination.',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'Destination world ID on the World Map (e.g. "Q06", "M11", "Q09", "M14", "M03", "Q08", "M15", "M17", "Q01", "Q05", "M19")' },
      },
      required: ['destination'],
    },
  },
  ...(MODE === 'normal'
    ? [
        {
          name: 'warp_scene',
          description: '[Normal Mode Debug] Directly load and warp to a target (world, scene) arena.',
          inputSchema: {
            type: 'object',
            properties: {
              world: { type: 'string', description: 'World ID (e.g. "Q01", "M01", "Q02")' },
              scene: { type: 'string', description: 'Scene ID (e.g. "N01", "1", "2")' },
            },
            required: ['world', 'scene'],
          },
        },
        {
          name: 'set_quest_stage',
          description: '[Normal Mode Debug] Override main story global_mvar (quest_stage) for Play-and-Fix testing.',
          inputSchema: {
            type: 'object',
            properties: {
              quest_stage: { type: 'number', description: 'Target global_mvar integer value' },
            },
            required: ['quest_stage'],
          },
        },
      ]
    : []),
];

async function main() {
  if (!fs.existsSync(HOST_BIN)) {
    throw new Error(`Missing host binary: ${HOST_BIN}`);
  }
  if (!fs.existsSync(AGY_BIN)) {
    throw new Error(`Missing agy CLI binary: ${AGY_BIN}`);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const prefix = MODEL.includes('opus')
    ? 'opus'
    : MODEL.includes('sonnet')
      ? 'sonnet'
      : MODEL.includes('flash')
        ? 'flash'
        : 'argon';
  const outDir = path.join(ROOT_DIR, 'bench', 'out', `${prefix}-${stamp}`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal4-argon-'));
  fs.mkdirSync(outDir, { recursive: true });

  const host = new HostBridge(HOST_BIN, path.join(tmpDir, 'host-work'), GAME_DATA, MODE);
  if (IS_REAL_CPK) {
    await host.rpc({ cmd: 'set_time_scale', scale: 30.0 });
  }
  const initialObs = await host.rpc({ cmd: 'observe' });

  const traceFile = path.join(outDir, 'episode.jsonl');
  const clientLogFile = path.join(outDir, 'client.jsonl');
  const resultFile = path.join(outDir, 'result.json');
  const traceStream = fs.createWriteStream(traceFile, { flags: 'a' });
  traceStream.write(
    JSON.stringify({
      type: 'start',
      timestamp: new Date().toISOString(),
      model: `agy-cli:${MODEL}`,
      mode: MODE,
      realCpk: IS_REAL_CPK,
      initial: initialObs,
    }) + '\n'
  );

  let toolCalls = 0;
  let clearedState = null;

  const compactStateForModel = (state) => {
    if (!IS_REAL_CPK) return state;
    const wp = state.journal?.waypoint || '';
    const filterList = (list = [], max = 8) => {
      if (!Array.isArray(list)) return [];
      const sorted = [...list].sort((a, b) => {
        if (a.name === wp) return -1;
        if (b.name === wp) return 1;
        return (a.distance ?? 999) - (b.distance ?? 999);
      });
      return sorted.slice(0, max);
    };
    return {
      ...state,
      npcs: filterList(state.npcs, 8),
      objects: filterList(state.objects, 10),
      events: filterList(state.events, 10),
      monsters: filterList(state.monsters, 4),
    };
  };

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const msg = JSON.parse(body || '{}');
    if (msg.method === 'tools/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }));
      return;
    }
    if (msg.method === 'tools/call') {
      const { name, arguments: args = {} } = msg.params || {};
      toolCalls++;
      const payload = { cmd: name, ...args };
      const state = await host.rpc(payload);
      traceStream.write(JSON.stringify({ type: 'call', step: toolCalls, tool: name, args, state }) + '\n');
      console.log(
        `[Step ${toolCalls}] ${name}(${JSON.stringify(args)}) -> scene=${state.world}/${state.scene} event=${state.event?.slice(0, 60)} leader=${state.leader?.name}@${JSON.stringify(state.leader?.position)} waypoint=${state.journal?.waypoint || '-'} combat=${state.combat?.active ? `round_${state.combat.round}` : `idle(v=${state.combat?.victories ?? 0})`} game_cleared=${state.game_cleared}`
      );
      if (state.game_cleared && !clearedState) {
        clearedState = state;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(compactStateForModel(state), null, 2) }],
          },
        })
      );
      return;
    }
    res.writeHead(400);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  const helperFile = path.join(tmpDir, 'pal4bench.mjs');
  fs.writeFileSync(
    helperFile,
    `#!/usr/bin/env node
const [,, name, rawArgs] = process.argv;
const args = rawArgs ? JSON.parse(rawArgs) : {};
const r = await fetch(${JSON.stringify(url)}, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: name === '--list' ? 'tools/list' : 'tools/call',
    params: name === '--list' ? {} : { name, arguments: args }
  })
});
const j = await r.json();
if (name === '--list') console.log(JSON.stringify(j.result?.tools || [], null, 2));
else console.log((j.result?.content || []).map(c => c.text || '').join('\\n'));
`,
    { mode: 0o755 }
  );

  const toolsDoc = TOOLS.map(
    (t) =>
      `- \`node ${helperFile} ${t.name} '${JSON.stringify(
        Object.fromEntries(Object.keys(t.inputSchema.properties || {}).map((k) => [k, `<${k}>`]))
      )}'\`: ${t.description}`
  ).join('\n');

  const normalGuide = [
    `You are playing Chinese Paladin 4 (仙剑奇侠传四 - OpenPAL4 C++20 Headless Runtime) in NORMAL (Play-and-Fix) mode across the full 4-Chapter, 7-Scene campaign from Stone Sunken Cave to the Grand Finale at Qionghua's Juanyun Platform:`,
    `1. Chapter 1 - Scene Q01/N01 (青鸾峰·石沉溪洞): Talk to Han Lingsha at (35, 0, 0), open AncestralBowChest at (-40, 0, 25), switch leader to Han Lingsha (index=1), walk to the south cave portal (0, 0, -68), and confirm the dialog to load M01/1.`,
    `2. Chapter 1 - Scene M01/1 (石沉溪洞·符灵大厅): Walk to Boss KuiZhao (魁召) at (0, 0, -10), interact to trigger combat, use \`combat_action\` (\`{"action": "skill", "target_slot": 1}\`) until \`combat.active\` becomes false, confirm dialog, then walk to the south portal (0, 0, -68) and confirm dialog to load M01/2.`,
    `3. Chapter 1 - Scene M01/2 (石沉溪洞·冰封墓室): Interact with WangshuSwordAltar at (0, 0, 0) to obtain & equip 【望舒剑】, confirm dialog, then walk to the south exit (0, 0, -68) and confirm dialog to enter Chapter 2 (Q02/N01).`,
    `4. Chapter 2 - Scene Q02/N01 (寿阳城·柳府前庭): Walk to LiuMengli (柳梦璃) at (25, 0, 0), interact & confirm dialog to recruit her into the party, then walk to the south portal (0, 0, -68) and confirm dialog to enter M04/1.`,
    `5. Chapter 2 - Scene M04/1 (女萝岩·底层大殿): Walk to Boss HuaiYaoElder (槐妖长老) at (0, 0, -10), interact to start combat, use \`combat_action\` (\`{"action": "skill", "target_slot": 1}\`) until \`combat.active\` is false, confirm dialog to obtain 【土灵珠】, then walk to the south portal (0, 0, -68) and confirm dialog to ascend to Chapter 3 (Q07/N01).`,
    `6. Chapter 3 - Scene Q07/N01 (昆仑琼华派·剑舞坪): Walk to MurongZiying (慕容紫英) at (-30, 0, 0), interact & confirm dialog so all 4 heroes are in the party. Then walk to ChengtianSwordForge at (35, 0, 20), interact & confirm dialog to forge 【羲和剑】. Finally walk to the south portal (0, 0, -68) and confirm dialog to enter Chapter 4 (M20/1).`,
    `7. Chapter 4 - Scene M20/1 (琼华飞升·卷云台决战): Walk to Final Bosses XuanXiao & SuYao (玄霄 & 夙瑶) at (0, 0, -10), interact to start the final boss battle, use \`combat_action\` (\`{"action": "skill", "target_slot": 0}\`) until \`combat.active\` is false, confirm dialog, and walk to GrandEndingPortal at (0, 0, -68) (confirming any dialog) until \`"game_cleared": true\`.`,
  ];

  const pureGuide = [
    `You are playing Chinese Paladin 4 (仙剑奇侠传四 - OpenPAL4 C++20 Headless Runtime) in PURE (Zero-Prior / Zero-Walkthrough) mode.`,
    `No external walkthrough, quest stage IDs, or internal script function names are exposed. You must explore and clear the game purely from in-game observations:`,
    `- Inspect \`journal\` (your in-game Quest Journal 竹简 \`summary\` and Minimap Waypoint \`waypoint\`), \`npcs\`, \`objects\`, \`monsters\`, and \`events\` in each scene.`,
    `- When \`journal.waypoint\` is an NPC/object/event name (e.g. \`"MO002"\`, \`"ev_Q01_Q01_1"\`, \`"light1_f"\`), call \`interact\` with \`{"target": "<waypoint>"}\` (or \`{"target": "<waypoint>", "repeat": 99}\` / \`13\` when collecting 99 wines or 13 nine-eye stones). When a puzzle mentions multiple switches/lamps in the same room (e.g. \`light1_f\` / \`light2_f\` / \`light3_f\` or \`huaRongDoor01_ev\` / \`temp\`), interact with each of them and then the exit event.`,
    `- When \`journal.waypoint\` starts with \`"fly_to:<DEST>"\`, call \`fly_to\` with \`{"destination": "<DEST>"}\`. When it is \`"use_item:EarthBall"\`, call \`use_item\` with \`{"item": "EarthBall"}\`.`,
    `- Whenever \`dialog.visible\` is true, call \`interact\` with \`{}\` to confirm/advance dialog.`,
    `- Whenever \`combat.active\` is true, immediately call \`combat_action\` with \`{"action": "skill", "target_slot": 1}\` (or the active enemy slot) until \`combat.active\` becomes false.`,
    `- Play briskly and continuously without stopping until \`"game_cleared": true\` is returned!`,
  ];

  console.log('================================================================');
  console.log(`  Launching agy-cli:${MODEL} [mode=${MODE}, realCpk=${IS_REAL_CPK}] on OpenPAL4 Campaign`);
  console.log(`  Output Directory: ${outDir}`);
  console.log('================================================================');

  const clientLog = fs.createWriteStream(clientLogFile, { flags: 'a' });
  let agentTurns = 0;
  let finalResult = null;
  const t0 = Date.now();
  const maxSessions = IS_REAL_CPK ? 8 : 2;

  for (let session = 1; session <= maxSessions && !clearedState; session++) {
    const curObs = session === 1 ? initialObs : await host.rpc({ cmd: 'observe' });
    if (curObs.game_cleared) {
      clearedState = curObs;
      break;
    }
    const prompt = [
      ...(MODE === 'pure' ? pureGuide : normalGuide),
      ``,
      `### Tool Execution Interface`,
      `Call game tools ONLY by executing \`node ${helperFile} <tool_name> '<json_args>'\` via your shell/command tool. Do NOT read or access any files outside \`${tmpDir}\`.`,
      `Tip: You can chain 2-3 sequential tool calls in a single shell command only when you are sure of the sequence, or call 1 tool per command and inspect the JSON response.`,
      `Available tools:`,
      toolsDoc,
      ``,
      `### Current Observation (Session ${session}, Step ${toolCalls})`,
      '```json',
      JSON.stringify(compactStateForModel(curObs), null, 2),
      '```',
      ``,
      `Continue playing from the current state until \`"game_cleared": true\` is returned, then summarize your playthrough in 3-4 sentences.`,
    ].join('\n');

    const agyLog = path.join(outDir, `agy-s${session}.log`);
    const agyArgs = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--disable-slash-commands',
      '--dangerously-skip-permissions',
      '--print-timeout',
      IS_REAL_CPK ? '900s' : '360s',
      '--model',
      MODEL,
      '--log-file',
      agyLog,
    ];

    console.log(`--- Starting Agent Session ${session}/${maxSessions} (steps so far: ${toolCalls}) ---`);
    const agy = spawn(AGY_BIN, agyArgs, {
      cwd: tmpDir,
      env: { ...process.env, PATH: `/opt/homebrew/bin:/Users/jianmingliu/.local/bin:${process.env.PATH || ''}` },
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const rl = readline.createInterface({ input: agy.stdout });
    rl.on('line', (line) => {
      clientLog.write(line + '\n');
      try {
        const ev = JSON.parse(line);
        if (ev.event === 'step_update' && ev.step_update?.state === 'DONE' && ev.step_update?.step_type === 'agent_response') {
          agentTurns++;
        }
        if (ev.event === 'result' && ev.result) {
          finalResult = ev.result;
        }
      } catch {}
    });

    await new Promise((resolve) => agy.on('close', resolve));
  }
  const durationMs = Date.now() - t0;

  const finalObs = await host.rpc({ cmd: 'observe' });
  const summary = {
    ok: Boolean(clearedState || finalObs.game_cleared),
    model: `agy-cli:${MODEL}`,
    mode: MODE,
    realCpk: IS_REAL_CPK,
    toolCalls,
    agentTurns: agentTurns || finalResult?.num_turns || 0,
    durationMs,
    world: finalObs.world,
    scene: finalObs.scene,
    title: finalObs.title,
    questStage: finalObs.quest_stage,
    trialCleared: finalObs.trial_cleared,
    chapter1Cleared: finalObs.chapter1_cleared,
    gameCleared: finalObs.game_cleared,
    combat: finalObs.combat,
    leader: finalObs.leader,
    party: finalObs.party,
    inventory: finalObs.inventory,
    gles3: finalObs.gles3,
    usage: finalResult?.usage || null,
  };

  fs.writeFileSync(resultFile, JSON.stringify(summary, null, 2));
  traceStream.write(JSON.stringify({ type: 'end', summary }) + '\n');
  traceStream.end();
  clientLog.end();
  host.close();
  server.close();

  console.log('================================================================');
  console.log('  Argon Playthrough Summary:');
  console.log(JSON.stringify(summary, null, 2));
  console.log('================================================================');

  if (!summary.gameCleared) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
