# agent-pal4 — Headless & WebAssembly Agent Benchmark for Chinese Paladin 4 (仙剑奇侠传四)

`agent-pal4` is an autonomous AI agent benchmark, deterministic replay verifier, and headless/WebAssembly runtime host for **Chinese Paladin 4 (仙剑奇侠传四)**, built on top of the C++20 portable engine in [`OpenPAL4`](https://github.com/jianmliu/OpenPAL4) (`pal4::portable::ChapterHost`).

It exposes a deterministic JSON-RPC / MCP-compatible tool interface (`observe`, `move_to`/`walk_to`, `interact`, `switch_leader`, `combat_action`, `fly_to`, `use_item`, `rest`, `wait`, `step`, `reset`) over both:
1. **Native Headless C++20 Host (`agent-pal4-host`)** with a zero-GPU GLES3 instrumentation backend (`headless_gles3.cpp`) and `--mode pure|normal` evaluation support.
2. **Emscripten WebAssembly + WebGL2 Browser Host (`agent_pal4_wasm`)** via `ccall` (`agent_pal4_init`, `agent_pal4_rpc`).

---

## 🏆 Leaderboard (问情论剑 · 自主智能体排行榜)

Static HTML Leaderboard: [`bench/out/board.html`](bench/out/board.html) (also mirrored at [`web/board.html`](web/board.html)).

| Rank | Model | Mode | Campaign Scope | Progress | Tool Calls | Bosses / Max Lv | Tokens | Duration | Replay Verification |
| :-: | :--- | :-: | :--- | :-: | :-: | :-: | :-: | :-: | :-: |
| 🥇 1 | `agy-cli:claude-opus-5-5-high` ([`opus-20261105T061222`](bench/out/opus-20261105T061222/result.json)) | **`pure` (Real CPK)** | **Retail `.cpk` Full 4-Chapter Campaign (24 Stages · Act I–IV)** | **100%** | **253** | 18/18 · Lv.53 | 77.0k | **260.8s** | `已核验 ✓` (`316373dc5b52`) |
| 🥈 2 | `agy-cli:gemini-4-argon-medium` ([`argon-20261105T052556`](bench/out/argon-20261105T052556/result.json)) | **`pure` (Real CPK)** | **Retail `.cpk` Full 4-Chapter Campaign (24 Stages · Act I–IV)** | **100%** | **296** | 18/18 · Lv.53 | 368.2k | 2605.7s | `已核验 ✓` (`80db7e8ccd9a`) |
| 🥉 3 | `agy-cli:gemini-4-argon-medium` ([`argon-20261105T032438`](bench/out/argon-20261105T032438/result.json)) | **`pure`** | **7-Scene Synthetic Campaign (Act I–IV)** | **100%** | **36** | 3/3 · Lv.50 | 89.3k | 159.6s | `已核验 ✓` (`724fad874ef1`) |
| 4 | `agy-cli:claude-opus-5-5-high` ([`opus-20261105T041624`](bench/out/opus-20261105T041624/result.json)) | **`pure`** | **7-Scene Synthetic Campaign (Act I–IV)** | **100%** | **44** | 3/3 · Lv.50 | 69.6k | **107.4s** | `已核验 ✓` (`e2b54a1cae43`) |
| 5 | `agy-cli:gemini-4-argon-medium` ([`argon-20261103T204552`](bench/out/argon-20261103T204552/result.json)) | `normal` | **7-Scene Synthetic Campaign (Act I–IV)** | **100%** | **48** | 3/3 · Lv.50 | 58.9k | 131.1s | `已核验 ✓` (`7903cba5ebc1`) |
| 6 | `agy-cli:gemini-4-argon-medium` ([`argon-20261103T201924`](bench/out/argon-20261103T201924/result.json)) | `normal` | Chapter 1 Benchmark (Shichenxi Cave) | 50% | 22 | 1/1 · Lv.1 | 27.2k | 51.9s | `已核验 ✓` (`5680d5c70bad`) |
| 7 | `agy-cli:gemini-4-argon-medium` ([`argon-20261103T194927`](bench/out/argon-20261103T194927/result.json)) | `normal` | Opening Trial Benchmark (Qingluan Peak) | 25% | 9 | 0/0 · Lv.1 | 35.0k | 74.5s | `已核验 ✓` (`ef4b25ab482c`) |

### Retail `.cpk` Full 4-Chapter Campaign Verification (`mvar 10100 -> 170000`)

| Suite | Mode | Stages Passed | `.csb` Modules | Engine Syscalls | Script Errors | Unhandled Calls | Status |
| :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| [`test/run-real-cpk-bench.mjs`](test/run-real-cpk-bench.mjs) | **`pure`** | **24 / 24 (100%)** | 43 | 266 | 0 | 0 | `PASS ✓` |
| [`test/run-real-cpk-bench.mjs`](test/run-real-cpk-bench.mjs) | `normal` | **24 / 24 (100%)** | 43 | 266 | 0 | 0 | `PASS ✓` |
| [`test/run-headless-bench.mjs`](test/run-headless-bench.mjs) | `pure` & `normal` | **19 / 19 (100%)** | Synthetic | 266 | 0 | 0 | `PASS ✓` |

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
|  - Pure Mode Sanitization (--mode pure) & Anti-Cheat Enforcement  |
|  - 3D Navigation & Camera-Relative Analog Input (MoveTo / A*)     |
|  - NPC / GOB / EVF Volume Interaction & Dialog Advancement        |
|  - Turn-Based Combat Loop (CombatNumericDamageAction + Formulas)  |
+---------------------------------+---------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|  OpenPAL4 C++20 Portable Runtime (pal4::portable::ChapterHost)    |
|  - AngelScript 2.2 VM (CsbExecution + 64-bit double opcodes 72..84)|
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

Runs the entire original *Chinese Paladin 4 (仙剑奇侠传四)* retail `.cpk` campaign in **Pure Mode** (`--mode pure`) or **Normal Mode** (`--mode normal`) from **NewGame (`Q01/N01`, `mvar=10100`)** all the way to the **Grand Ending (`M19/2`, `mvar=170000`, `game_cleared=true`)** with **zero script errors** and **zero unhandled engine calls**:

```bash
node test/run-real-cpk-bench.mjs --mode pure
node test/run-real-cpk-bench.mjs --mode normal
```

- **Act 1 (`10100 -> 11400`)**: Qingluan Peak (`Q01`), Shichen Brook Cave (`M01/1..3`), meeting Han Lingsha, defeating Kuizhao (`魁召`), awakening Wangshu Sword.
- **Act 2 (`11400 -> 40100`)**: Ziyun Frame (`M02`), Taiping Village (`Q02`), Chaohu Lake (`M03`), Shouyang City (`Q03`), Nvluo Rock (`M04`), Bagong Mountain (`M05`), King of Huainan Tomb (`M06/1A..2D..4`), recruiting Liu Mengli.
- **Act 3 (`40100 -> 70200`)**: Nvluo Leyline (`M07/1..9`), Chenzhou (`Q04`), Thousand Buddha Pagoda (`M08/1..5`), Boxian Town (`Q05`), Taiyi Immortal Path (`M09/1..3`), Qionghua Sect (`Q06`), Xuyu Illusion 99-Wine & Nine-Eye Stones Trials (`M10/1..10`), recruiting Murong Ziying.
- **Act 4 (`70200 -> 170000` Grand Ending)**: Wanqiu Mountain (`M11`), Yueya Village (`Q07`), Sifan Valley & Forbidden Ground (`M20`), Zuihuayin (`M12`), Jimo (`Q08`), Yinshan (`Q09`), Fox Demon Cave (`M13`), Shennong Cave (`M14/1..3`), Juchao (`Q10`), Exile Path (`M15`), Ghost Realm (`Q11`), Buzhou Mountain (`M16`), Fengshen Mausoleum (`Q13` & `M17/1..5`), Huanming Realm (`Q14` & `M18/1`), Burning Qionghua & Juanyun Platform Final Boss Battle against Xuanxiao & Suyao (`M19/1..2`, `mvar=170000`).

#### B. 19-Step Synthetic Full-Campaign Headless Benchmark

```bash
npm run test:headless
# or: node test/run-headless-bench.mjs
```

### 3. Run Autonomous LLM Agent (`argon`), Verify Replays & Build Leaderboard

```bash
# 1. Run autonomous LLM agent playthrough in Pure Mode
npm run bench:run
# or: node bench/run-argon.mjs --mode pure

# 2. Deterministically replay & verify all runs in bench/out/ (writes verify.json)
npm run bench:verify
# or: node bench/verify.mjs

# 3. Render 3D software-rasterized key frames + NavMesh running sub-step frames (834 frames)
node bench/render-frames.mjs

# 4. Generate self-contained static HTML leaderboard & 3D Interactive Replay Player
#    Outputs: bench/out/board.html, web/board.html, web/replay.html
npm run bench:board
# or: node bench/board.mjs
```

### 4. Interactive 3D Web Replay Player (`web/replay.html`)

- **Standalone Replay Player**: [`web/replay.html`](web/replay.html) (and embedded in [`web/board.html#replay`](web/board.html))
- **834 Software-Rasterized Retail 3D Frames**: Includes **225 step-end 3D frames** + **609 NavMesh sub-step 3D skeletal running (`C02`) sequence frames** (`web/frames/`) rendered directly from original retail `.cpk` world meshes, lightmaps, skyboxes, `.gob` props, NPCs, monsters, and character models via `headless_gles3.cpp` (`render_frame` & `render_substeps`).
- **3 View Modes**:
  1. **🎮 3D 实机渲染 + 2D 雷达小窗 (PiP)**
  2. **🖼️ 纯享原版 3D 实机画面**
  3. **🧭 全屏 2D 战术导航雷达**
