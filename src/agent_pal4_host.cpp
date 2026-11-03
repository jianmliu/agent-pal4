#include "pal4/portable/chapter_host.h"
#include "pal4/portable/collision_surface.h"
#include "pal4/portable/battle_state.h"
#include "pal4/portable/combat_formula_catalog.h"
#include "pal4/portable/combat_numeric_damage_action.h"
#include "pal4/combat_actor_status.h"
#include "pal4/random_number_generator.h"
#include "GLES3/gl3.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

using namespace pal4::portable;

namespace {

std::string EscapeJson(std::string_view input) {
    std::ostringstream out;
    for (unsigned char c : input) {
        switch (c) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\b': out << "\\b"; break;
            case '\f': out << "\\f"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (c < 0x20) {
                    out << "\\u00"
                        << "0123456789abcdef"[(c >> 4) & 0xF]
                        << "0123456789abcdef"[c & 0xF];
                } else {
                    out << static_cast<char>(c);
                }
        }
    }
    return out.str();
}

std::optional<std::string> ExtractJsonString(std::string_view json, std::string_view key) {
    const std::string pattern = "\"" + std::string(key) + "\"";
    auto pos = json.find(pattern);
    if (pos == std::string_view::npos) return std::nullopt;
    pos = json.find(':', pos + pattern.size());
    if (pos == std::string_view::npos) return std::nullopt;
    pos = json.find('"', pos + 1);
    if (pos == std::string_view::npos) return std::nullopt;
    std::string result;
    for (std::size_t i = pos + 1; i < json.size(); ++i) {
        if (json[i] == '\\' && i + 1 < json.size()) {
            result.push_back(json[++i]);
        } else if (json[i] == '"') {
            return result;
        } else {
            result.push_back(json[i]);
        }
    }
    return std::nullopt;
}

std::optional<double> ExtractJsonNumber(std::string_view json, std::string_view key) {
    const std::string pattern = "\"" + std::string(key) + "\"";
    auto pos = json.find(pattern);
    if (pos == std::string_view::npos) return std::nullopt;
    pos = json.find(':', pos + pattern.size());
    if (pos == std::string_view::npos) return std::nullopt;
    ++pos;
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) ++pos;
    if (pos >= json.size()) return std::nullopt;
    char* end = nullptr;
    const std::string tail(json.substr(pos));
    const double val = std::strtod(tail.c_str(), &end);
    if (end == tail.c_str()) return std::nullopt;
    return val;
}

std::optional<bool> ExtractJsonBool(std::string_view json, std::string_view key) {
    const std::string pattern = "\"" + std::string(key) + "\"";
    auto pos = json.find(pattern);
    if (pos == std::string_view::npos) return std::nullopt;
    pos = json.find(':', pos + pattern.size());
    if (pos == std::string_view::npos) return std::nullopt;
    ++pos;
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) ++pos;
    if (json.substr(pos).starts_with("true")) return true;
    if (json.substr(pos).starts_with("false")) return false;
    return std::nullopt;
}

void AppendWord(std::string& b, std::uint32_t value) {
    for (unsigned n = 0; n < 32; n += 8) b += static_cast<char>(value >> n);
}

void AppendText(std::string& b, std::string_view value) {
    AppendWord(b, static_cast<std::uint32_t>(value.size()));
    b += value;
}

RoleCatalog BuildPal4Roles() {
    using Field = std::pair<std::string, unsigned>;
    std::vector<Field> fields{{"ID", 1}, {"ROLE_ID", 1}, {"CA_LEVEL", 1}, {"CA_EXPERIENCE", 1}};
    for (const auto* n : {"CA_MAX_HP", "CA_ADDITIONAL_RAGE", "CA_MAX_MP", "CA_PHYSICAL",
                          "CA_TOUGHNESS", "CA_SPEED", "CA_LUCKY", "CA_WILL",
                          "EFE_WATER", "EFE_FIRE", "EFE_THUNDER", "EFE_AIR", "EFE_EARTH"}) {
        fields.emplace_back(n, 1);
    }
    for (const auto* suffix : {"ADDITIONAL", "EXTRACT", "REACT"}) {
        for (const auto* channel : {"PHYSICAL", "WATER", "FIRE", "THUNDER", "AIR", "EARTH"}) {
            fields.emplace_back(std::string("CA_ATTACK_") + channel + "_" + suffix,
                                std::string_view(suffix) == "ADDITIONAL" ? 1 : 3);
        }
    }
    for (const auto* n : {"CA_ADDITIONAL_CRITICAL", "CA_FEND_OFF", "CA_ADDITIONAL_HITTING", "CA_PAY_FOR_SPARE"}) {
        fields.emplace_back(n, 3);
    }

    constexpr const char* kHeroNames[4] = {"云天河", "韩菱纱", "柳梦璃", "慕容紫英"};
    constexpr const char* kHeroModels[4] = {"101", "102", "105", "104"};

    std::string b = "P4RL";
    AppendWord(b, 1);
    AppendWord(b, 4);
    AppendWord(b, 50);
    for (unsigned i = 0; i < 4; ++i) {
        AppendWord(b, i);
        AppendText(b, "ROLE_ID"); AppendWord(b, 1); AppendWord(b, 1001 + i);
        AppendText(b, "RA_NAME"); AppendWord(b, 2); AppendText(b, kHeroNames[i]);
        AppendText(b, "RA_ICON"); AppendWord(b, 2); AppendText(b, kHeroModels[i]);
        AppendText(b, "RA_MODEL"); AppendWord(b, 2); AppendText(b, kHeroModels[i]);
        AppendText(b, "RA_TEXTURE"); AppendWord(b, 2); AppendText(b, kHeroModels[i]);
        AppendText(b, "SOUND_WOUNDED1"); AppendWord(b, 2); AppendText(b, kHeroModels[i]);
        AppendText(b, "SOUND_WOUNDED2"); AppendWord(b, 2); AppendText(b, kHeroModels[i]);
        AppendText(b, "SOUND_WOUNDED3"); AppendWord(b, 2); AppendText(b, kHeroModels[i]);
        for (std::size_t n = 4; n < fields.size(); ++n) {
            AppendText(b, fields[n].first);
            AppendWord(b, fields[n].second);
            AppendWord(b, fields[n].first == "EFE_WATER" ? 11 : 0);
        }
        for (const auto* n : {"RACE", "ePT_TIANHE_FAVOR", "ePT_LINSHA_FAVOR", "ePT_MENGLI_FAVOR",
                              "ePT_ZIYING_FAVOR", "PHYSICAL_ATK_TARGET", "PHYSICAL_ATK_RANGE"}) {
            AppendText(b, n);
            AppendWord(b, 1);
            AppendWord(b, 0);
        }
    }
    std::istringstream input(b);
    return ReadRoles(input);
}

EquipmentCatalog BuildSyntheticEquipment() {
    using Field = std::pair<std::string, unsigned>;
    std::vector<Field> fields{{"ID", 1}, {"TYPE", 1}, {"EA_SKILL_ID", 1}, {"EA_NAME", 2}};
    for (const auto* n : {"CA_MAX_HP", "CA_ADDITIONAL_RAGE", "CA_MAX_MP", "CA_PHYSICAL",
                          "CA_TOUGHNESS", "CA_SPEED", "CA_LUCKY", "CA_WILL",
                          "EFE_WATER", "EFE_FIRE", "EFE_THUNDER", "EFE_AIR", "EFE_EARTH"}) {
        fields.emplace_back(n, 1);
    }
    for (const auto* suffix : {"ADDITIONAL", "EXTRACT", "REACT"}) {
        for (const auto* channel : {"PHYSICAL", "WATER", "FIRE", "THUNDER", "AIR", "EARTH"}) {
            fields.emplace_back(std::string("CA_ATTACK_") + channel + "_" + suffix,
                                std::string_view(suffix) == "ADDITIONAL" ? 1 : 3);
        }
    }
    for (const auto* n : {"CA_ADDITIONAL_CRITICAL", "CA_FEND_OFF", "CA_ADDITIONAL_HITTING", "CA_PAY_FOR_SPARE"}) {
        fields.emplace_back(n, 3);
    }
    while (fields.size() < 58) {
        fields.emplace_back("extra_" + std::to_string(fields.size()), 1);
    }
    std::string b = "P4EQ";
    AppendWord(b, 1);
    AppendWord(b, 3);
    AppendWord(b, 58);
    for (auto c : {0u, 0u, 0u, 1u, 2u, 3u, 4u}) AppendWord(b, c);
    for (const auto& [name, type] : fields) {
        AppendText(b, name);
        AppendWord(b, type);
    }
    for (unsigned i = 0; i < 3; ++i) {
        for (const auto& [name, type] : fields) {
            if (type == 2) {
                AppendText(b, i == 0 ? "望舒剑" : (i == 1 ? "射日猎弓" : "兽皮护腕"));
                continue;
            }
            AppendWord(b, name == "ID" ? 3500 + i :
                          name == "TYPE" ? (i == 2 ? 6 : 4) :
                          name == "CA_TOUGHNESS" ? 25 :
                          name == "CA_PHYSICAL" ? (i == 0 ? 120 : 60) :
                          type == 3 ? 0x3e800000u : 0u);
        }
    }
    std::istringstream input(b);
    return ReadEquipment(input);
}

CombatFormulaCatalog BuildSyntheticFormulaCatalog() {
    auto add_text_table = [](std::string& out, std::string_view name, std::string_view string_field, std::string_view value) {
        AppendText(out, name); AppendWord(out, 20060225u); AppendText(out, name); AppendText(out, "");
        AppendWord(out, 0u); AppendWord(out, 2u); AppendWord(out, 1u);
        AppendText(out, "ID"); AppendWord(out, 1u); AppendText(out, ""); AppendText(out, "");
        AppendText(out, string_field); AppendWord(out, 2u); AppendText(out, ""); AppendText(out, "");
        AppendWord(out, 20060223u); AppendWord(out, 7u); AppendText(out, value);
        AppendWord(out, 20060224u); AppendWord(out, 20060226u);
    };
    std::string data;
    AppendText(data, "GAME_DB_FLAG"); AppendWord(data, 20060228u); AppendWord(data, 0u);
    AppendWord(data, 4u);
    AppendText(data, "Property"); AppendWord(data, 20060225u); AppendText(data, "Property");
    AppendText(data, ""); AppendWord(data, 0u); AppendWord(data, 9u); AppendWord(data, 1u);
    AppendText(data, "ID"); AppendWord(data, 1u); AppendText(data, ""); AppendText(data, "");
    AppendText(data, "TYPE"); AppendWord(data, 1u); AppendText(data, ""); AppendText(data, "");
    AppendText(data, "PA_NAME"); AppendWord(data, 2u); AppendText(data, ""); AppendText(data, "");
    for (const auto* field : {"PA_DESCRIPTION", "PA_PROPERTY", "PA_ICON", "PA_MODEL", "PA_TEXTURE", "PA_ATTACHED_EFFECT"}) {
        AppendText(data, field); AppendWord(data, 2u); AppendText(data, ""); AppendText(data, "");
    }
    AppendWord(data, 20060223u); AppendWord(data, 7u); AppendWord(data, 4u); AppendText(data, "test");
    for (unsigned i = 0; i < 6; ++i) AppendText(data, "");
    AppendWord(data, 20060224u); AppendWord(data, 20060226u);
    add_text_table(data, "Tutorial", "STRING", "tutorial");
    add_text_table(data, "GameString", "STRING", "string");
    AppendText(data, "CombatFormulaConfig"); AppendWord(data, 20060225u);
    AppendText(data, "CombatFormulaConfig"); AppendText(data, ""); AppendWord(data, 0u);
    AppendWord(data, 2u); AppendWord(data, 32u);
    AppendText(data, "ID"); AppendWord(data, 1u); AppendText(data, ""); AppendText(data, "");
    AppendText(data, "Value"); AppendWord(data, 3u); AppendText(data, ""); AppendText(data, "");
    for (std::uint32_t key = 1u; key <= 32u; ++key) {
        float value = 0.0f;
        if (key == 6u) value = 1.0f;
        if (key == 7u) value = 0.9f;
        if (key == 8u) value = 1.1f;
        AppendWord(data, 20060223u); AppendWord(data, key);
        AppendWord(data, std::bit_cast<std::uint32_t>(value)); AppendWord(data, 20060224u);
    }
    AppendWord(data, 20060226u);
    return CombatFormulaCatalog::ReadDatabase(
        std::span(reinterpret_cast<const std::uint8_t*>(data.data()), data.size()));
}

class SingleCombatDamageBridge final : public ICombatNumericActorAccess,
                                       public pal4::ICombatActorStatusRuntime {
public:
    static constexpr CombatNumericActorHandle kSource = 0x20000u;
    static constexpr CombatNumericActorHandle kTarget = 0x30000u;

    SingleCombatDamageBridge(std::int32_t src_hp, std::int32_t src_max_hp, std::int32_t src_stat7,
                             double src_factor, std::int32_t dst_hp, std::int32_t dst_max_hp,
                             std::int32_t dst_stat7, double dst_reduction)
        : src_hp_(src_hp), src_max_hp_(src_max_hp), src_stat7_(src_stat7), src_factor_(src_factor),
          dst_hp_(dst_hp), dst_max_hp_(dst_max_hp), dst_stat7_(dst_stat7), dst_reduction_(dst_reduction) {
        dst_state_ = BattleHealthState(dst_hp_, dst_max_hp_);
    }

    void ValidateActor(CombatNumericActorHandle actor) const override {
        if (actor != kSource && actor != kTarget) throw std::invalid_argument("invalid combat actor");
    }
    std::int32_t Stat(CombatNumericActorHandle actor, std::uint32_t) override {
        return actor == kSource ? src_stat7_ : dst_stat7_;
    }
    std::int32_t CurrentStat(CombatNumericActorHandle actor, std::uint32_t) override {
        return actor == kSource ? src_hp_ : dst_hp_;
    }
    std::int32_t Bonus(CombatNumericActorHandle, std::uint32_t) override { return 0; }
    std::int32_t Element(CombatNumericActorHandle actor, std::uint32_t) override {
        return actor == kSource ? 35 : 10;
    }
    double DamageFactor(CombatNumericActorHandle, std::uint32_t) override { return src_factor_; }
    double TargetFactor(CombatNumericActorHandle, std::uint32_t) override { return 1.0; }
    double SecondaryFactor(CombatNumericActorHandle, std::uint32_t) override { return 0.5; }
    double Reduction(CombatNumericActorHandle, std::uint32_t) override { return dst_reduction_; }
    bool HalfDamage(CombatNumericActorHandle) override { return false; }
    std::int32_t AddCurrentStat(CombatNumericActorHandle actor, std::uint32_t, std::int64_t delta) override {
        if (actor == kTarget) {
            dst_hp_ = static_cast<std::int32_t>(std::max<std::int64_t>(0, dst_hp_ + delta));
            (void)pal4::CombatActorStatus::UpdateHealthStatus(static_cast<std::uint32_t>(actor), *this);
            return dst_hp_;
        }
        src_hp_ = static_cast<std::int32_t>(std::max<std::int64_t>(0, src_hp_ + delta));
        return src_hp_;
    }
    void TargetFallback(CombatNumericActorHandle, CombatNumericActorHandle) override {}
    std::vector<CombatNumericActorHandle> RelatedTargets(CombatNumericActorHandle, std::uint8_t) override { return {}; }
    std::uint32_t CombatMode(CombatNumericActorHandle) override { return 1u; }
    bool IsNotStateThree(CombatNumericActorHandle actor) override {
        return (actor == kTarget ? dst_state_ : 0) != 3;
    }
    std::int32_t Query(std::uint32_t, std::uint32_t) override { return 0; }
    std::int32_t QueryIndexed(std::uint32_t actor, std::uint32_t slot, std::uint32_t) override {
        if (slot == 0x34u) return actor == kTarget ? dst_hp_ : src_hp_;
        return actor == kTarget ? dst_max_hp_ : src_max_hp_;
    }
    std::int32_t Set(std::uint32_t actor, std::uint32_t, std::int32_t value) override {
        if (actor == kTarget) dst_state_ = value;
        return value;
    }

    std::int32_t TargetHp() const noexcept { return dst_hp_; }
    std::int32_t TargetHealthState() const noexcept { return dst_state_; }

private:
    std::int32_t src_hp_{}, src_max_hp_{}, src_stat7_{};
    double src_factor_{};
    std::int32_t dst_hp_{}, dst_max_hp_{}, dst_stat7_{}, dst_state_{};
    double dst_reduction_{};
};

Actor BuildSyntheticActor(std::string_view default_clip) {
    Actor actor;
    const Matrix identity{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    actor.frames.push_back({-1, identity});
    actor.palettes.push_back({0, identity});
    actor.mesh.vertices.resize(3);
    actor.mesh.vertices[0] = {{0.f, 0.f, 0.f}, {0.f, 0.f}, {0.f, 0.f}, {1.f, 1.f, 1.f, 1.f}};
    actor.mesh.vertices[1] = {{1.f, 0.f, 0.f}, {1.f, 0.f}, {1.f, 0.f}, {1.f, 1.f, 1.f, 1.f}};
    actor.mesh.vertices[2] = {{0.f, 1.f, 0.f}, {0.f, 1.f}, {0.f, 1.f}, {1.f, 1.f, 1.f, 1.f}};
    actor.mesh.draws.push_back({0, 3, -1, -1, {1.f, 1.f, 1.f, 1.f}});
    actor.influences.resize(3, {{0, 0, 0, 0}, {1.f, 0.f, 0.f, 0.f}});
    actor.atomic_spheres.push_back({0, {0.f, 0.f, 0.f, 18.f}});
    auto& bindings = actor.render_bindings.emplace();
    bindings.atomics = {{0, 1}};
    for (const char* clip_name : {"C01", "C02", "C03", "C04", "C05", "Z01", "Z02", "Z03", "Z04", "Z05", "J01"}) {
        AnimationClip clip;
        clip.name = clip_name;
        clip.duration = 0.6f;
        clip.tracks.push_back({0, {{0.f, {0.f, 0.f, 0.f, 1.f}, {0.f, 0.f, 0.f}},
                                   {0.6f, {0.f, 0.f, 0.f, 1.f}, {0.f, 0.f, 0.f}}}});
        actor.clips.push_back(std::move(clip));
    }
    (void)default_clip;
    return actor;
}

std::map<std::string, std::string> SyntheticUiFiles() {
    return {
        {"layouts/ScenarioDialog.xml",
         R"(<GUILayout><Window Name="Root"><Window Name="ScenarioDialog"><Property Name="Image" Value="set:zhujiemian0 image:duihuakuang"/><Property Name="UnifiedAreaRect" Value="{{0,0},{0,474},{0,800},{0,600}}"/><Window Name="EditDialog"><Property Name="Font" Value="dialog_simsun"/><Property Name="LineSpaceExtent" Value="3"/><Property Name="NormalTextColour" Value="FFFBFFD8"/></Window><Window Name="ImgClick"><Property Name="Image" Value="set:zhujiemian0 image:sanjiaodian2"/></Window></Window></Window></GUILayout>)"},
        {"imagesets/zhujiemian_0.imageset",
         R"(<Imageset Name="zhujiemian0" Imagefile="gamedata\ui\imagesets\zhujiemian0.png"><Image Name="duihuakuang" XPos="0" YPos="772" Width="800" Height="2"/><Image Name="sanjiaodian2" XPos="0" YPos="500" Width="26" Height="23"/><Image Name="default" XPos="0" YPos="0" Width="199" Height="275"/></Imageset>)"},
        {"fonts/Dialog_SIMSUN.font",
         R"(<Font Filename="gamedata\ui\fonts\kai.ttf" Size="20"/>)"},
        {"portrait/portrait0_0.imageset",
         R"(<Imageset Name="portrait00" Imagefile="gamedata\ui\imagesets\portrait00.png"><Image Name="101G" XPos="199" YPos="237" Width="199" Height="237"/></Imageset>)"},
        {"SoftStar_Pal4_Clean.scheme",
         R"(<GUIScheme Name="SoftStar_Pal4_Clean"><Imageset Name="zhujiemian0" Filename="gamedata\ui\imagesets\zhujiemian_0.imageset"/></GUIScheme>)"},
        {"layouts/HintBox.xml",
         R"(<GUILayout><Window Type="DefaultWindow" Name="HintBox"><Property Name="UnifiedAreaRect" Value="{{0,0},{0,0},{0,300},{0,60}}"/></Window></GUILayout>)"}
    };
}

class SyntheticPlacementServices final : public IPlayerPlacementServices {
public:
    explicit SyntheticPlacementServices(ChapterHost& host) : session(host) {}
    void FollowPlayer(std::uint32_t) override {
        if (session.camera_follow) session.camera_follow->SeekToPlayer();
    }
    void UpdateFloorAttributes(unsigned, const FloorHit& hit) override {
        if (session.floor_attributes && session.arena && hit.triangle < session.arena->collision.floor.size()) {
            session.floor_attributes->Update(session.arena->collision.floor[hit.triangle]);
        }
    }
    void UpdateGrid(Point3, Point3) override {}
    void SelectAnimation(std::uint32_t player, std::string_view action) override {
        session.players.SelectAction(player, action);
    }
private:
    ChapterHost& session;
};

class SyntheticResetServices final : public IControllerResetServices {
public:
    explicit SyntheticResetServices(ChapterHost& host) : session(host) {}
    void SetDefaultCursor() override { session.scene_ui.cursor = "default.cur"; }
    void ClearPlatformInput() override {
        session.input_x = session.input_y = 0.f;
        session.camera_yaw_input = session.camera_pitch_input = 0.f;
    }
    void HideInteractionUi() override { session.scene_ui.HideInteraction(); }
    void SetMonsterPursuitStopped(bool stopped) override {
        if (session.arena) session.arena->monster_pursuit_stopped = stopped;
    }
private:
    ChapterHost& session;
};

class SyntheticEventScripts final : public ISceneEventScripts {
public:
    explicit SyntheticEventScripts(ChapterHost& host) : session(host) {}
    bool Contains(std::string_view world, std::string_view declaration) override {
        return session.game && session.game->ContainsActive(world, declaration);
    }
    void LoadWorld(std::string_view) override {}
    std::int32_t Push(std::string_view world, std::string_view declaration) override {
        if (!session.game || !session.game_effect) return -1;
        while (session.game->State() == ScriptState::finished) {
            session.game->PopFinished();
        }
        const auto ctx = session.game->Push(world, declaration, *session.game_effect);
        if (!ctx) return -6;
        session.game->Tick(0.0, 10000, ScriptRunMode::until_wait);
        while (session.game->State() == ScriptState::finished) {
            session.game->PopFinished();
        }
        return 0;
    }
private:
    ChapterHost& session;
};

class AgentPal4Engine {
public:
    struct CombatEnemy {
        int slot{};
        std::int32_t monster_id{};
        std::string name;
        std::int32_t hp{};
        std::int32_t max_hp{};
        std::int32_t attack{};
        std::int32_t health_state{};
    };

    struct CombatEncounterState {
        bool active{};
        int round{};
        int victories{};
        std::string world;
        std::string bgm;
        std::string camera;
        std::string ground_camera;
        std::int32_t vip_monster{};
        std::array<std::int32_t, 4> param_words{};
        std::vector<std::pair<std::int32_t, std::int32_t>> queued_monsters;
        std::vector<CombatEnemy> enemies;
        std::optional<ScriptToken> wait_token;
        std::string last_log;
        std::uint32_t rng_draws{};
    };

    explicit AgentPal4Engine(std::string work_dir)
        : work_dir_(std::move(work_dir)),
          formulas_(BuildSyntheticFormulaCatalog()) {
        std::filesystem::create_directories(work_dir_);
        rng_.Seed(20070801u);
        Reset();
    }

    void Reset() {
        combat_ = {};
        prev_world_.clear();
        prev_scene_.clear();
        rng_.Seed(20070801u);
        host_ = std::make_unique<ChapterHost>();
        host_->directory = work_dir_;
        InitializeChapterHost(*host_);
        SetupSyntheticTrialScene();
    }

    ChapterHost& Host() { return *host_; }

    void AdvanceHostFrame(float dt) {
        auto& h = *host_;
        ProcessPendingArenaLoad();
        if (h.dialog && h.game) {
            h.dialog->Advance(dt);
            while (const auto token = h.dialog->TakeCompletion()) {
                h.game->Complete(*token);
                h.game->Tick(dt, 10000, ScriptRunMode::until_wait);
                ProcessPendingArenaLoad();
                while (h.game->State() == ScriptState::finished) {
                    h.game->PopFinished();
                }
            }
        }
        if (h.time_script && h.game && !combat_.active) {
            const bool busy = h.game->State() == ScriptState::prepared || h.game->State() == ScriptState::suspended;
            h.time_script->Advance(dt, h.controller.State().enabled, busy);
        }
        if (h.game && !combat_.active &&
            (h.game->State() == ScriptState::prepared ||
             (h.game->State() == ScriptState::suspended && h.game->WaitKind() == ScriptWaitKind::delay))) {
            h.game->Tick(dt, 10000, ScriptRunMode::until_wait);
            ProcessPendingArenaLoad();
            while (h.game->State() == ScriptState::finished) {
                h.game->PopFinished();
            }
        }
        if (!combat_.active && (!h.game || h.game->State() == ScriptState::idle)) {
            AdvanceChapterHost(h, dt);
        } else {
            ++h.scene_update_frames;
        }
        ProcessPendingArenaLoad();
        AutoConfigureDialog();
        RenderHeadlessFrame();
    }

    void StepFrames(int frames, float move_x, float move_y, float cam_yaw, bool confirm) {
        auto& h = *host_;
        const float dt = 1.0f / 30.0f;
        for (int i = 0; i < std::max(1, frames); ++i) {
            AutoConfigureDialog();
            h.input_x = move_x;
            h.input_y = move_y;
            h.camera_yaw_input = cam_yaw;
            SetChapterInteractionInput(h, confirm && (i == 0));
            AdvanceHostFrame(dt);
        }
        h.input_x = 0.f;
        h.input_y = 0.f;
        h.camera_yaw_input = 0.f;
        SetChapterInteractionInput(h, false);
    }

    std::string Interact() {
        auto& h = *host_;
        AutoConfigureDialog();
        if (h.dialog && h.dialog->View().visible) {
            const auto view = h.dialog->View();
            const std::string text_before = view.display_text;
            h.dialog->Confirm(view.generation, view.id);
            if (h.dialog->View().visible) {
                h.dialog->Confirm(view.generation, view.id);
            }
            AdvanceHostFrame(1.0f / 30.0f);
            AdvanceHostFrame(1.0f / 30.0f);
            return "confirmed_dialog:" + text_before;
        }
        SetChapterInteractionInput(h, false);
        SetChapterInteractionInput(h, true);
        AdvanceHostFrame(1.0f / 30.0f);
        SetChapterInteractionInput(h, false);
        AdvanceHostFrame(1.0f / 30.0f);
        if (h.dialog && h.dialog->View().visible) {
            return "opened_dialog:" + h.dialog->View().display_text;
        }
        return "interaction_dispatched";
    }

    struct MoveResult {
        bool reached{};
        bool blocked{};
        int steps_taken{};
        Point3 final_position{};
        float distance_remaining{};
    };

    MoveResult MoveTo(float target_x, float target_y, float target_z, int max_steps) {
        auto& h = *host_;
        MoveResult result{};
        const float dt = 1.0f / 30.0f;
        int stalled_frames = 0;
        for (int step = 0; step < std::max(1, max_steps); ++step) {
            AutoConfigureDialog();
            if (h.dialog && h.dialog->View().visible) {
                break;
            }
            const auto leader = h.players.Leader();
            const auto pos = h.players.Slots()[leader].position;
            const float dx = target_x - pos[0];
            const float dz = target_z - pos[2];
            const float dist = std::sqrt(dx * dx + dz * dz);
            if (dist <= 4.5f) {
                result.reached = true;
                break;
            }
            const float ux = dx / dist;
            const float uz = dz / dist;
            const auto pose = h.game_camera->Pose();
            float rx = pose.right[0], rz = pose.right[2];
            float fx = pose.forward[0], fz = pose.forward[2];
            const float r_len = std::hypot(rx, rz);
            const float f_len = std::hypot(fx, fz);
            if (r_len > 1e-4f) { rx /= r_len; rz /= r_len; }
            if (f_len > 1e-4f) { fx /= f_len; fz /= f_len; }
            h.input_x = std::clamp(-(ux * rx + uz * rz), -1.0f, 1.0f);
            h.input_y = std::clamp(+(ux * fx + uz * fz), -1.0f, 1.0f);
            AdvanceHostFrame(dt);
            result.steps_taken = step + 1;

            const auto after = h.players.Slots()[leader].position;
            const float moved = std::hypot(after[0] - pos[0], after[2] - pos[2]);
            if (step > 18 && moved < 0.05f) {
                if (++stalled_frames >= 6) {
                    result.blocked = true;
                    break;
                }
            } else {
                stalled_frames = 0;
            }
        }
        h.input_x = 0.f;
        h.input_y = 0.f;
        const auto leader = h.players.Leader();
        result.final_position = h.players.Slots()[leader].position;
        result.distance_remaining = std::hypot(
            target_x - result.final_position[0],
            target_z - result.final_position[2]);
        if (result.distance_remaining <= 4.5f) result.reached = true;
        return result;
    }

    bool SwitchLeader(std::int32_t index) {
        auto& h = *host_;
        if (index < 0 || index >= 4) return false;
        h.players.SetLeader(index, [&](std::uint32_t selected) {
            h.controller.SelectActor(selected, h.arena->description.type);
            const auto pos = h.players.Slots()[selected].position;
            if (h.game_placement) h.game_placement->SetCurrent(pos);
            if (h.camera_follow) h.camera_follow->SeekToPlayer();
        });
        return h.players.Leader() == static_cast<std::uint32_t>(index) &&
               h.controller.State().actor == static_cast<std::uint32_t>(index);
    }

    std::string CombatAction(std::string_view action_kind, int target_slot) {
        auto& h = *host_;
        if (!combat_.active) {
            return "combat_not_active";
        }
        std::ostringstream log;
        if (action_kind == "item") {
            if (h.inventory && h.inventory->Count(1001) > 0) {
                h.inventory_services->Remove(1001, 1, false);
                h.players.SetFullHp();
                log << "使用【止血草】恢复全队生命值！";
            } else {
                log << "背包中已无【止血草】！";
            }
        } else {
            const bool is_skill = (action_kind == "skill");
            if (is_skill) {
                for (std::size_t i = 0; i < 4; ++i) {
                    const auto& slot = h.players.Slots()[i];
                    if (slot.inventory_enabled && slot.progress.mp >= 30) {
                        h.players.SetHealth(static_cast<std::uint32_t>(i), slot.progress.hp, slot.progress.mp - 30);
                    }
                }
            }
            for (auto& enemy : combat_.enemies) {
                if (enemy.hp <= 0) continue;
                if (!is_skill && enemy.slot != target_slot) continue;
                for (std::size_t i = 0; i < 4; ++i) {
                    const auto& slot = h.players.Slots()[i];
                    if (!slot.inventory_enabled || slot.progress.hp <= 0 || enemy.hp <= 0) continue;
                    const auto skill_bonus = static_cast<std::int32_t>(slot.skills.size() * 65 + (slot.progress.rage >= 100 ? 75 : 0));
                    const auto src_atk = static_cast<std::int32_t>(slot.progress.effective.core[3]) + (is_skill ? (65 + skill_bonus) : 25);
                    SingleCombatDamageBridge bridge(
                        slot.progress.hp,
                        static_cast<std::int32_t>(slot.progress.effective.core[0]),
                        src_atk,
                        is_skill ? 1.8 : 1.25,
                        enemy.hp,
                        enemy.max_hp,
                        20,
                        0.1);
                    CombatNumericDamageAction numeric(formulas_, rng_, bridge);
                    const CombatNumericSkillAction skill_action{
                        1.0f, 1.0f, 1.0f, is_skill ? 2.2f : 1.4f, 1.0f, 0u};
                    const auto before_draws = numeric.RandomDraws();
                    const auto before_hp = enemy.hp;
                    (void)numeric.ApplySkill(
                        skill_action,
                        SingleCombatDamageBridge::kSource,
                        SingleCombatDamageBridge::kTarget);
                    combat_.rng_draws += (numeric.RandomDraws() - before_draws);
                    enemy.hp = bridge.TargetHp();
                    enemy.health_state = bridge.TargetHealthState();
                    const auto dealt = before_hp - enemy.hp;
                    log << slot.role.Text("RA_NAME")
                        << (is_skill ? "施展仙术重创" : "攻击")
                        << enemy.name << "(-" << dealt << " HP); ";
                }
                if (!is_skill) break;
            }
        }

        bool all_defeated = true;
        for (const auto& enemy : combat_.enemies) {
            if (enemy.hp > 0) {
                all_defeated = false;
                break;
            }
        }

        if (all_defeated) {
            combat_.active = false;
            ++combat_.victories;
            combat_.last_log = log.str() + "战斗胜利！敌方全员阵亡！";
            if (combat_.wait_token && h.game) {
                const auto tok = *combat_.wait_token;
                combat_.wait_token.reset();
                h.game->Complete(tok);
                h.game->Tick(0.0, 10000, ScriptRunMode::until_wait);
                ProcessPendingArenaLoad();
                while (h.game->State() == ScriptState::finished) {
                    h.game->PopFinished();
                }
            }
            AutoConfigureDialog();
            return "combat_victory";
        }

        const auto leader_idx = h.players.Leader();
        for (const auto& enemy : combat_.enemies) {
            if (enemy.hp <= 0) continue;
            const auto& leader = h.players.Slots()[leader_idx];
            SingleCombatDamageBridge bridge(
                enemy.hp, enemy.max_hp, enemy.attack, 0.85,
                leader.progress.hp,
                static_cast<std::int32_t>(leader.progress.effective.core[0]),
                static_cast<std::int32_t>(leader.progress.effective.core[4]),
                0.25);
            CombatNumericDamageAction numeric(formulas_, rng_, bridge);
            const CombatNumericSkillAction counter_action{1.0f, 0.0f, 1.0f, 0.8f, 0.0f, 0u};
            const auto before_draws = numeric.RandomDraws();
            (void)numeric.ApplySkill(
                counter_action,
                SingleCombatDamageBridge::kSource,
                SingleCombatDamageBridge::kTarget);
            combat_.rng_draws += (numeric.RandomDraws() - before_draws);
            const auto next_hp = std::max<std::int32_t>(1, bridge.TargetHp());
            h.players.SetHealth(leader_idx, next_hp, leader.progress.mp);
        }
        ++combat_.round;
        combat_.last_log = log.str();
        return "combat_round_advanced";
    }

    std::string ObserveJson(std::string_view extra_event = {}) {
        AutoConfigureDialog();
        auto& h = *host_;
        const auto leader_idx = h.players.Leader();
        const auto& leader = h.players.Slots()[leader_idx];
        const auto pos = leader.position;
        const auto rot = leader.rotation;

        std::optional<std::uint32_t> floor_tri;
        if (h.game_movement && h.game_movement->LastHit()) {
            floor_tri = h.game_movement->LastHit()->triangle;
        }

        const auto gles = AgentPal4GetGlesStats();
        std::ostringstream out;
        out << std::fixed << std::setprecision(2);
        out << "{";
        out << "\"ok\":true,";
        if (!extra_event.empty()) {
            out << "\"event\":\"" << EscapeJson(extra_event) << "\",";
        }
        out << "\"frame\":" << h.scene_update_frames << ",";
        out << "\"world\":\"" << EscapeJson(h.arena ? h.arena->description.world : "") << "\",";
        out << "\"scene\":\"" << EscapeJson(h.arena ? h.arena->description.scene : "") << "\",";
        out << "\"title\":\"" << EscapeJson(h.arena ? h.arena->description.title : "") << "\",";
        out << "\"quest_stage\":" << h.game_globals[0] << ",";
        out << "\"trial_cleared\":" << (h.game_globals[0] >= 200 ? "true" : "false") << ",";
        out << "\"chapter1_cleared\":" << (h.game_globals[0] >= 300 ? "true" : "false") << ",";
        out << "\"game_cleared\":" << (h.game_globals[0] >= 1000 ? "true" : "false") << ",";

        out << "\"leader\":{";
        out << "\"index\":" << leader_idx << ",";
        out << "\"actor_id\":\"" << EscapeJson(leader.name) << "\",";
        out << "\"name\":\"" << EscapeJson(leader.role.Text("RA_NAME")) << "\",";
        out << "\"position\":[" << pos[0] << "," << pos[1] << "," << pos[2] << "],";
        out << "\"rotation_yaw\":" << rot[1] << ",";
        out << "\"floor_triangle\":" << (floor_tri ? std::to_string(*floor_tri) : "null") << ",";
        out << "\"control_enabled\":" << (h.controller.State().enabled ? "true" : "false");
        out << "},";

        out << "\"party\":[";
        for (std::size_t i = 0; i < 4; ++i) {
            const auto& slot = h.players.Slots()[i];
            if (i > 0) out << ",";
            out << "{\"index\":" << i
                << ",\"actor_id\":\"" << EscapeJson(slot.name) << "\""
                << ",\"name\":\"" << EscapeJson(slot.role.Text("RA_NAME")) << "\""
                << ",\"in_team\":" << (slot.inventory_enabled ? "true" : "false")
                << ",\"active\":" << (slot.active ? "true" : "false")
                << ",\"level\":" << slot.progress.level
                << ",\"hp\":" << slot.progress.hp
                << ",\"mp\":" << slot.progress.mp
                << ",\"rage\":" << slot.progress.rage
                << ",\"favor_to_tianhe\":" << slot.favor[0]
                << ",\"skills_count\":" << slot.skills.size()
                << ",\"physical_attack\":" << slot.progress.effective.core[3] << "}";
        }
        out << "],";

        out << "\"dialog\":{";
        if (h.dialog && h.dialog->View().visible) {
            const auto v = h.dialog->View();
            out << "\"visible\":true,"
                << "\"id\":" << v.id << ","
                << "\"text\":\"" << EscapeJson(v.display_text) << "\"";
        } else {
            out << "\"visible\":false,\"id\":0,\"text\":\"\"";
        }
        out << "},";

        out << "\"inventory\":{";
        out << "\"money\":" << (h.inventory ? h.inventory->Money() : 0) << ",";
        out << "\"items\":[";
        if (h.inventory) {
            bool first = true;
            for (const auto& rec : h.inventory->Records()) {
                if (!first) out << ",";
                first = false;
                std::string item_name = "item_" + std::to_string(rec.id);
                auto it = h.property_catalog.find(rec.id);
                if (it != h.property_catalog.end()) item_name = it->second.name;
                out << "{\"id\":" << rec.id
                    << ",\"name\":\"" << EscapeJson(item_name) << "\""
                    << ",\"count\":" << rec.count << "}";
            }
        }
        out << "]},";

        out << "\"npcs\":[";
        if (h.scene_npcs) {
            const auto states = h.scene_npcs->States();
            for (std::size_t i = 0; i < states.size(); ++i) {
                if (i > 0) out << ",";
                const auto& s = states[i];
                const float dist = std::hypot(s.position[0] - pos[0], s.position[2] - pos[2]);
                out << "{\"name\":\"" << EscapeJson(s.name) << "\""
                    << ",\"position\":[" << s.position[0] << "," << s.position[1] << "," << s.position[2] << "]"
                    << ",\"distance\":" << dist
                    << ",\"interactable\":" << (h.scene_npcs->InteractionEnabled(i) ? "true" : "false")
                    << ",\"script\":\"" << EscapeJson(h.scene_npcs->InteractionScript(i)) << "\"}";
            }
        }
        out << "],";

        out << "\"objects\":[";
        if (h.scene_objects && h.arena) {
            const auto states = h.scene_objects->States();
            for (std::size_t i = 0; i < states.size(); ++i) {
                if (i > 0) out << ",";
                const auto& s = states[i];
                const auto& gob = h.arena->catalog.gobs[i];
                const float dist = std::hypot(gob.position[0] - pos[0], gob.position[2] - pos[2]);
                out << "{\"name\":\"" << EscapeJson(s.name) << "\""
                    << ",\"position\":[" << gob.position[0] << "," << gob.position[1] << "," << gob.position[2] << "]"
                    << ",\"distance\":" << dist
                    << ",\"research_able\":" << (h.scene_objects->InteractionEnabled(i) ? "true" : "false")
                    << ",\"uses\":" << s.uses
                    << ",\"script\":\"" << EscapeJson(gob.script) << "\"}";
            }
        }
        out << "],";

        out << "\"events\":[";
        if (h.scene_events && h.arena) {
            const auto states = h.scene_events->States();
            for (std::size_t i = 0; i < states.size(); ++i) {
                if (i > 0) out << ",";
                const auto& s = states[i];
                const auto& ev = h.arena->catalog.events[i];
                out << "{\"name\":\"" << EscapeJson(s.name) << "\""
                    << ",\"type\":" << s.type
                    << ",\"active\":" << (s.active ? "true" : "false")
                    << ",\"script\":\"" << EscapeJson(ev.script) << "\"}";
            }
        }
        out << "],";

        out << "\"combat\":{";
        out << "\"active\":" << (combat_.active ? "true" : "false") << ",";
        out << "\"round\":" << combat_.round << ",";
        out << "\"victories\":" << combat_.victories << ",";
        out << "\"world\":\"" << EscapeJson(combat_.world) << "\",";
        out << "\"bgm\":\"" << EscapeJson(combat_.bgm) << "\",";
        out << "\"camera\":\"" << EscapeJson(combat_.camera) << "\",";
        out << "\"ground_camera\":\"" << EscapeJson(combat_.ground_camera) << "\",";
        out << "\"vip_monster\":" << combat_.vip_monster << ",";
        out << "\"rng_draws\":" << combat_.rng_draws << ",";
        out << "\"last_log\":\"" << EscapeJson(combat_.last_log) << "\",";
        out << "\"enemies\":[";
        for (std::size_t i = 0; i < combat_.enemies.size(); ++i) {
            if (i > 0) out << ",";
            const auto& e = combat_.enemies[i];
            out << "{\"slot\":" << e.slot
                << ",\"id\":" << e.monster_id
                << ",\"name\":\"" << EscapeJson(e.name) << "\""
                << ",\"hp\":" << e.hp
                << ",\"max_hp\":" << e.max_hp
                << ",\"health_state\":" << e.health_state << "}";
        }
        out << "]},";

        out << "\"gles3\":{";
        out << "\"draw_calls\":" << gles.draw_calls << ",";
        out << "\"triangles\":" << gles.triangles_submitted << ",";
        out << "\"buffers\":" << gles.buffers_uploaded;
        out << "}";
        out << "}";
        return out.str();
    }

private:
    void AutoConfigureDialog() {
        auto& h = *host_;
        if (h.dialog) {
            const auto view = h.dialog->View();
            if (view.visible && !view.configured) {
                const std::uint32_t end = std::max<std::uint32_t>(1u, view.characters);
                h.dialog->Configure(view.generation, view.id, std::span(&end, 1), 20.0f);
                h.dialog->Advance(5.0f);
            }
        }
    }

    void RenderHeadlessFrame() {
        auto& h = *host_;
        if (!h.arena || !h.game_camera) return;
        const auto view_proj = h.game_camera->Matrix(800.0f / 600.0f);
        const std::array<float, 16> identity{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
        h.renderer.BeginFrame(800, 600);
        h.renderer.DrawScene(h.arena->world, view_proj, identity);
    }

    void ProcessPendingArenaLoad() {
        auto& h = *host_;
        if (!h.game_arena) return;
        const auto cmd = h.game_arena->TakeCommand();
        if (!cmd) return;
        LoadSyntheticArena(cmd->world, cmd->scene, false);
        if (h.game) {
            h.game->Complete(cmd->token);
            h.game_arena->Finish(cmd->token);
            h.game->Tick(0.0, 10000, ScriptRunMode::until_wait);
            while (h.game->State() == ScriptState::finished) {
                h.game->PopFinished();
            }
            const std::string init_decl = "void " + cmd->world + "_" + cmd->scene + "_init()";
            if (h.game->Push(cmd->world, init_decl, *h.game_effect)) {
                h.game->Tick(0.0, 10000, ScriptRunMode::until_wait);
                while (h.game->State() == ScriptState::finished) {
                    h.game->PopFinished();
                }
            }
        }
    }

    void LoadSyntheticArena(std::string_view world, std::string_view scene, bool initial_boot) {
        auto& h = *host_;
        if (h.arena && !initial_boot) {
            prev_world_ = h.arena->description.world;
            prev_scene_ = h.arena->description.scene;
        }
        h.scene_interaction.reset();
        h.free_movement.reset();
        h.scene_events.reset();
        h.game_placement.reset();
        h.placement_services.reset();
        h.game_movement.reset();
        h.npc_walks.reset();
        h.npc_actions.reset();
        h.scene_npcs.reset();
        h.scene_objects.reset();
        h.scene_collision.reset();
        h.minimap.reset();

        auto arena = std::make_unique<ArenaResources>();
        arena->description.id = 1;
        arena->description.type = 1;
        arena->description.world = std::string(world);
        arena->description.scene = std::string(scene);
        if (world == "Q01" && scene == "N01") {
            arena->description.title = "青鸾峰·石沉溪洞";
        } else if (world == "M01" && scene == "1") {
            arena->description.title = "石沉溪洞·符灵大厅";
        } else if (world == "M01" && scene == "2") {
            arena->description.title = "石沉溪洞·冰封墓室";
        } else if (world == "Q02" && scene == "N01") {
            arena->description.title = "寿阳城·柳府前庭";
        } else if (world == "M04" && scene == "1") {
            arena->description.title = "女萝岩·底层大殿";
        } else if (world == "Q07" && scene == "N01") {
            arena->description.title = "昆仑琼华派·剑舞坪";
        } else {
            arena->description.title = "琼华飞升·卷云台决战";
        }
        arena->description.object_collision_cache = true;
        arena->description.event_collision_cache = true;
        arena->monsters_verified_empty = true;

        arena->collision.floor.push_back({
            {Point3{-250.f, 0.f, 250.f}, Point3{-250.f, 0.f, -250.f}, Point3{250.f, 0.f, -250.f}},
            0, 0, 0, true, std::array<std::uint32_t, 3>{1, 0, 0}
        });
        arena->collision.floor.push_back({
            {Point3{-250.f, 0.f, 250.f}, Point3{250.f, 0.f, -250.f}, Point3{250.f, 0.f, 250.f}},
            0, 0, 1, true, std::array<std::uint32_t, 3>{1, 0, 0}
        });

        arena->collision.wall.push_back({
            {Point3{-200.f, -100.f, 60.f}, Point3{200.f, -100.f, 60.f}, Point3{-200.f, 100.f, 60.f}},
            1, 0, 0
        });
        arena->collision.wall.push_back({
            {Point3{200.f, -100.f, 60.f}, Point3{200.f, 100.f, 60.f}, Point3{-200.f, 100.f, 60.f}},
            1, 0, 1
        });
        arena->collision.wall.push_back({
            {Point3{-200.f, -100.f, 60.f}, Point3{-200.f, 100.f, 60.f}, Point3{200.f, -100.f, 60.f}},
            1, 0, 2
        });
        arena->collision.wall.push_back({
            {Point3{200.f, -100.f, 60.f}, Point3{-200.f, 100.f, 60.f}, Point3{200.f, 100.f, 60.f}},
            1, 0, 3
        });

        arena->world.vertices = {
            {{-200.f, 0.f, -200.f}, {0.f, 0.f}, {0.f, 0.f}, {1.f, 1.f, 1.f, 1.f}},
            {{ 200.f, 0.f, -200.f}, {1.f, 0.f}, {1.f, 0.f}, {1.f, 1.f, 1.f, 1.f}},
            {{ 200.f, 0.f,  200.f}, {1.f, 1.f}, {1.f, 1.f}, {1.f, 1.f, 1.f, 1.f}},
            {{-200.f, 0.f, -200.f}, {0.f, 0.f}, {0.f, 0.f}, {1.f, 1.f, 1.f, 1.f}},
            {{ 200.f, 0.f,  200.f}, {1.f, 1.f}, {1.f, 1.f}, {1.f, 1.f, 1.f, 1.f}},
            {{-200.f, 0.f,  200.f}, {0.f, 1.f}, {0.f, 1.f}, {1.f, 1.f, 1.f, 1.f}},
        };
        arena->world.draws.push_back({0, 6, -1, -1, {1.f, 1.f, 1.f, 1.f}});

        if (world == "Q01" && scene == "N01") {
            SceneNpc npc;
            npc.name = "HanLingsha";
            npc.resource = "202";
            npc.position = {35.f, 0.f, 0.f};
            npc.script = "TalkLingsha";
            npc.flags[0] = 1;
            npc.flags[1] = 1;
            npc.flags[2] = std::bit_cast<std::uint32_t>(30.0f);
            arena->catalog.npcs.push_back(npc);

            ArenaActor npc_actor;
            npc_actor.name = "HanLingsha";
            npc_actor.animation = "C01";
            npc_actor.position = npc.position;
            npc_actor.actor = BuildSyntheticActor("C01");
            arena->actors.push_back(std::move(npc_actor));

            SceneGob gob;
            gob.name = "AncestralBowChest";
            gob.model = "chest01";
            gob.resource_directory = "gamedata\\object\\Q01\\";
            gob.type = 0;
            gob.position = {-40.f, 0.f, 25.f};
            gob.script = "OpenBowChest";
            gob.flags[0] = 1;
            gob.flags[1] = 1;
            gob.flags[2] = 1;
            gob.flags[3] = std::bit_cast<std::uint32_t>(35.0f);
            {
                pal4::BinaryXmlNode root;
                root.name = "PAL4-GameObject-Parameters";
                root.attributes.push_back({"PAL4-GameObject-object-scale", 2, 1.0f});
                root.attributes.push_back({"PAL4-GameObject-object-research-num", 2, 1.9f});
                if (const auto xml = pal4::BinaryXmlConfig::Serialize(root)) {
                    (void)gob.config.Parse(*xml);
                }
            }
            arena->catalog.gobs.push_back(gob);

            ArenaActor gob_actor;
            gob_actor.name = "AncestralBowChest";
            gob_actor.animation = "C01";
            gob_actor.position = gob.position;
            gob_actor.gob_type = 0;
            gob_actor.actor = BuildSyntheticActor("C01");
            ObjectCollisionAtomic gob_atomic;
            gob_atomic.triangles.push_back({
                {Point3{-45.f, 0.f, 20.f}, Point3{-35.f, 0.f, 20.f}, Point3{-35.f, 15.f, 30.f}},
                0, 0, 0
            });
            gob_actor.collision = ObjectCollisionGeometry{{gob_atomic}};
            arena->actors.push_back(std::move(gob_actor));

            SceneEvent evf;
            evf.name = "CaveExitPortal";
            evf.effect_type = 1;
            evf.script = "TriggerCaveExit";
            evf.clump = {1};
            arena->catalog.events.push_back(evf);
            ObjectCollisionAtomic evf_atomic;
            evf_atomic.triangles.push_back({
                {Point3{-18.f, 0.f, -65.f}, Point3{18.f, 0.f, -65.f}, Point3{0.f, 15.f, -65.f}},
                0, 0, 0
            });
            arena->event_collisions.push_back(ObjectCollisionGeometry{{evf_atomic}});
        } else if (world == "M01" && scene == "1") {
            SceneNpc boss;
            boss.name = "KuiZhao";
            boss.resource = "2579";
            boss.position = {0.f, 0.f, -10.f};
            boss.script = "EncounterKuiZhao";
            boss.flags[0] = 1;
            boss.flags[1] = 1;
            boss.flags[2] = std::bit_cast<std::uint32_t>(30.0f);
            arena->catalog.npcs.push_back(boss);

            ArenaActor boss_actor;
            boss_actor.name = "KuiZhao";
            boss_actor.animation = "C01";
            boss_actor.position = boss.position;
            boss_actor.actor = BuildSyntheticActor("C01");
            arena->actors.push_back(std::move(boss_actor));

            SceneEvent evf;
            evf.name = "TombChamberDoor";
            evf.effect_type = 1;
            evf.script = "EnterTombChamber";
            evf.clump = {1};
            arena->catalog.events.push_back(evf);
            ObjectCollisionAtomic evf_atomic;
            evf_atomic.triangles.push_back({
                {Point3{-18.f, 0.f, -65.f}, Point3{18.f, 0.f, -65.f}, Point3{0.f, 15.f, -65.f}},
                0, 0, 0
            });
            arena->event_collisions.push_back(ObjectCollisionGeometry{{evf_atomic}});
        } else if (world == "M01" && scene == "2") {
            SceneGob sword_altar;
            sword_altar.name = "WangshuSwordAltar";
            sword_altar.model = "sword01";
            sword_altar.resource_directory = "gamedata\\object\\M01\\";
            sword_altar.type = 0;
            sword_altar.position = {0.f, 0.f, 0.f};
            sword_altar.script = "InspectWangshuAltar";
            sword_altar.flags[0] = 1;
            sword_altar.flags[1] = 1;
            sword_altar.flags[2] = 1;
            sword_altar.flags[3] = std::bit_cast<std::uint32_t>(35.0f);
            {
                pal4::BinaryXmlNode root;
                root.name = "PAL4-GameObject-Parameters";
                root.attributes.push_back({"PAL4-GameObject-object-scale", 2, 1.0f});
                root.attributes.push_back({"PAL4-GameObject-object-research-num", 2, 1.9f});
                if (const auto xml = pal4::BinaryXmlConfig::Serialize(root)) {
                    (void)sword_altar.config.Parse(*xml);
                }
            }
            arena->catalog.gobs.push_back(sword_altar);

            ArenaActor altar_actor;
            altar_actor.name = "WangshuSwordAltar";
            altar_actor.animation = "C01";
            altar_actor.position = sword_altar.position;
            altar_actor.gob_type = 0;
            altar_actor.actor = BuildSyntheticActor("C01");
            ObjectCollisionAtomic altar_atomic;
            altar_atomic.triangles.push_back({
                {Point3{-5.f, 0.f, -5.f}, Point3{5.f, 0.f, -5.f}, Point3{5.f, 15.f, 5.f}},
                0, 0, 0
            });
            altar_actor.collision = ObjectCollisionGeometry{{altar_atomic}};
            arena->actors.push_back(std::move(altar_actor));

            SceneEvent evf;
            evf.name = "LeaveQingluanPeakPortal";
            evf.effect_type = 1;
            evf.script = "LeaveCaveToFootOfMountain";
            evf.clump = {1};
            arena->catalog.events.push_back(evf);
            ObjectCollisionAtomic evf_atomic;
            evf_atomic.triangles.push_back({
                {Point3{-18.f, 0.f, -65.f}, Point3{18.f, 0.f, -65.f}, Point3{0.f, 15.f, -65.f}},
                0, 0, 0
            });
            arena->event_collisions.push_back(ObjectCollisionGeometry{{evf_atomic}});
        } else if (world == "Q02" && scene == "N01") {
            SceneNpc mengli;
            mengli.name = "LiuMengli";
            mengli.resource = "103";
            mengli.position = {30.f, 0.f, 0.f};
            mengli.script = "TalkMengli";
            mengli.flags[0] = 1;
            mengli.flags[1] = 1;
            mengli.flags[2] = std::bit_cast<std::uint32_t>(30.0f);
            arena->catalog.npcs.push_back(mengli);

            ArenaActor mengli_actor;
            mengli_actor.name = "LiuMengli";
            mengli_actor.animation = "C01";
            mengli_actor.position = mengli.position;
            mengli_actor.actor = BuildSyntheticActor("C01");
            arena->actors.push_back(std::move(mengli_actor));

            SceneEvent evf;
            evf.name = "NvLuoYanPortal";
            evf.effect_type = 1;
            evf.script = "EnterNvLuoYan";
            evf.clump = {1};
            arena->catalog.events.push_back(evf);
            ObjectCollisionAtomic evf_atomic;
            evf_atomic.triangles.push_back({
                {Point3{-18.f, 0.f, -65.f}, Point3{18.f, 0.f, -65.f}, Point3{0.f, 15.f, -65.f}},
                0, 0, 0
            });
            arena->event_collisions.push_back(ObjectCollisionGeometry{{evf_atomic}});
        } else if (world == "M04" && scene == "1") {
            SceneNpc boss;
            boss.name = "HuaiYaoElder";
            boss.resource = "2610";
            boss.position = {0.f, 0.f, -10.f};
            boss.script = "EncounterHuaiYao";
            boss.flags[0] = 1;
            boss.flags[1] = 1;
            boss.flags[2] = std::bit_cast<std::uint32_t>(30.0f);
            arena->catalog.npcs.push_back(boss);

            ArenaActor boss_actor;
            boss_actor.name = "HuaiYaoElder";
            boss_actor.animation = "C01";
            boss_actor.position = boss.position;
            boss_actor.actor = BuildSyntheticActor("C01");
            arena->actors.push_back(std::move(boss_actor));

            SceneEvent evf;
            evf.name = "QionghuaAscentPortal";
            evf.effect_type = 1;
            evf.script = "AscendToQionghua";
            evf.clump = {1};
            arena->catalog.events.push_back(evf);
            ObjectCollisionAtomic evf_atomic;
            evf_atomic.triangles.push_back({
                {Point3{-18.f, 0.f, -65.f}, Point3{18.f, 0.f, -65.f}, Point3{0.f, 15.f, -65.f}},
                0, 0, 0
            });
            arena->event_collisions.push_back(ObjectCollisionGeometry{{evf_atomic}});
        } else if (world == "Q07" && scene == "N01") {
            SceneNpc ziying;
            ziying.name = "MurongZiying";
            ziying.resource = "104";
            ziying.position = {-30.f, 0.f, 0.f};
            ziying.script = "TalkZiying";
            ziying.flags[0] = 1;
            ziying.flags[1] = 1;
            ziying.flags[2] = std::bit_cast<std::uint32_t>(30.0f);
            arena->catalog.npcs.push_back(ziying);

            ArenaActor ziying_actor;
            ziying_actor.name = "MurongZiying";
            ziying_actor.animation = "C01";
            ziying_actor.position = ziying.position;
            ziying_actor.actor = BuildSyntheticActor("C01");
            arena->actors.push_back(std::move(ziying_actor));

            SceneGob forge;
            forge.name = "ChengtianSwordForge";
            forge.model = "sword02";
            forge.resource_directory = "gamedata\\object\\Q07\\";
            forge.type = 0;
            forge.position = {35.f, 0.f, 20.f};
            forge.script = "ForgeXiHeSword";
            forge.flags[0] = 1;
            forge.flags[1] = 1;
            forge.flags[2] = 1;
            forge.flags[3] = std::bit_cast<std::uint32_t>(35.0f);
            {
                pal4::BinaryXmlNode root;
                root.name = "PAL4-GameObject-Parameters";
                root.attributes.push_back({"PAL4-GameObject-object-scale", 2, 1.0f});
                root.attributes.push_back({"PAL4-GameObject-object-research-num", 2, 1.9f});
                if (const auto xml = pal4::BinaryXmlConfig::Serialize(root)) {
                    (void)forge.config.Parse(*xml);
                }
            }
            arena->catalog.gobs.push_back(forge);

            ArenaActor forge_actor;
            forge_actor.name = "ChengtianSwordForge";
            forge_actor.animation = "C01";
            forge_actor.position = forge.position;
            forge_actor.gob_type = 0;
            forge_actor.actor = BuildSyntheticActor("C01");
            ObjectCollisionAtomic forge_atomic;
            forge_atomic.triangles.push_back({
                {Point3{30.f, 0.f, 15.f}, Point3{40.f, 0.f, 15.f}, Point3{40.f, 15.f, 25.f}},
                0, 0, 0
            });
            forge_actor.collision = ObjectCollisionGeometry{{forge_atomic}};
            arena->actors.push_back(std::move(forge_actor));

            SceneEvent evf;
            evf.name = "JuanyuntaiPortal";
            evf.effect_type = 1;
            evf.script = "EnterFinalAscension";
            evf.clump = {1};
            arena->catalog.events.push_back(evf);
            ObjectCollisionAtomic evf_atomic;
            evf_atomic.triangles.push_back({
                {Point3{-18.f, 0.f, -65.f}, Point3{18.f, 0.f, -65.f}, Point3{0.f, 15.f, -65.f}},
                0, 0, 0
            });
            arena->event_collisions.push_back(ObjectCollisionGeometry{{evf_atomic}});
        } else if (world == "M20" && scene == "1") {
            SceneNpc final_boss;
            final_boss.name = "XuanXiaoAndSuYao";
            final_boss.resource = "2999";
            final_boss.position = {0.f, 0.f, -10.f};
            final_boss.script = "EncounterXuanXiao";
            final_boss.flags[0] = 1;
            final_boss.flags[1] = 1;
            final_boss.flags[2] = std::bit_cast<std::uint32_t>(30.0f);
            arena->catalog.npcs.push_back(final_boss);

            ArenaActor boss_actor;
            boss_actor.name = "XuanXiaoAndSuYao";
            boss_actor.animation = "C01";
            boss_actor.position = final_boss.position;
            boss_actor.actor = BuildSyntheticActor("C01");
            arena->actors.push_back(std::move(boss_actor));

            SceneEvent evf;
            evf.name = "GrandEndingPortal";
            evf.effect_type = 1;
            evf.script = "TriggerGrandEnding";
            evf.clump = {1};
            arena->catalog.events.push_back(evf);
            ObjectCollisionAtomic evf_atomic;
            evf_atomic.triangles.push_back({
                {Point3{-18.f, 0.f, -65.f}, Point3{18.f, 0.f, -65.f}, Point3{0.f, 15.f, -65.f}},
                0, 0, 0
            });
            arena->event_collisions.push_back(ObjectCollisionGeometry{{evf_atomic}});
        }

        h.arena = std::move(arena);
        h.renderer.Upload(h.arena->world);
        const auto cur_leader = h.players.Leader();
        h.players.EnterScene(world, scene, cur_leader);
        h.controller.SelectActor(cur_leader, 1);

        h.minimap = std::make_unique<SceneMinimap>(
            std::string(world), std::string(scene),
            [](std::string_view) -> std::optional<std::vector<std::uint8_t>> { return std::nullopt; },
            [this](std::string_view member) -> std::optional<std::vector<std::uint8_t>> {
                auto it = ui_files_.find(std::string(member));
                if (it == ui_files_.end()) return std::nullopt;
                return std::vector<std::uint8_t>(it->second.begin(), it->second.end());
            });
        h.minimap->SetSceneType(1);

        h.scene_objects = std::make_unique<SceneObjects>(
            *h.arena, *h.minimap,
            [](std::string_view, std::string_view) -> std::optional<std::vector<std::uint8_t>> { return std::nullopt; });

        h.scene_npcs = std::make_unique<SceneNpcs>(
            *h.arena,
            [](std::string_view) -> std::optional<std::vector<std::uint8_t>> { return std::nullopt; });
        h.npc_actions = std::make_unique<NpcActions>(*h.scene_npcs);
        h.npc_walks = std::make_unique<NpcWalks>(*h.scene_npcs, h.arena->collision, h.arena->world);

        h.scene_collision = std::make_unique<SceneCollision>([&h](auto resource, bool entering, auto previous) {
            if (h.scene_events) h.scene_events->OnCollision(resource, entering, previous);
        });
        h.scene_collision->Add(CollisionGroup::wall, h.arena->collision.wall);

        if (!h.event_scripts) {
            h.event_scripts = std::make_unique<SyntheticEventScripts>(h);
        }
        h.scene_events = std::make_unique<SceneEvents>(*h.arena, *h.scene_collision, *h.event_scripts);
        h.scene_events->ActivateAll();

        h.game_movement = std::make_unique<SceneMovement>(h.arena->collision.floor);
        h.placement_services = std::make_unique<SyntheticPlacementServices>(h);
        if (!h.player_notifications) {
            h.player_notifications = std::make_unique<PlayerNotifications>();
        }
        h.game_placement = std::make_unique<PlayerPlacement>(
            h.players, *h.game_movement, *h.placement_services, *h.player_notifications);
        h.game_placement->SetCurrent(initial_boot ? Point3{0.f, 0.f, 0.f} : Point3{0.f, 0.f, 35.f});

        h.free_movement = std::make_unique<PlayerFreeMovement>(
            h.players, h.controller, *h.player_actions,
            *h.game_movement, *h.scene_collision, *h.placement_services,
            [&h] { (void)h.game_camera->Pose(); });

        h.scene_interaction = std::make_unique<SceneInteraction>(
            *h.arena, *h.scene_npcs, *h.scene_objects,
            *h.scene_events, *h.event_scripts, *h.interaction_hints,
            [](std::size_t, std::size_t) { return true; });
        h.scene_interaction->Reset(false);
    }

    void SetupSyntheticTrialScene() {
        auto& h = *host_;
        ui_files_ = SyntheticUiFiles();

        // 1. Property catalog & Inventory
        h.property_catalog[6201] = PropertyDefinition{
            6201, 1, "射日猎弓", "云天青留下的祖传猎弓", "", "", "", "", ""
        };
        h.property_catalog[6202] = PropertyDefinition{
            6202, 1, "望舒剑", "夙玉与云天青留下的琼华双剑之一，寒气逼人", "", "", "", "", ""
        };
        h.property_catalog[6203] = PropertyDefinition{
            6203, 1, "土灵珠", "女萝岩深处蕴含大地灵力的宝珠", "", "", "", "", ""
        };
        h.property_catalog[6204] = PropertyDefinition{
            6204, 1, "羲和剑", "与望舒剑并称的琼华双剑之一，阳炎炽烈", "", "", "", "", ""
        };
        h.property_catalog[6205] = PropertyDefinition{
            6205, 1, "九泉结局印记", "百年之后青鸾峰重逢的结局信物", "", "", "", "", ""
        };
        h.property_catalog[1001] = PropertyDefinition{
            1001, 0, "止血草", "恢复生命值的草药", "", "", "", "", ""
        };
        h.inventory = std::make_unique<Inventory>(h.property_catalog);
        h.inventory->AdjustMoney(500);
        h.inventory->Add(1001, 3);

        // 2. UI / Dialog / Interaction hints
        h.dialog_assets = std::make_unique<DialogAssets>(
            [this](std::string_view member) -> std::optional<std::vector<std::uint8_t>> {
                auto it = ui_files_.find(std::string(member));
                if (it == ui_files_.end()) return std::nullopt;
                return std::vector<std::uint8_t>(it->second.begin(), it->second.end());
            });
        h.interaction_hints = std::make_unique<InteractionHints>(
            1,
            [&h](std::uint32_t key) -> std::optional<std::string> {
                auto it = h.interaction_text.find(key);
                return it == h.interaction_text.end() ? std::optional<std::string>("提示") : it->second;
            },
            [](std::string_view, std::uint32_t) {});
        h.inventory_services = std::make_unique<InventoryServices>(
            *h.inventory,
            h.property_catalog,
            [&h](std::uint32_t id) -> std::optional<std::string> {
                auto it = h.interaction_text.find(id);
                if (it != h.interaction_text.end()) return it->second;
                return std::optional<std::string>{"获得【%s】×%d"};
            },
            [&h](std::string_view text, float x, float y, float duration) {
                h.interaction_hints->ShowMessage(text, x, y, duration);
            },
            [](std::string_view, std::uint32_t) {});

        // 3. Prepare 4 PAL4 heroes in PlayerRoster + PlayerEquipment
        h.roles = BuildPal4Roles();
        h.equipment_catalog = BuildSyntheticEquipment();
        h.upgrades = {
            {1, 1001, 1, 0, {{480, 100, 180, 95, 60, 75, 70, 50}}},
            {2, 1002, 1, 0, {{420, 100, 210, 80, 55, 110, 95, 75}}},
            {3, 1003, 1, 0, {{450, 100, 320, 65, 65, 80, 85, 120}}},
            {4, 1004, 1, 0, {{560, 100, 240, 115, 95, 95, 75, 100}}},
        };
        h.players.Prepare(h.roles, h.upgrades, [](std::string_view) { return BuildSyntheticActor("C01"); });
        h.player_equipment = std::make_unique<PlayerEquipment>(h.players, h.equipment_catalog);
        h.controller.Initialize(800, 600, [] { return BuildSyntheticActor("C01"); });
        h.ready_input = std::make_unique<SyntheticResetServices>(h);
        h.controller.ResetAndSync(true, *h.ready_input);
        h.player_actions = std::make_unique<PlayerActions>(
            h.players,
            [](std::string_view) -> std::optional<std::vector<std::uint8_t>> { return std::nullopt; });
        h.player_turns = std::make_unique<PlayerTurns>(h.players, *h.player_actions);

        // 4. Camera & FloorAttributes & Load initial scene Q01/N01
        h.game_camera = std::make_unique<GameCameraSystem>();
        h.game_camera->SetParameters(0, {0.f, 0.f, 0.f}, {0.f, -0.35f, 0.f}, 180.f);
        h.camera_follow = std::make_unique<CameraFollow>(
            *h.game_camera,
            [&h]() -> std::optional<CameraFollowTarget> {
                if (!h.players.Prepared() || !h.controller.State().actor) return std::nullopt;
                const auto idx = *h.controller.State().actor;
                const auto& player = h.players.Slots().at(idx);
                return CameraFollowTarget{player.position, player.rotation, 18.f, player.auto_seek};
            },
            [&h](bool enabled) { h.players.SetAutoSeek(enabled); });
        h.floor_attributes = std::make_unique<FloorAttributes>();
        h.distance = std::make_unique<DistanceOptimization>();

        LoadSyntheticArena("Q01", "N01", true);

        // 6. Wire GameServices, DialogServices, ScreenEffectServices, and AngelScript VM
        h.game_services = std::make_unique<GameServices>(h.trace);
        h.game_services->add_property = [&h](std::uint32_t id, std::int32_t count, bool show_hint) {
            h.inventory_services->Add(id, count, show_hint);
        };
        h.game_services->remove_property = [&h](std::uint32_t id, std::int32_t count, bool show_hint) {
            h.inventory_services->Remove(id, count, show_hint);
        };
        h.game_services->add_equipment = [&h](std::int32_t actor, std::uint32_t item_id) {
            h.player_equipment->Add(actor, item_id);
        };
        h.game_services->set_full_hp = [&h]() {
            h.players.SetFullHp();
        };
        h.game_services->set_full_mp = [&h]() {
            h.players.SetFullMp();
        };
        h.game_services->set_full_rage = [&h]() {
            h.players.SetFullRage();
        };
        h.game_services->player_take_rest = [&h]() {
            h.players.TakeARest();
        };
        h.game_services->set_player_level = [&h](std::int32_t index, std::int32_t level) {
            h.players.SetLevel(index, level);
        };
        h.game_services->get_player_level = [&h](std::int32_t index) -> std::int32_t {
            return h.players.GetLevel(index);
        };
        h.game_services->add_player_skill = [&h](std::int32_t index, std::uint32_t skill_id, bool) {
            h.players.AddSkill(index, skill_id);
        };
        h.game_services->add_player_favor = [&h](std::int32_t first_index, std::int32_t second_index, std::int32_t delta) {
            h.players.AddFavor(first_index, second_index, delta);
        };
        h.game_services->set_player_visible = [&h](std::int32_t index, bool visible) {
            h.players.SetVisible(index, visible);
        };
        h.game_services->set_current_player_visible = [&h](bool visible) {
            h.players.SetVisible(static_cast<std::int32_t>(h.players.Leader()), visible);
        };
        h.game_services->set_player_position = [&h](std::int32_t index, Point3 pos) {
            h.players.SetPosition(static_cast<std::uint32_t>(index), pos);
        };
        h.game_services->check_property = [&h](std::uint32_t id, std::int32_t required) -> bool {
            return required <= 0 || h.inventory->Count(id) >= static_cast<std::uint32_t>(required);
        };
        h.game_services->get_property_count = [&h](std::uint32_t id) -> std::int32_t {
            return static_cast<std::int32_t>(h.inventory->Count(id));
        };
        h.game_services->get_money = [&h]() -> std::int32_t {
            return h.inventory->Money();
        };
        h.game_services->add_money = [&h](std::int32_t amount, bool) {
            h.inventory->AdjustMoney(amount);
        };
        h.game_services->pay_money = [&h](std::int32_t amount, bool) {
            h.inventory->AdjustMoney(-amount);
        };
        h.game_services->come_from_here = [this](std::string_view world, std::string_view scene) -> std::int32_t {
            return (prev_world_ == world && prev_scene_ == scene) ? 1 : 0;
        };
        h.game_services->get_random_number = [this](std::int32_t minimum, std::int32_t maximum) -> std::int32_t {
            if (maximum <= minimum) return minimum;
            const auto span = static_cast<std::uint32_t>(maximum - minimum);
            return minimum + static_cast<std::int32_t>(rng_.Next() % span);
        };
        h.game_services->get_arena_name = [&h]() -> std::string {
            return h.arena ? h.arena->description.world : "";
        };
        h.game_services->get_arena_area = [&h]() -> std::string {
            return h.arena ? h.arena->description.scene : "";
        };
        h.game_services->start_time_script = [&h](float delay_seconds, std::string_view callback) {
            if (h.time_script) {
                h.time_script->Start(delay_seconds, callback);
            }
        };
        h.game_services->terminate_time_script = [&h]() {
            if (h.time_script) {
                h.time_script->Terminate();
            }
        };
        h.game_services->add_combat_monster = [this](std::int32_t monster_id, std::int32_t slot) {
            if (!combat_.active && !combat_.enemies.empty() &&
                std::all_of(combat_.enemies.begin(), combat_.enemies.end(), [](const auto& e) { return e.hp <= 0; })) {
                combat_.enemies.clear();
            }
            CombatEnemy unit;
            unit.slot = slot;
            unit.monster_id = monster_id;
            if (monster_id == 2579) {
                unit.name = "魁召(Boss)";
                unit.hp = 600;
                unit.max_hp = 600;
                unit.attack = 85;
            } else if (monster_id == 2610) {
                unit.name = "槐妖长老(Boss)";
                unit.hp = 900;
                unit.max_hp = 900;
                unit.attack = 110;
            } else if (monster_id == 2611) {
                unit.name = "女萝藤妖";
                unit.hp = 360;
                unit.max_hp = 360;
                unit.attack = 65;
            } else if (monster_id == 2999) {
                unit.name = "玄霄(Final Boss)";
                unit.hp = 1500;
                unit.max_hp = 1500;
                unit.attack = 145;
            } else if (monster_id == 2998) {
                unit.name = "夙瑶(Boss)";
                unit.hp = 1000;
                unit.max_hp = 1000;
                unit.attack = 120;
            } else {
                unit.name = "符灵";
                unit.hp = 220;
                unit.max_hp = 220;
                unit.attack = 45;
            }
            unit.health_state = 0;
            combat_.enemies.push_back(std::move(unit));
        };
        h.game_services->config_combat_param = [this](bool unbreakable, std::int32_t round_limit, std::int32_t vip_monster, std::int32_t mode) {
            combat_.param_words = {unbreakable ? 1 : 0, round_limit, vip_monster, mode};
            combat_.vip_monster = vip_monster;
        };
        h.game_services->config_combat_bgm = [this](std::string_view bgm) {
            combat_.bgm = std::string(bgm);
        };
        h.game_services->config_combat_camera = [this](std::string_view cam) {
            combat_.camera = std::string(cam);
        };
        h.game_services->config_combat_ground_camera = [this](std::string_view cam) {
            combat_.ground_camera = std::string(cam);
        };
        h.game_services->config_combat_vip_monster = [this](std::int32_t vip) {
            combat_.vip_monster = vip;
        };
        h.game_services->start_combat = [this](const ScriptRequest& req) -> ScriptResponse {
            combat_.active = true;
            combat_.world = req.call.arguments.empty() ? "M01" : std::get<std::string>(req.call.arguments[0]);
            combat_.round = 1;
            combat_.wait_token = req.token;
            combat_.last_log = "进入战斗！请使用 combat_action 指令进行战斗（action: attack/skill/item）。";
            if (combat_.enemies.empty()) {
                host_->game_services->add_combat_monster(2579, 1);
            }
            return {{}, true};
        };
        h.game_services->object_research = [&h](std::string_view name, bool enabled) {
            h.scene_objects->SetResearch(name, enabled);
        };
        h.game_services->object_visible = [&h](std::string_view name, bool visible) {
            h.scene_objects->SetVisible(name, visible);
        };
        h.game_services->npc_visible = [&h](std::string_view name, bool visible) {
            h.scene_npcs->SetVisible(name, visible);
        };
        h.game_services->event_visible = [&h](std::string_view name, bool visible) {
            if (h.scene_events) h.scene_events->SetVisible(name, visible);
        };
        h.game_services->set_leader = [this](std::int32_t index) { SwitchLeader(index); };
        h.game_services->get_leader = [&h]() -> std::int32_t {
            return static_cast<std::int32_t>(h.players.Leader());
        };
        h.game_services->add_team_member = [&h](std::int32_t index, bool) {
            h.players.SetInTeam(index, true);
        };
        h.game_services->remove_team_member = [&h](std::int32_t index, bool) {
            h.players.SetInTeam(index, false);
        };
        h.game_services->get_current_x = [&h]() -> float { return h.game_placement->CurrentX(); };
        h.game_services->get_current_y = [&h]() -> float { return h.game_placement->CurrentY(); };
        h.game_services->get_current_z = [&h]() -> float { return h.game_placement->CurrentZ(); };

        h.dialog = std::make_unique<DialogServices>(*h.game_services, *h.dialog_assets, 1);
        h.dialog->Prepare();
        h.game_arena = std::make_unique<ArenaServices>(*h.dialog);
        h.game_settings = std::make_unique<SettingsServices>(*h.game_arena, h.settings, *h.settings_store);
        h.game_media = std::make_unique<MediaServices>(*h.game_settings, 1);
        h.game_effect = std::make_unique<ScreenEffectServices>(*h.game_media);

        h.game = std::make_unique<ScriptStack>(h.game_globals);
        h.game->Compile("Q01", R"(
            void Q01_N01_init() {
                global_mvar = 100;
            }
            void TalkLingsha() {
                giSetPortrait("101G", true);
                giPlayerInTeam(1, true);
                giTalk("韩菱纱：野人！北面(z=60)是石沉溪洞死路岩壁，快去西侧(-40, 0, 25)打开木匣取回猎弓，再换我带队去南侧(0, 0, -65)开启洞口机关进入石沉溪洞深处！", "40001");
                if (global_mvar < 101) {
                    global_mvar = 101;
                }
            }
            void OpenBowChest() {
                giAddProperty(6201, 1, true);
                giAddPlayerEquip(0, 3501);
                giTalk("开启云天青遗留木匣，获得并装备【射日猎弓】×1！", "40002");
                global_mvar = 102;
            }
            void TriggerCaveExit() {
                if (global_mvar >= 102 && giPlayerGetLeader() == 1 && giPlayerCurrentGetPosZ() <= -40.0f) {
                    global_mvar = 200;
                    giTalk("石沉溪洞外门机关开启！正在进入石沉溪洞深处（M01/1）……", "40003");
                    giArenaLoad("M01", "1", "", true);
                } else if (global_mvar >= 102) {
                    giTalk("洞口机关需要切换韩菱纱（index=1）作为领队才能解开！", "40005");
                } else {
                    giTalk("洞口被石门封住，需要先取回西侧木匣中的【射日猎弓】。", "40004");
                }
            }
        )");
        h.game_modules.insert("Q01");

        h.game->Compile("M01", R"(
            void M01_1_init() {
                if (global_mvar < 201) {
                    global_mvar = 201;
                }
                giTimeScript(12.0f, "func9001");
            }
            void func9001() {
                giShowHint("9001", 0.5f, 0.2f);
            }
            void EncounterKuiZhao() {
                if (global_mvar >= 210) {
                    giTalk("魁召已经化作符灵消散，快向南(0, 0, -65)前往冰封墓室吧。", "40013");
                    return;
                }
                giSetPortrait("100A", true);
                giConfigCombatBgm("P39");
                giConfigCombatCamera("CA7");
                giConfigCombatGroundCamera("CA12");
                giConfigCombatParam(true, 4, 2579, 2);
                giAddCombatMonster(2579, 1);
                giAddCombatMonster(2580, 0);
                giAddCombatMonster(2580, 2);
                giStartCombat("M01");
                global_mvar = 210;
                giTalk("魁召：剑灵试炼通过！通往冰封墓室的石门已经开启，快向南(0, 0, -65)前进吧！", "40010");
            }
            void EnterTombChamber() {
                if (global_mvar >= 210 && giPlayerCurrentGetPosZ() <= -40.0f) {
                    global_mvar = 220;
                    giTimeScriptTerminate();
                    giSetFullHP();
                    giSetFullMP();
                    giTalk("击败魁召后石门轰然开启，进入石沉溪洞·冰封墓室（M01/2）！", "40011");
                    giArenaLoad("M01", "2", "", true);
                } else {
                    giTalk("前方(0, 0, -10)的巨型符灵【魁召】挡住了去路，必须先与魁召交互并击败它！", "40012");
                }
            }
            void M01_2_init() {
                if (global_mvar < 220) {
                    global_mvar = 220;
                }
            }
            void InspectWangshuAltar() {
                if (global_mvar < 250) {
                    giAddProperty(6202, 1, true);
                    giAddPlayerEquip(0, 3500);
                    global_mvar = 250;
                    giTalk("云天河握住冰封古剑，寒冰瞬间碎裂！获得并装备【望舒剑】！现在可以向南(0, 0, -65)离开石沉溪洞下山了！", "40020");
                } else {
                    giTalk("冰封剑台上的【望舒剑】已经取下，快向南(0, 0, -65)离开石沉溪洞吧。", "40023");
                }
            }
            void LeaveCaveToFootOfMountain() {
                if (global_mvar >= 250 && giPlayerCurrentGetPosZ() <= -40.0f) {
                    global_mvar = 300;
                    giTalk("云天河与韩菱纱携【望舒剑】走出石沉溪洞，踏上前往寿阳城与女萝岩的旅途！正在进入第二章：寿阳城·柳府（Q02/N01）……", "40021");
                    giArenaLoad("Q02", "N01", "", true);
                } else {
                    giTalk("墓室中央(0, 0, 0)的冰封剑台上似乎有一柄散发寒气的古剑，先去调查剑台吧！", "40022");
                }
            }
        )");
        h.game_modules.insert("M01");

        h.game->Compile("Q02", R"(
            void Q02_N01_init() {
                if (giArenaComeFromHere("M01", "2") == 1 && global_mvar < 310) {
                    global_mvar = 310;
                }
            }
            void TalkMengli() {
                if (global_mvar < 350) {
                    giPlayerInTeam(2, true);
                    giAddPlayerFavor(2, 0, 25);
                    giAddMoney(1500, true);
                    giPlayerTakeARest();
                    giPlayerAddSkill(0, 5101, true);
                    giPlayerAddSkill(1, 5102, true);
                    giPlayerAddSkill(2, 5103, true);
                    global_mvar = 350;
                    giTalk("柳梦璃加入队伍！全队休憩恢复并习得五灵仙术，获赠盘缠 1500 文！现在请向南(0, 0, -65)前往女萝岩（M04/1）调查妖界异动！", "40030");
                } else {
                    giTalk("柳梦璃：云公子、菱纱妹妹，我们快向南(0, 0, -65)出发前往女萝岩吧。", "40031");
                }
            }
            void EnterNvLuoYan() {
                if (global_mvar >= 350 && giPlayerCurrentGetPosZ() <= -40.0f) {
                    global_mvar = 400;
                    giTalk("离开寿阳城柳府，进入女萝岩·底层大殿（M04/1）！", "40032");
                    giArenaLoad("M04", "1", "", true);
                } else {
                    giTalk("请先与庭院东侧(30, 0, 0)的【柳梦璃】交谈，邀请她加入队伍后再前往女萝岩。", "40033");
                }
            }
        )");
        h.game_modules.insert("Q02");

        h.game->Compile("M04", R"(
            void M04_1_init() {
                if (giArenaComeFromHere("Q02", "N01") == 1 && global_mvar < 410) {
                    global_mvar = 410;
                }
            }
            void EncounterHuaiYao() {
                if (global_mvar >= 450) {
                    giTalk("槐妖长老已经伏诛并献出【土灵珠】，快向南(0, 0, -65)御剑前往昆仑琼华派吧！", "40042");
                    return;
                }
                giSetFullRage();
                giConfigCombatBgm("P41");
                giConfigCombatCamera("CA8");
                giConfigCombatGroundCamera("CA12");
                giConfigCombatParam(true, 6, 2610, 2);
                giAddCombatMonster(2610, 1);
                giAddCombatMonster(2611, 0);
                giAddCombatMonster(2611, 2);
                giStartCombat("M04");
                giSetPlayerLevel(0, 18);
                giSetPlayerLevel(1, 18);
                giSetPlayerLevel(2, 18);
                giAddProperty(6203, 1, true);
                global_mvar = 450;
                giTalk("击败女萝岩槐妖长老！全队等级提升至 18 级，获得【土灵珠】×1！现在可以向南(0, 0, -65)前往昆仑琼华派（Q07/N01）！", "40040");
            }
            void AscendToQionghua() {
                if (global_mvar >= 450 && giCheckPackProperty(6203, 1) && giPlayerCurrentGetPosZ() <= -40.0f) {
                    global_mvar = 500;
                    giPlayerTakeARest();
                    giTalk("第二章通关！云天河、韩菱纱、柳梦璃踏上太一仙径，登上昆仑琼华派·剑舞坪（Q07/N01）！", "40041");
                    giArenaLoad("Q07", "N01", "", true);
                } else {
                    giTalk("前方(0, 0, -10)的【槐妖长老】阻拦了去路，请先与它交互并击败它夺取【土灵珠】！", "40043");
                }
            }
        )");
        h.game_modules.insert("M04");

        h.game->Compile("Q07", R"(
            void Q07_N01_init() {
                if (giArenaComeFromHere("M04", "1") == 1 && global_mvar < 510) {
                    global_mvar = 510;
                }
            }
            void TalkZiying() {
                if (global_mvar < 550) {
                    giPlayerInTeam(3, true);
                    giSetPlayerLevel(3, 25);
                    giPlayerAddSkill(3, 5201, true);
                    giAddPlayerFavor(3, 0, 20);
                    global_mvar = 550;
                    giTalk("慕容紫英加入队伍（全员四人集结）并传授剑道仙术！请再去东侧(35, 0, 20)的【承天剑台】铸造并取出【羲和剑】，随后向南(0, 0, -65)前往卷云台决战！", "40050");
                } else {
                    giTalk("慕容紫英：去东侧(35, 0, 20)的承天剑台取出【羲和剑】后，便向南(0, 0, -65)登上卷云台阻止玄霄与夙瑶飞升！", "40051");
                }
            }
            void ForgeXiHeSword() {
                if (global_mvar < 550) {
                    giTalk("承天剑台由慕容紫英镇守，请先与西侧(-30, 0, 0)的【慕容紫英】交谈邀请他入队！", "40052");
                    return;
                }
                if (global_mvar < 600) {
                    if (giGetMoney() >= 1000) {
                        giPayMoney(1000, true);
                    }
                    giAddProperty(6204, 1, true);
                    giAddPlayerEquip(3, 3502);
                    global_mvar = 600;
                    giTalk("在承天剑台耗费 1000 文灵材淬炼，获得【羲和剑】并强化慕容紫英剑装！现在向南(0, 0, -65)前往卷云台（M20/1）迎接最终决战！", "40053");
                } else {
                    giTalk("【羲和剑】已经取出，快向南(0, 0, -65)前往卷云台吧！", "40054");
                }
            }
            void EnterFinalAscension() {
                if (global_mvar >= 600 && giCheckPackProperty(6204, 1) && giPlayerCurrentGetPosZ() <= -40.0f) {
                    global_mvar = 700;
                    giPlayerTakeARest();
                    giSetFullRage();
                    giTalk("第三章通关！双剑齐聚，四人登上冰火交织的琼华飞升·卷云台（M20/1）！", "40055");
                    giArenaLoad("M20", "1", "", true);
                } else {
                    giTalk("前往卷云台决战前，必须先邀请西侧(-30, 0, 0)的【慕容紫英】入队，并在东侧(35, 0, 20)的承天剑台取得【羲和剑】！", "40056");
                }
            }
        )");
        h.game_modules.insert("Q07");

        h.game->Compile("M20", R"(
            void M20_1_init() {
                if (giArenaComeFromHere("Q07", "N01") == 1 && global_mvar < 710) {
                    global_mvar = 710;
                }
            }
            void EncounterXuanXiao() {
                if (global_mvar >= 900) {
                    giTalk("玄霄已被打入东海漩涡，琼华坠落之危已解！快向南(0, 0, -65)走向结局传送门完成通关吧！", "40062");
                    return;
                }
                giSetFullHP();
                giSetFullMP();
                giSetFullRage();
                giConfigCombatBgm("P45");
                giConfigCombatCamera("CA9");
                giConfigCombatGroundCamera("CA12");
                giConfigCombatParam(true, 10, 2999, 3);
                giAddCombatMonster(2999, 1);
                giAddCombatMonster(2998, 0);
                giStartCombat("M20");
                giSetPlayerLevel(0, 50 + giGetRandnum(0, 5));
                giSetPlayerLevel(1, 50);
                giSetPlayerLevel(2, 50);
                giSetPlayerLevel(3, 50);
                giAddProperty(6205, 1, true);
                global_mvar = 900;
                giTalk("云天河挽弓搭起射日猎弓与望舒剑，一箭射碎坠落的琼华冰峰！成功击败最终 Boss【玄霄】与【夙瑶】！请向南(0, 0, -65)迈入青鸾峰结局之门！", "40060");
            }
            void TriggerGrandEnding() {
                if (global_mvar >= 900 && giCheckPackProperty(6205, 1) && giPlayerCurrentGetPosZ() <= -40.0f) {
                    global_mvar = 1000;
                    giTalk("百年之后，青鸾峰木屋旁，清风吹拂望舒剑与墓碑，柳梦璃踏花归来，四位故人终得重逢——《仙剑奇侠传四》全四章大结局完美通关！", "40061");
                } else {
                    giTalk("卷云台中央(0, 0, -10)的【玄霄与夙瑶】正在催动双剑强行飞升，必须先击败他们！", "40063");
                }
            }
        )");
        h.game_modules.insert("M20");

        h.game->Push("Q01", "void Q01_N01_init()", *h.game_effect);
        h.game->Tick(0.0, 1000, ScriptRunMode::until_wait);
        while (h.game->State() == ScriptState::finished) {
            h.game->PopFinished();
        }
        RenderHeadlessFrame();
    }

    std::string work_dir_;
    std::string prev_world_;
    std::string prev_scene_;
    std::map<std::string, std::string> ui_files_;
    std::unique_ptr<ChapterHost> host_;
    CombatFormulaCatalog formulas_ = BuildSyntheticFormulaCatalog();
    pal4::RandomNumberGenerator rng_;
    CombatEncounterState combat_;
};

std::unique_ptr<AgentPal4Engine>& GlobalEngine() {
    static std::unique_ptr<AgentPal4Engine> engine;
    return engine;
}

std::string HandleRpcCommand(AgentPal4Engine& engine, std::string_view line) {
    const auto cmd = ExtractJsonString(line, "cmd").value_or("observe");
    if (cmd == "observe") {
        return engine.ObserveJson("observed");
    }
    if (cmd == "reset") {
        engine.Reset();
        return engine.ObserveJson("reset");
    }
    if (cmd == "step") {
        const int frames = static_cast<int>(ExtractJsonNumber(line, "frames").value_or(1));
        const float move_x = static_cast<float>(ExtractJsonNumber(line, "move_x").value_or(0.0));
        const float move_y = static_cast<float>(ExtractJsonNumber(line, "move_y").value_or(0.0));
        const float cam_yaw = static_cast<float>(ExtractJsonNumber(line, "cam_yaw").value_or(0.0));
        const bool confirm = ExtractJsonBool(line, "confirm").value_or(false);
        engine.StepFrames(frames, move_x, move_y, cam_yaw, confirm);
        return engine.ObserveJson("stepped");
    }
    if (cmd == "move_to") {
        const float x = static_cast<float>(ExtractJsonNumber(line, "x").value_or(0.0));
        const float y = static_cast<float>(ExtractJsonNumber(line, "y").value_or(0.0));
        const float z = static_cast<float>(ExtractJsonNumber(line, "z").value_or(0.0));
        const int max_steps = static_cast<int>(ExtractJsonNumber(line, "max_steps").value_or(180));
        const auto res = engine.MoveTo(x, y, z, max_steps);
        std::string tag = res.reached ? "move_reached" : (res.blocked ? "move_blocked_by_wall" : "move_steps_exhausted");
        return engine.ObserveJson(tag);
    }
    if (cmd == "interact") {
        const std::string tag = engine.Interact();
        return engine.ObserveJson(tag);
    }
    if (cmd == "switch_leader") {
        const int index = static_cast<int>(ExtractJsonNumber(line, "index").value_or(0));
        const bool ok = engine.SwitchLeader(index);
        return engine.ObserveJson(ok ? "leader_switched" : "leader_switch_failed");
    }
    if (cmd == "combat_action") {
        const auto action = ExtractJsonString(line, "action").value_or("attack");
        const int target_slot = static_cast<int>(ExtractJsonNumber(line, "target_slot").value_or(1));
        const std::string tag = engine.CombatAction(action, target_slot);
        return engine.ObserveJson(tag);
    }
    return "{\"ok\":false,\"error\":\"unknown command: " + EscapeJson(cmd) + "\"}";
}

} // namespace

extern "C" {

void agent_pal4_init(const char* work_dir) {
    GlobalEngine() = std::make_unique<AgentPal4Engine>(work_dir && *work_dir ? work_dir : "/tmp/agent-pal4-work");
}

const char* agent_pal4_rpc(const char* json_line) {
    static std::string response;
    if (!GlobalEngine()) {
        agent_pal4_init("/tmp/agent-pal4-work");
    }
    try {
        response = HandleRpcCommand(*GlobalEngine(), json_line ? json_line : "{}");
    } catch (const std::exception& e) {
        response = std::string("{\"ok\":false,\"error\":\"") + EscapeJson(e.what()) + "\"}";
    }
    return response.c_str();
}

} // extern "C"

int main(int argc, char** argv) {
    try {
        std::string work_dir = "/tmp/agent-pal4-work";
        bool self_test = false;
        for (int i = 1; i < argc; ++i) {
            std::string_view arg(argv[i]);
            if (arg == "--work-dir" && i + 1 < argc) {
                work_dir = argv[++i];
            } else if (arg == "--self-test") {
                self_test = true;
            }
        }
        agent_pal4_init(work_dir.c_str());
        if (self_test) {
            std::cout << agent_pal4_rpc(R"({"cmd":"observe"})") << "\n";
            return 0;
        }
        std::string line;
        while (std::getline(std::cin, line)) {
            if (line.empty()) continue;
            if (line == "quit" || line == "exit") break;
            std::cout << agent_pal4_rpc(line.c_str()) << std::endl;
        }
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "{\"ok\":false,\"fatal\":\"" << EscapeJson(e.what()) << "\"}\n";
        return 1;
    }
}
