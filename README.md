# agent-pal4 — Headless & WebAssembly Agent Benchmark for Chinese Paladin 4 (仙剑奇侠传四)

`agent-pal4` is an autonomous AI agent benchmark and headless/WebAssembly runtime host for **Chinese Paladin 4 (仙剑奇侠传四)**, built on top of the C++20 portable engine in [`OpenPAL4`](https://github.com/jianmliu/OpenPAL4) (`pal4::portable::ChapterHost`).

It exposes a deterministic JSON-RPC / MCP-compatible tool interface (`observe`, `move_to`, `interact`, `switch_leader`, `combat_action`, `step`, `reset`) over both:
1. **Native Headless C++20 Host (`agent-pal4-host`)** with a zero-GPU GLES3 instrumentation backend (`gles3_headless_stub.cpp`).
2. **Emscripten WebAssembly + WebGL2 Browser Host (`agent_pal4_wasm`)** via `ccall` (`agent_pal4_init`, `agent_pal4_rpc`).

---

## Architecture

```
+-------------------------------------------------------------------+
|  LLM Agent (e.g. agy-cli:gemini-4-argon-medium) / Headless Test   |
+---------------------------------+---------------------------------+
                                  | JSON-RPC (stdio / HTTP MCP / Wasm)
                                  v
+-------------------------------------------------------------------+
|  agent-pal4-host (src/agent_pal4_host.cpp)                        |
|  - 3D Navigation & Camera-Relative Analog Input (MoveTo)          |
|  - NPC / GOB / EVF Volume Interaction & Dialog Advancement        |
|  - Turn-Based Combat Loop (CombatNumericDamageAction + Formulas)  |
+---------------------------------+---------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|  OpenPAL4 C++20 Portable Runtime (pal4::portable::ChapterHost)    |
|  - AngelScript VM (ScriptStack + GameServices 266-API Catalog)    |
|  - SceneCollision (Floor NavMesh + 3D Wall & Event Volumes)       |
|  - PlayerRoster, PlayerEquipment, InventoryServices, ArenaServices|
+-------------------------------------------------------------------+
```

---

## Quick Start

### 1. Clone Alongside `OpenPAL4`

By default, `CMakeLists.txt` expects `OpenPAL4` in `../OpenPAL4` (or specify `-DOPENPAL4_ROOT=/path/to/OpenPAL4`):

```bash
git clone -b feat/portable-party-combat-script-services https://github.com/jianmliu/OpenPAL4.git ../OpenPAL4
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j4 --target agent-pal4-host
```

### 2. Run the 16-Step Full-Campaign Headless Benchmark

```bash
npm test
# or: node test/run-headless-bench.mjs
```

Verifies all 16 engine milestones across the 4-chapter, 7-scene campaign:
- **Chapter 1 (`Q01/N01` -> `M01/1` -> `M01/2`)**: 3D wall collision (`SceneCollision`), NPC pathfinding & dialog (`HanLingsha`), chest GOB loot (`射日猎弓`), leader switch (`giPlayerInTeam` / `SetLeader`), EVF portal transition (`giArenaLoad`), Boss `魁召` combat (`CombatNumericDamageAction` + `BattleHealthState`), and `望舒剑` equipment (`giAddPlayerEquip`).
- **Chapter 2 (`Q02/N01` -> `M04/1`)**: Recruiting `柳梦璃` (`giPlayerInTeam(2, true)`), favor (`giAddPlayerFavor`), money (`giAddMoney`), rest (`giPlayerTakeARest`), skills (`giPlayerAddSkill`), and defeating Boss `槐妖长老` for `土灵珠` (`giSetFullRage`, `giSetPlayerLevel`).
- **Chapter 3 (`Q07/N01`)**: Recruiting `慕容紫英` (all 4 heroes assembled) and forging `羲和剑` (`giPayMoney`, `giCheckPackProperty`).
- **Chapter 4 (`M20/1`)**: Final Boss battle against `玄霄` & `夙瑶` at Juanyun Platform (`giStartCombat("M20")`, `giGetRandnum`) and triggering the Grand Finale (`quest_stage == 1000`, `game_cleared == true`).

### 3. Run Autonomous LLM Agent (`argon`) Playthrough

```bash
node bench/run-argon.mjs
```

#### Latest `agy-cli:gemini-4-argon-medium` Benchmark Result
- **Run ID**: [`bench/out/argon-20261103T204552/result.json`](bench/out/argon-20261103T204552/result.json)
- **Model**: `agy-cli:gemini-4-argon-medium`
- **Status**: `gameCleared: true` (`questStage: 1000`, 3/3 Bosses defeated, all 4 party members Lv.50)
- **Tool Calls**: `48` steps across 7 scenes (`Q01/N01` -> `M01/1` -> `M01/2` -> `Q02/N01` -> `M04/1` -> `Q07/N01` -> `M20/1`)
- **Duration**: `131.1s` (`2m 11s`)
