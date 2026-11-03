#include "GLES3/gl3.h"
#include <algorithm>
#include <array>
#include <cstring>
#include <map>
#include <string>
#include <vector>

namespace {
struct HeadlessGlState {
    GLuint next_id{1};
    GLuint current_program{0};
    GLuint current_vao{0};
    GLuint array_buffer{0};
    GLuint element_array_buffer{0};
    GLuint active_texture{GL_TEXTURE0};
    GLuint bound_texture_2d{0};
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
    GLint next_uniform_loc{1};
    std::vector<std::uint8_t> color_buffer = std::vector<std::uint8_t>(1024 * 1024 * 4, 0);
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
void glBindTexture(GLenum, GLuint texture) { State().bound_texture_2d = texture; }
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

void glBufferData(GLenum, GLsizeiptr, const void*, GLenum) {
    State().stats.buffers_uploaded++;
}

void glBufferSubData(GLenum, GLintptr, GLsizeiptr, const void*) {
    State().stats.buffers_uploaded++;
}

GLenum glCheckFramebufferStatus(GLenum) { return GL_FRAMEBUFFER_COMPLETE; }

void glClear(GLbitfield mask) {
    auto& s = State();
    if (mask & GL_COLOR_BUFFER_BIT) {
        const std::uint8_t r = static_cast<std::uint8_t>(std::clamp(s.clear_color[0], 0.f, 1.f) * 255.f);
        const std::uint8_t g = static_cast<std::uint8_t>(std::clamp(s.clear_color[1], 0.f, 1.f) * 255.f);
        const std::uint8_t b = static_cast<std::uint8_t>(std::clamp(s.clear_color[2], 0.f, 1.f) * 255.f);
        const std::uint8_t a = static_cast<std::uint8_t>(std::clamp(s.clear_color[3], 0.f, 1.f) * 255.f);
        for (std::size_t i = 0; i < s.color_buffer.size(); i += 4) {
            s.color_buffer[i + 0] = r;
            s.color_buffer[i + 1] = g;
            s.color_buffer[i + 2] = b;
            s.color_buffer[i + 3] = a;
        }
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
void glDeleteBuffers(GLsizei, const GLuint*) {}
void glDeleteFramebuffers(GLsizei, const GLuint*) {}
void glDeleteProgram(GLuint) {}
void glDeleteRenderbuffers(GLsizei, const GLuint*) {}
void glDeleteShader(GLuint) {}
void glDeleteTextures(GLsizei, const GLuint*) {}
void glDeleteVertexArrays(GLsizei, const GLuint*) {}
void glDepthFunc(GLenum func) { State().depth_func = func; }
void glDepthMask(GLboolean flag) { State().depth_mask = flag; }
void glDisable(GLenum cap) { State().enabled[cap] = false; }

void glDrawArrays(GLenum, GLint, GLsizei count) {
    auto& s = State();
    s.stats.draw_calls++;
    if (count > 0) {
        s.stats.triangles_submitted += static_cast<std::uint64_t>(count / 3);
    }
    for (std::size_t i = 0; i < 64 * 64 * 4 && i < s.color_buffer.size(); i += 4) {
        s.color_buffer[i + 0] = 200;
        s.color_buffer[i + 1] = 180;
        s.color_buffer[i + 2] = 120;
        s.color_buffer[i + 3] = 255;
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

void glTexImage2D(GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, const void*) {
    State().stats.textures_uploaded++;
}

void glTexParameteri(GLenum, GLenum, GLint) {}
void glUniform1f(GLint, GLfloat) {}
void glUniform1i(GLint, GLint) {}
void glUniform3f(GLint, GLfloat, GLfloat, GLfloat) {}
void glUniform3fv(GLint, GLsizei, const GLfloat*) {}
void glUniform4f(GLint, GLfloat, GLfloat, GLfloat, GLfloat) {}
void glUniform4fv(GLint, GLsizei, const GLfloat*) {}
void glUniformMatrix3fv(GLint, GLsizei, GLboolean, const GLfloat*) {}
void glUniformMatrix4fv(GLint, GLsizei, GLboolean, const GLfloat*) {}
void glUseProgram(GLuint program) { State().current_program = program; }
void glVertexAttribPointer(GLuint, GLint, GLenum, GLboolean, GLsizei, const void*) {}

void glViewport(GLint x, GLint y, GLsizei width, GLsizei height) {
    State().viewport = {x, y, width, height};
}

AgentPal4GlesStats AgentPal4GetGlesStats(void) {
    return State().stats;
}

} // extern "C"
