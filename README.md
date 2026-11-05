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

### 2. Run the Full-Campaign Benchmarks (Real `.cpk` & Synthetic)

#### A. Real `.cpk` Full 4-Chapter Playthrough Benchmark (`24/24` Checks, `mvar 10100 -> 170000`)

Runs the entire original *Chinese Paladin 4 (仙剑奇侠传四)* retail `.cpk` campaign from **NewGame (`Q01/N01`, `mvar=10100`)** all the way to the **Grand Ending (`M19/2`, `mvar=170000`, `game_cleared=true`)** with **zero script errors** and **zero unhandled engine calls (`unhandled_calls=0`)**:

```bash
node test/run-real-cpk-bench.mjs
```

- **Act 1 (`10100 -> 11400`)**: Qingluan Peak (`Q01`), Shichen Brook Cave (`M01/1..3`), meeting Han Lingsha, defeating Kuizhao (`魁召`), awakening Wangshu Sword.
- **Act 2 (`11400 -> 40100`)**: Ziyun Frame (`M02`), Taiping Village (`Q02`), Chaohu Lake (`M03`), Shouyang City (`Q03`), Nvluo Rock (`M04`), Bagong Mountain (`M05`), King of Huainan Tomb (`M06/1A..2D..4`), recruiting Liu Mengli.
- **Act 3 (`40100 -> 70200`)**: Nvluo Leyline (`M07/1..9`), Chenzhou (`Q04`), Thousand Buddha Pagoda (`M08/1..5`), Boxian Town (`Q05`), Taiyi Immortal Path (`M09/1..3`), Qionghua Sect (`Q06`), Xuyu Illusion (`M10/1`), recruiting Murong Ziying.
- **Act 4 (`70200 -> 170000` Grand Ending)**: Wanqiu Mountain (`M11`), Yueya Village (`Q07`), Sifan Valley & Forbidden Ground (`M20`), Zuihuayin (`M12`), Jimo (`Q08`), Yinshan (`Q09`), Fox Demon Cave (`M13`), Shennong Cave (`M14/1..3`), Juchao (`Q10`), Exile Path (`M15`), Ghost Realm (`Q11`), Buzhou Mountain (`M16`), Fengshen Mausoleum (`Q13` & `M17/1..5`), Huanming Realm (`Q14` & `M18/1`), Burning Qionghua & Juanyun Platform Final Boss Battle against Xuanxiao & Suyao (`M19/1..2`, `mvar=170000`).

#### B. 19-Step Synthetic Full-Campaign Headless Benchmark

```bash
npm test
# or: node test/run-headless-bench.mjs
```

Verifies all 19 engine milestones across the synthetic 4-chapter campaign (including Normal/Pure mode de-biasing, `.evf` 3D portal centroids, and in-memory checkpoint save/restore):
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
