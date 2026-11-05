#include "GLES3/gl3.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <map>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace {

struct GlesVertex {
    float position[3];
    float uv0[2];
    float uv1[2];
    float color[4];
};
static_assert(sizeof(GlesVertex) == 44, "GlesVertex must match pal4::portable::Vertex");

struct Texture2D {
    int width{1};
    int height{1};
    GLenum wrap_s{GL_REPEAT};
    GLenum wrap_t{GL_REPEAT};
    std::vector<std::uint8_t> rgba{255, 255, 255, 255};
};

struct HeadlessGlState {
    GLuint next_id{1};
    GLuint current_program{0};
    GLuint current_vao{0};
    GLuint array_buffer{0};
    GLuint element_array_buffer{0};
    GLuint active_texture{GL_TEXTURE0};
    GLuint bound_texture_2d{0};
    std::array<GLuint, 2> bound_textures{0, 0};
    GLuint draw_fbo{0};
    GLuint read_fbo{0};
    GLuint current_rbo{0};
    GLenum cull_face_mode{GL_BACK};
    GLenum front_face{GL_CCW};
    GLenum depth_func{GL_LEQUAL};
    GLboolean depth_mask{GL_TRUE};
    GLenum blend_src_rgb{GL_SRC_ALPHA};
    GLenum blend_dst_rgb{GL_ONE_MINUS_SRC_ALPHA};
    GLenum blend_src_alpha{GL_SRC_ALPHA};
    GLenum blend_dst_alpha{GL_ONE_MINUS_SRC_ALPHA};
    GLenum blend_equation_rgb{GL_FUNC_ADD};
    GLenum blend_equation_alpha{GL_FUNC_ADD};
    GLint unpack_alignment{4};
    GLint pack_alignment{4};
    std::array<GLint, 4> viewport{0, 0, 800, 600};
    std::array<GLint, 4> scissor{0, 0, 800, 600};
    std::array<GLfloat, 4> clear_color{0.f, 0.f, 0.f, 1.f};
    GLfloat clear_depth{1.f};
    std::map<GLenum, bool> enabled{
        {GL_DEPTH_TEST, false},
        {GL_CULL_FACE, false},
        {GL_BLEND, false},
        {GL_SCISSOR_TEST, false},
    };
    std::map<GLuint, std::map<std::string, GLint>> uniform_locations;
    GLint next_uniform_loc{100};

    // Uniform values for GlesRenderer shader
    std::array<float, 16> u_view_proj{1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1};
    bool u_sky_pass{false};
    std::array<float, 4> u_material_color{1.f, 1.f, 1.f, 1.f};
    std::array<float, 3> u_saturation{1.f, 1.f, 1.f};
    float u_brightness{0.f};
    float u_alpha_cutoff{0.f};
    std::array<float, 9> u_diffuse_uv{1,0,0, 0,1,0, 0,0,1};
    std::array<float, 9> u_light_uv{1,0,0, 0,1,0, 0,0,1};

    std::unordered_map<GLuint, std::vector<std::uint8_t>> buffers;
    std::unordered_map<GLuint, Texture2D> textures;
    bool rasterize_enabled{false};
    std::vector<std::uint8_t> color_buffer = std::vector<std::uint8_t>(1024 * 1024 * 4, 0);
    std::vector<float> depth_buffer = std::vector<float>(1024 * 1024, 1.0f);
    AgentPal4GlesStats stats{};
};

HeadlessGlState& State() {
    static HeadlessGlState state;
    return state;
}

void AllocateIds(GLsizei n, GLuint* out) {
    auto& s = State();
    for (GLsizei i = 0; i < n; ++i) {
        out[i] = s.next_id++;
    }
}

struct ClipVert {
    float cx, cy, cz, cw;
    float du, dv, lu, lv;
    float r, g, b, a;
    float sx, sy, sz, inv_w;
};

ClipVert LerpClipVert(const ClipVert& a, const ClipVert& b, float t) {
    ClipVert o{};
    o.cx = a.cx + (b.cx - a.cx) * t;
    o.cy = a.cy + (b.cy - a.cy) * t;
    o.cz = a.cz + (b.cz - a.cz) * t;
    o.cw = a.cw + (b.cw - a.cw) * t;
    o.du = a.du + (b.du - a.du) * t;
    o.dv = a.dv + (b.dv - a.dv) * t;
    o.lu = a.lu + (b.lu - a.lu) * t;
    o.lv = a.lv + (b.lv - a.lv) * t;
    o.r  = a.r  + (b.r  - a.r)  * t;
    o.g  = a.g  + (b.g  - a.g)  * t;
    o.b  = a.b  + (b.b  - a.b)  * t;
    o.a  = a.a  + (b.a  - a.a)  * t;
    return o;
}

template <typename PlaneFn>
int ClipPolygonAgainstPlane(const ClipVert* in_verts, int in_count, ClipVert* out_verts, PlaneFn dist_fn) {
    if (in_count < 3) return 0;
    int out_count = 0;
    ClipVert prev = in_verts[in_count - 1];
    float prev_d = dist_fn(prev);
    bool prev_in = (prev_d >= 0.0f);
    for (int i = 0; i < in_count; ++i) {
        const ClipVert& curr = in_verts[i];
        const float curr_d = dist_fn(curr);
        const bool curr_in = (curr_d >= 0.0f);
        if (curr_in != prev_in) {
            const float denom = prev_d - curr_d;
            const float t = (std::abs(denom) > 1e-8f) ? std::clamp(prev_d / denom, 0.0f, 1.0f) : 0.5f;
            out_verts[out_count++] = LerpClipVert(prev, curr, t);
        }
        if (curr_in) {
            out_verts[out_count++] = curr;
        }
        prev = curr;
        prev_d = curr_d;
        prev_in = curr_in;
    }
    return out_count;
}

inline std::array<float, 4> SampleTexture(const Texture2D* tex, float u, float v) {
    if (!tex || tex->width <= 0 || tex->height <= 0 || tex->rgba.empty()) {
        return {1.0f, 1.0f, 1.0f, 1.0f};
    }
    if (!std::isfinite(u)) u = 0.0f;
    if (!std::isfinite(v)) v = 0.0f;
    if (tex->wrap_s == GL_CLAMP_TO_EDGE) {
        u = std::clamp(u, 0.0f, 1.0f);
    } else {
        u = u - std::floor(u);
    }
    if (tex->wrap_t == GL_CLAMP_TO_EDGE) {
        v = std::clamp(v, 0.0f, 1.0f);
    } else {
        v = v - std::floor(v);
    }
    const float fu = u * static_cast<float>(tex->width) - 0.5f;
    const float fv = v * static_cast<float>(tex->height) - 0.5f;
    const int x0 = static_cast<int>(std::floor(fu));
    const int y0 = static_cast<int>(std::floor(fv));
    const float tx = fu - static_cast<float>(x0);
    const float ty = fv - static_cast<float>(y0);

    auto wrap_coord = [](int c, int size, GLenum mode) -> int {
        if (mode == GL_CLAMP_TO_EDGE) return std::clamp(c, 0, size - 1);
        int m = c % size;
        return (m < 0) ? (m + size) : m;
    };
    const int wx0 = wrap_coord(x0, tex->width, tex->wrap_s);
    const int wx1 = wrap_coord(x0 + 1, tex->width, tex->wrap_s);
    const int wy0 = wrap_coord(y0, tex->height, tex->wrap_t);
    const int wy1 = wrap_coord(y0 + 1, tex->height, tex->wrap_t);

    const std::size_t w = static_cast<std::size_t>(tex->width);
    const std::size_t i00 = (static_cast<std::size_t>(wy0) * w + static_cast<std::size_t>(wx0)) * 4;
    const std::size_t i10 = (static_cast<std::size_t>(wy0) * w + static_cast<std::size_t>(wx1)) * 4;
    const std::size_t i01 = (static_cast<std::size_t>(wy1) * w + static_cast<std::size_t>(wx0)) * 4;
    const std::size_t i11 = (static_cast<std::size_t>(wy1) * w + static_cast<std::size_t>(wx1)) * 4;

    const float w00 = (1.0f - tx) * (1.0f - ty) * (1.0f / 255.0f);
    const float w10 = tx * (1.0f - ty) * (1.0f / 255.0f);
    const float w01 = (1.0f - tx) * ty * (1.0f / 255.0f);
    const float w11 = tx * ty * (1.0f / 255.0f);
    const auto* d = tex->rgba.data();
    return {
        d[i00 + 0] * w00 + d[i10 + 0] * w10 + d[i01 + 0] * w01 + d[i11 + 0] * w11,
        d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11,
        d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11,
        d[i00 + 3] * w00 + d[i10 + 3] * w10 + d[i01 + 3] * w01 + d[i11 + 3] * w11,
    };
}

void RasterizeClippedTriangle(
    HeadlessGlState& s,
    ClipVert A,
    ClipVert B,
    ClipVert C,
    const Texture2D* tex0,
    const Texture2D* tex1,
    int vp_w,
    int vp_h) {
    for (ClipVert* v : {&A, &B, &C}) {
        v->inv_w = 1.0f / v->cw;
        const float ndc_x = v->cx * v->inv_w;
        const float ndc_y = v->cy * v->inv_w;
        const float ndc_z = v->cz * v->inv_w;
        v->sx = (ndc_x * 0.5f + 0.5f) * static_cast<float>(vp_w);
        v->sy = (ndc_y * 0.5f + 0.5f) * static_cast<float>(vp_h);
        v->sz = std::clamp(ndc_z * 0.5f + 0.5f, 0.0f, 1.0f);
    }

    const float area = (B.sx - A.sx) * (C.sy - A.sy) - (B.sy - A.sy) * (C.sx - A.sx);
    if (std::abs(area) < 1e-4f || !std::isfinite(area)) return;

    const int min_x = std::max(0, static_cast<int>(std::floor(std::min({A.sx, B.sx, C.sx}))));
    const int max_x = std::min(vp_w - 1, static_cast<int>(std::ceil(std::max({A.sx, B.sx, C.sx}))));
    const int min_y = std::max(0, static_cast<int>(std::floor(std::min({A.sy, B.sy, C.sy}))));
    const int max_y = std::min(vp_h - 1, static_cast<int>(std::ceil(std::max({A.sy, B.sy, C.sy}))));
    if (min_x > max_x || min_y > max_y) return;

    const float inv_area = 1.0f / area;
    const bool depth_test = s.enabled[GL_DEPTH_TEST];
    const bool depth_write = (s.depth_mask == GL_TRUE);
    const bool blend = s.enabled[GL_BLEND];
    const bool additive_blend = blend && (s.blend_dst_rgb == GL_ONE);
    const float alpha_cutoff = s.u_alpha_cutoff;
    const float bright_mul = 1.0f + s.u_brightness;
    const auto sat = s.u_saturation;
    const auto mat_c = s.u_material_color;

    for (int py = min_y; py <= max_y; ++py) {
        const float fy = static_cast<float>(py) + 0.5f;
        const std::size_t row_offset = static_cast<std::size_t>(py) * static_cast<std::size_t>(vp_w);
        for (int px = min_x; px <= max_x; ++px) {
            const float fx = static_cast<float>(px) + 0.5f;
            const float wA = ((C.sx - B.sx) * (fy - B.sy) - (C.sy - B.sy) * (fx - B.sx)) * inv_area;
            const float wB = ((A.sx - C.sx) * (fy - C.sy) - (A.sy - C.sy) * (fx - C.sx)) * inv_area;
            const float wC = 1.0f - wA - wB;
            if (wA < 0.0f || wB < 0.0f || wC < 0.0f) continue;

            const float z = wA * A.sz + wB * B.sz + wC * C.sz;
            const std::size_t pix_idx = row_offset + static_cast<std::size_t>(px);
            if (depth_test && z > s.depth_buffer[pix_idx]) continue;

            const float iwA = wA * A.inv_w;
            const float iwB = wB * B.inv_w;
            const float iwC = wC * C.inv_w;
            const float iw_sum = iwA + iwB + iwC;
            if (iw_sum <= 1e-9f) continue;
            const float corr = 1.0f / iw_sum;
            const float b0 = iwA * corr;
            const float b1 = iwB * corr;
            const float b2 = 1.0f - b0 - b1;

            const float du = b0 * A.du + b1 * B.du + b2 * C.du;
            const float dv = b0 * A.dv + b1 * B.dv + b2 * C.dv;
            const auto d_sample = SampleTexture(tex0, du, dv);

            const float vr = b0 * A.r + b1 * B.r + b2 * C.r;
            const float vg = b0 * A.g + b1 * B.g + b2 * C.g;
            const float vb = b0 * A.b + b1 * B.b + b2 * C.b;
            const float va = b0 * A.a + b1 * B.a + b2 * C.a;

            const float base_a = va * mat_c[3] * d_sample[3];
            if (base_a <= 0.0f || base_a < alpha_cutoff) continue;

            const float base_r = vr * mat_c[0] * d_sample[0];
            const float base_g = vg * mat_c[1] * d_sample[1];
            const float base_b = vb * mat_c[2] * d_sample[2];

            float out_r = base_r;
            float out_g = base_g;
            float out_b = base_b;
            if (tex1) {
                const float lu = b0 * A.lu + b1 * B.lu + b2 * C.lu;
                const float lv = b0 * A.lv + b1 * B.lv + b2 * C.lv;
                const auto l_sample = SampleTexture(tex1, lu, lv);
                out_r = base_r * l_sample[0] * bright_mul * sat[0];
                out_g = base_g * l_sample[1] * bright_mul * sat[1];
                out_b = base_b * l_sample[2] * bright_mul * sat[2];
            }

            if (depth_write) {
                s.depth_buffer[pix_idx] = z;
            }

            const std::size_t c_idx = pix_idx * 4;
            if (blend) {
                const float src_a = std::clamp(base_a, 0.0f, 1.0f);
                const float dst_r = s.color_buffer[c_idx + 0] * (1.0f / 255.0f);
                const float dst_g = s.color_buffer[c_idx + 1] * (1.0f / 255.0f);
                const float dst_b = s.color_buffer[c_idx + 2] * (1.0f / 255.0f);
                if (additive_blend) {
                    out_r = out_r * src_a + dst_r;
                    out_g = out_g * src_a + dst_g;
                    out_b = out_b * src_a + dst_b;
                } else {
                    out_r = out_r * src_a + dst_r * (1.0f - src_a);
                    out_g = out_g * src_a + dst_g * (1.0f - src_a);
                    out_b = out_b * src_a + dst_b * (1.0f - src_a);
                }
            }

            s.color_buffer[c_idx + 0] = static_cast<std::uint8_t>(std::clamp(out_r, 0.0f, 1.0f) * 255.0f);
            s.color_buffer[c_idx + 1] = static_cast<std::uint8_t>(std::clamp(out_g, 0.0f, 1.0f) * 255.0f);
            s.color_buffer[c_idx + 2] = static_cast<std::uint8_t>(std::clamp(out_b, 0.0f, 1.0f) * 255.0f);
            s.color_buffer[c_idx + 3] = 255;
        }
    }
}

} // namespace

extern "C" {

void glActiveTexture(GLenum texture) { State().active_texture = texture; }
void glAttachShader(GLuint, GLuint) {}
void glBindAttribLocation(GLuint, GLuint, const GLchar*) {}

void glBindBuffer(GLenum target, GLuint buffer) {
    if (target == GL_ARRAY_BUFFER) State().array_buffer = buffer;
    else if (target == GL_ELEMENT_ARRAY_BUFFER) State().element_array_buffer = buffer;
}

void glBindFramebuffer(GLenum target, GLuint framebuffer) {
    if (target == GL_FRAMEBUFFER) {
        State().draw_fbo = framebuffer;
        State().read_fbo = framebuffer;
    } else if (target == GL_DRAW_FRAMEBUFFER) {
        State().draw_fbo = framebuffer;
    } else if (target == GL_READ_FRAMEBUFFER) {
        State().read_fbo = framebuffer;
    }
}

void glBindRenderbuffer(GLenum, GLuint renderbuffer) { State().current_rbo = renderbuffer; }
void glBindTexture(GLenum target, GLuint texture) {
    auto& s = State();
    s.bound_texture_2d = texture;
    if (target == GL_TEXTURE_2D) {
        const int unit = (s.active_texture == GL_TEXTURE1) ? 1 : 0;
        s.bound_textures[unit] = texture;
    }
}
void glBindVertexArray(GLuint array) { State().current_vao = array; }

void glBlendEquation(GLenum mode) {
    glBlendEquationSeparate(mode, mode);
}

void glBlendEquationSeparate(GLenum modeRGB, GLenum modeAlpha) {
    auto& s = State();
    s.blend_equation_rgb = modeRGB;
    s.blend_equation_alpha = modeAlpha;
}

void glBlendFunc(GLenum sfactor, GLenum dfactor) {
    glBlendFuncSeparate(sfactor, dfactor, sfactor, dfactor);
}

void glBlendFuncSeparate(GLenum sfactorRGB, GLenum dfactorRGB, GLenum sfactorAlpha, GLenum dfactorAlpha) {
    auto& s = State();
    s.blend_src_rgb = sfactorRGB;
    s.blend_dst_rgb = dfactorRGB;
    s.blend_src_alpha = sfactorAlpha;
    s.blend_dst_alpha = dfactorAlpha;
}

void glBlitFramebuffer(GLint, GLint, GLint, GLint, GLint, GLint, GLint, GLint, GLbitfield, GLenum) {}

void glBufferData(GLenum target, GLsizeiptr size, const void* data, GLenum) {
    auto& s = State();
    s.stats.buffers_uploaded++;
    if (target == GL_ARRAY_BUFFER && s.array_buffer != 0 && size > 0) {
        auto& buf = s.buffers[s.array_buffer];
        buf.resize(static_cast<std::size_t>(size));
        if (data) {
            std::memcpy(buf.data(), data, static_cast<std::size_t>(size));
        }
    }
}

void glBufferSubData(GLenum target, GLintptr offset, GLsizeiptr size, const void* data) {
    auto& s = State();
    s.stats.buffers_uploaded++;
    if (target == GL_ARRAY_BUFFER && s.array_buffer != 0 && offset >= 0 && size > 0 && data) {
        auto it = s.buffers.find(s.array_buffer);
        if (it != s.buffers.end()) {
            const std::size_t end_pos = static_cast<std::size_t>(offset + size);
            if (end_pos > it->second.size()) it->second.resize(end_pos);
            std::memcpy(it->second.data() + offset, data, static_cast<std::size_t>(size));
        }
    }
}

GLenum glCheckFramebufferStatus(GLenum) { return GL_FRAMEBUFFER_COMPLETE; }

void glClear(GLbitfield mask) {
    auto& s = State();
    const int vp_w = std::clamp(s.viewport[2], 1, 1024);
    const int vp_h = std::clamp(s.viewport[3], 1, 1024);
    const std::size_t pixel_count = static_cast<std::size_t>(vp_w) * static_cast<std::size_t>(vp_h);
    if (s.color_buffer.size() < pixel_count * 4) s.color_buffer.resize(pixel_count * 4, 0);
    if (s.depth_buffer.size() < pixel_count) s.depth_buffer.resize(pixel_count, 1.0f);

    if (mask & GL_COLOR_BUFFER_BIT) {
        const std::uint8_t r = static_cast<std::uint8_t>(std::clamp(s.clear_color[0], 0.f, 1.f) * 255.f);
        const std::uint8_t g = static_cast<std::uint8_t>(std::clamp(s.clear_color[1], 0.f, 1.f) * 255.f);
        const std::uint8_t b = static_cast<std::uint8_t>(std::clamp(s.clear_color[2], 0.f, 1.f) * 255.f);
        const std::uint8_t a = static_cast<std::uint8_t>(std::clamp(s.clear_color[3], 0.f, 1.f) * 255.f);
        const std::size_t limit = s.rasterize_enabled ? (pixel_count * 4) : std::min<std::size_t>(s.color_buffer.size(), 64 * 64 * 4);
        for (std::size_t i = 0; i < limit; i += 4) {
            s.color_buffer[i + 0] = r;
            s.color_buffer[i + 1] = g;
            s.color_buffer[i + 2] = b;
            s.color_buffer[i + 3] = a;
        }
    }
    if ((mask & GL_DEPTH_BUFFER_BIT) && s.rasterize_enabled) {
        std::fill_n(s.depth_buffer.begin(), pixel_count, s.clear_depth);
    }
}

void glClearColor(GLfloat red, GLfloat green, GLfloat blue, GLfloat alpha) {
    State().clear_color = {red, green, blue, alpha};
}

void glClearDepthf(GLfloat d) { State().clear_depth = d; }
void glCompileShader(GLuint) {}
GLuint glCreateProgram(void) { return State().next_id++; }
GLuint glCreateShader(GLenum) { return State().next_id++; }
void glCullFace(GLenum mode) { State().cull_face_mode = mode; }

void glDeleteBuffers(GLsizei n, const GLuint* buffers) {
    if (!buffers || n <= 0) return;
    auto& s = State();
    for (GLsizei i = 0; i < n; ++i) {
        s.buffers.erase(buffers[i]);
    }
}

void glDeleteFramebuffers(GLsizei, const GLuint*) {}
void glDeleteProgram(GLuint) {}
void glDeleteRenderbuffers(GLsizei, const GLuint*) {}
void glDeleteShader(GLuint) {}

void glDeleteTextures(GLsizei n, const GLuint* textures) {
    if (!textures || n <= 0) return;
    auto& s = State();
    for (GLsizei i = 0; i < n; ++i) {
        s.textures.erase(textures[i]);
    }
}

void glDeleteVertexArrays(GLsizei, const GLuint*) {}
void glDepthFunc(GLenum func) { State().depth_func = func; }
void glDepthMask(GLboolean flag) { State().depth_mask = flag; }
void glDisable(GLenum cap) { State().enabled[cap] = false; }

void glDrawArrays(GLenum mode, GLint first, GLsizei count) {
    auto& s = State();
    s.stats.draw_calls++;
    if (count > 0) {
        s.stats.triangles_submitted += static_cast<std::uint64_t>(count / 3);
    }
    if (!s.rasterize_enabled) {
        for (std::size_t i = 0; i < 64 * 64 * 4 && i < s.color_buffer.size(); i += 4) {
            s.color_buffer[i + 0] = 200;
            s.color_buffer[i + 1] = 180;
            s.color_buffer[i + 2] = 120;
            s.color_buffer[i + 3] = 255;
        }
        return;
    }
    if (mode != GL_TRIANGLES || first < 0 || count < 3 || s.array_buffer == 0) return;
    auto buf_it = s.buffers.find(s.array_buffer);
    if (buf_it == s.buffers.end()) return;
    const auto& raw = buf_it->second;
    const std::size_t total_verts = raw.size() / sizeof(GlesVertex);
    if (static_cast<std::size_t>(first + count) > total_verts) return;
    const auto* verts = reinterpret_cast<const GlesVertex*>(raw.data());

    const int vp_w = std::clamp(s.viewport[2], 1, 1024);
    const int vp_h = std::clamp(s.viewport[3], 1, 1024);
    const Texture2D* tex0 = nullptr;
    const Texture2D* tex1 = nullptr;
    if (auto it0 = s.textures.find(s.bound_textures[0]); it0 != s.textures.end()) tex0 = &it0->second;
    if (auto it1 = s.textures.find(s.bound_textures[1]); it1 != s.textures.end()) tex1 = &it1->second;

    const auto& m = s.u_view_proj;
    const auto& duv = s.u_diffuse_uv;
    const auto& luv = s.u_light_uv;
    const bool sky = s.u_sky_pass;

    auto make_clip_vert = [&](const GlesVertex& v) -> ClipVert {
        ClipVert cv{};
        const float px = v.position[0], py = v.position[1], pz = v.position[2];
        cv.cx = m[0] * px + m[4] * py + m[8]  * pz + m[12];
        cv.cy = m[1] * px + m[5] * py + m[9]  * pz + m[13];
        cv.cz = m[2] * px + m[6] * py + m[10] * pz + m[14];
        cv.cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
        if (sky) cv.cz = cv.cw * 0.99999f;
        cv.du = duv[0] * v.uv0[0] + duv[3] * v.uv0[1] + duv[6];
        cv.dv = duv[1] * v.uv0[0] + duv[4] * v.uv0[1] + duv[7];
        cv.lu = luv[0] * v.uv1[0] + luv[3] * v.uv1[1] + luv[6];
        cv.lv = luv[1] * v.uv1[0] + luv[4] * v.uv1[1] + luv[7];
        cv.r = v.color[0];
        cv.g = v.color[1];
        cv.b = v.color[2];
        cv.a = v.color[3];
        return cv;
    };

    ClipVert poly_a[12];
    ClipVert poly_b[12];
    for (GLint i = first; i + 2 < first + count; i += 3) {
        poly_a[0] = make_clip_vert(verts[i + 0]);
        poly_a[1] = make_clip_vert(verts[i + 1]);
        poly_a[2] = make_clip_vert(verts[i + 2]);

        // Trivial frustum reject if all 3 vertices are outside the same clip plane
        if (poly_a[0].cw < 0.2f && poly_a[1].cw < 0.2f && poly_a[2].cw < 0.2f) continue;
        if (poly_a[0].cx < -poly_a[0].cw && poly_a[1].cx < -poly_a[1].cw && poly_a[2].cx < -poly_a[2].cw) continue;
        if (poly_a[0].cx >  poly_a[0].cw && poly_a[1].cx >  poly_a[1].cw && poly_a[2].cx >  poly_a[2].cw) continue;
        if (poly_a[0].cy < -poly_a[0].cw && poly_a[1].cy < -poly_a[1].cw && poly_a[2].cy < -poly_a[2].cw) continue;
        if (poly_a[0].cy >  poly_a[0].cw && poly_a[1].cy >  poly_a[1].cw && poly_a[2].cy >  poly_a[2].cw) continue;
        if (poly_a[0].cz < -poly_a[0].cw && poly_a[1].cz < -poly_a[1].cw && poly_a[2].cz < -poly_a[2].cw) continue;
        if (poly_a[0].cz >  poly_a[0].cw && poly_a[1].cz >  poly_a[1].cw && poly_a[2].cz >  poly_a[2].cw) continue;

        int n = ClipPolygonAgainstPlane(poly_a, 3, poly_b, [](const ClipVert& v) { return v.cw - 0.2f; });
        if (n < 3) continue;
        n = ClipPolygonAgainstPlane(poly_b, n, poly_a, [](const ClipVert& v) { return v.cz + v.cw; });
        if (n < 3) continue;

        for (int k = 1; k + 1 < n; ++k) {
            RasterizeClippedTriangle(s, poly_a[0], poly_a[k], poly_a[k + 1], tex0, tex1, vp_w, vp_h);
        }
    }
}

void glDrawElements(GLenum mode, GLsizei count, GLenum, const void*) {
    glDrawArrays(mode, 0, count);
}

void glEnable(GLenum cap) { State().enabled[cap] = true; }
void glEnableVertexAttribArray(GLuint) {}
void glFramebufferRenderbuffer(GLenum, GLenum, GLenum, GLuint) {}
void glFramebufferTexture2D(GLenum, GLenum, GLenum, GLuint, GLint) {}
void glFrontFace(GLenum mode) { State().front_face = mode; }
void glGenBuffers(GLsizei n, GLuint* buffers) { AllocateIds(n, buffers); }
void glGenerateMipmap(GLenum) {}
void glGenFramebuffers(GLsizei n, GLuint* framebuffers) { AllocateIds(n, framebuffers); }
void glGenRenderbuffers(GLsizei n, GLuint* renderbuffers) { AllocateIds(n, renderbuffers); }
void glGenTextures(GLsizei n, GLuint* textures) { AllocateIds(n, textures); }
void glGenVertexArrays(GLsizei n, GLuint* arrays) { AllocateIds(n, arrays); }

void glGetBooleanv(GLenum pname, GLboolean* data) {
    if (!data) return;
    if (pname == GL_DEPTH_WRITEMASK) *data = State().depth_mask;
    else *data = GL_FALSE;
}

GLenum glGetError(void) { return GL_NO_ERROR; }

void glGetIntegerv(GLenum pname, GLint* data) {
    if (!data) return;
    const auto& s = State();
    switch (pname) {
        case GL_CURRENT_PROGRAM: *data = static_cast<GLint>(s.current_program); break;
        case GL_VERTEX_ARRAY_BINDING: *data = static_cast<GLint>(s.current_vao); break;
        case GL_ARRAY_BUFFER_BINDING: *data = static_cast<GLint>(s.array_buffer); break;
        case GL_ELEMENT_ARRAY_BUFFER_BINDING: *data = static_cast<GLint>(s.element_array_buffer); break;
        case GL_ACTIVE_TEXTURE: *data = static_cast<GLint>(s.active_texture); break;
        case GL_TEXTURE_BINDING_2D: *data = static_cast<GLint>(s.bound_texture_2d); break;
        case GL_CULL_FACE_MODE: *data = static_cast<GLint>(s.cull_face_mode); break;
        case GL_FRONT_FACE: *data = static_cast<GLint>(s.front_face); break;
        case GL_DEPTH_FUNC: *data = static_cast<GLint>(s.depth_func); break;
        case GL_BLEND_SRC_RGB: *data = static_cast<GLint>(s.blend_src_rgb); break;
        case GL_BLEND_DST_RGB: *data = static_cast<GLint>(s.blend_dst_rgb); break;
        case GL_BLEND_SRC_ALPHA: *data = static_cast<GLint>(s.blend_src_alpha); break;
        case GL_BLEND_DST_ALPHA: *data = static_cast<GLint>(s.blend_dst_alpha); break;
        case GL_BLEND_EQUATION_RGB: *data = static_cast<GLint>(s.blend_equation_rgb); break;
        case GL_BLEND_EQUATION_ALPHA: *data = static_cast<GLint>(s.blend_equation_alpha); break;
        case GL_UNPACK_ALIGNMENT: *data = s.unpack_alignment; break;
        case GL_PACK_ALIGNMENT: *data = s.pack_alignment; break;
        case GL_DRAW_FRAMEBUFFER_BINDING: *data = static_cast<GLint>(s.draw_fbo); break;
        case GL_READ_FRAMEBUFFER_BINDING: *data = static_cast<GLint>(s.read_fbo); break;
        case GL_RENDERBUFFER_BINDING: *data = static_cast<GLint>(s.current_rbo); break;
        case GL_MAX_SAMPLES: *data = 4; break;
        case GL_VIEWPORT:
            std::copy(s.viewport.begin(), s.viewport.end(), data);
            break;
        case GL_SCISSOR_BOX:
            std::copy(s.scissor.begin(), s.scissor.end(), data);
            break;
        default:
            *data = 0;
            break;
    }
}

void glGetProgramInfoLog(GLuint, GLsizei maxLength, GLsizei* length, GLchar* infoLog) {
    if (length) *length = 0;
    if (infoLog && maxLength > 0) infoLog[0] = '\0';
}

void glGetProgramiv(GLuint, GLenum pname, GLint* params) {
    if (params) *params = (pname == GL_LINK_STATUS) ? GL_TRUE : 0;
}

void glGetRenderbufferParameteriv(GLenum, GLenum pname, GLint* params) {
    if (params) *params = (pname == GL_RENDERBUFFER_SAMPLES) ? 4 : 0;
}

void glGetShaderInfoLog(GLuint, GLsizei maxLength, GLsizei* length, GLchar* infoLog) {
    if (length) *length = 0;
    if (infoLog && maxLength > 0) infoLog[0] = '\0';
}

void glGetShaderiv(GLuint, GLenum pname, GLint* params) {
    if (params) *params = (pname == GL_COMPILE_STATUS) ? GL_TRUE : 0;
}

const GLubyte* glGetString(GLenum) {
    return reinterpret_cast<const GLubyte*>("OpenGL ES 3.0 Headless-AgentPAL4");
}

GLint glGetUniformLocation(GLuint program, const GLchar* name) {
    if (!name) return -1;
    std::string_view sv(name);
    if (sv == "viewProjection") return 1;
    if (sv == "skyPass") return 2;
    if (sv == "materialColor") return 3;
    if (sv == "saturation") return 4;
    if (sv == "brightness") return 5;
    if (sv == "alphaCutoff") return 6;
    if (sv == "diffuseTransform") return 7;
    if (sv == "lightTransform") return 8;
    if (sv == "diffuseMap") return 9;
    if (sv == "lightMap") return 10;

    auto& map = State().uniform_locations[program];
    auto it = map.find(name);
    if (it != map.end()) return it->second;
    const GLint loc = State().next_uniform_loc++;
    map.emplace(name, loc);
    return loc;
}

GLboolean glIsEnabled(GLenum cap) {
    const auto& s = State();
    auto it = s.enabled.find(cap);
    return (it != s.enabled.end() && it->second) ? GL_TRUE : GL_FALSE;
}

void glLinkProgram(GLuint) {}

void glPixelStorei(GLenum pname, GLint param) {
    if (pname == GL_UNPACK_ALIGNMENT) State().unpack_alignment = param;
    else if (pname == GL_PACK_ALIGNMENT) State().pack_alignment = param;
}

void glReadPixels(GLint, GLint, GLsizei width, GLsizei height, GLenum, GLenum, void* pixels) {
    if (!pixels || width <= 0 || height <= 0) return;
    const std::size_t bytes = static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4;
    const auto& buf = State().color_buffer;
    std::memcpy(pixels, buf.data(), std::min(bytes, buf.size()));
}

void glRenderbufferStorage(GLenum, GLenum, GLsizei, GLsizei) {}
void glRenderbufferStorageMultisample(GLenum, GLsizei, GLenum, GLsizei, GLsizei) {}

void glScissor(GLint x, GLint y, GLsizei width, GLsizei height) {
    State().scissor = {x, y, width, height};
}

void glShaderSource(GLuint, GLsizei, const GLchar* const*, const GLint*) {}

void glTexImage2D(GLenum target, GLint level, GLint, GLsizei width, GLsizei height, GLint, GLenum, GLenum, const void* pixels) {
    auto& s = State();
    s.stats.textures_uploaded++;
    if (target == GL_TEXTURE_2D && level == 0 && s.bound_texture_2d != 0 && width > 0 && height > 0 && pixels != nullptr) {
        auto& tex = s.textures[s.bound_texture_2d];
        tex.width = width;
        tex.height = height;
        const std::size_t bytes = static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4;
        tex.rgba.resize(bytes);
        std::memcpy(tex.rgba.data(), pixels, bytes);
    }
}

void glTexParameteri(GLenum target, GLenum pname, GLint param) {
    auto& s = State();
    if (target == GL_TEXTURE_2D && s.bound_texture_2d != 0) {
        auto& tex = s.textures[s.bound_texture_2d];
        if (pname == GL_TEXTURE_WRAP_S) tex.wrap_s = static_cast<GLenum>(param);
        else if (pname == GL_TEXTURE_WRAP_T) tex.wrap_t = static_cast<GLenum>(param);
    }
}

void glUniform1f(GLint location, GLfloat v0) {
    auto& s = State();
    if (location == 5) s.u_brightness = v0;
    else if (location == 6) s.u_alpha_cutoff = v0;
}

void glUniform1i(GLint location, GLint v0) {
    if (location == 2) State().u_sky_pass = (v0 != 0);
}

void glUniform3f(GLint location, GLfloat v0, GLfloat v1, GLfloat v2) {
    if (location == 4) State().u_saturation = {v0, v1, v2};
}

void glUniform3fv(GLint location, GLsizei count, const GLfloat* value) {
    if (location == 4 && count >= 1 && value) {
        State().u_saturation = {value[0], value[1], value[2]};
    }
}

void glUniform4f(GLint location, GLfloat v0, GLfloat v1, GLfloat v2, GLfloat v3) {
    if (location == 3) State().u_material_color = {v0, v1, v2, v3};
}

void glUniform4fv(GLint location, GLsizei count, const GLfloat* value) {
    if (location == 3 && count >= 1 && value) {
        State().u_material_color = {value[0], value[1], value[2], value[3]};
    }
}

void glUniformMatrix3fv(GLint location, GLsizei count, GLboolean, const GLfloat* value) {
    if (count < 1 || !value) return;
    if (location == 7) std::copy_n(value, 9, State().u_diffuse_uv.begin());
    else if (location == 8) std::copy_n(value, 9, State().u_light_uv.begin());
}

void glUniformMatrix4fv(GLint location, GLsizei count, GLboolean, const GLfloat* value) {
    if (location == 1 && count >= 1 && value) {
        std::copy_n(value, 16, State().u_view_proj.begin());
    }
}

void glUseProgram(GLuint program) { State().current_program = program; }
void glVertexAttribPointer(GLuint, GLint, GLenum, GLboolean, GLsizei, const void*) {}

void glViewport(GLint x, GLint y, GLsizei width, GLsizei height) {
    State().viewport = {x, y, width, height};
}

AgentPal4GlesStats AgentPal4GetGlesStats(void) {
    return State().stats;
}

void AgentPal4SetRasterizeEnabled(bool enabled) {
    State().rasterize_enabled = enabled;
}

bool AgentPal4GetRasterizeEnabled(void) {
    return State().rasterize_enabled;
}

} // extern "C"
