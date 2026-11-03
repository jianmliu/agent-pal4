#pragma once
#include <cstddef>
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

using GLboolean = unsigned char;
using GLubyte = unsigned char;
using GLchar = char;
using GLenum = unsigned int;
using GLint = int;
using GLsizei = int;
using GLuint = unsigned int;
using GLfloat = float;
using GLbitfield = unsigned int;
using GLintptr = std::ptrdiff_t;
using GLsizeiptr = std::ptrdiff_t;

constexpr GLboolean GL_FALSE = 0;
constexpr GLboolean GL_TRUE = 1;

constexpr GLenum GL_ZERO = 0;
constexpr GLenum GL_ONE = 1;
constexpr GLenum GL_NO_ERROR = 0;
constexpr GLbitfield GL_DEPTH_BUFFER_BIT = 0x00000100;
constexpr GLbitfield GL_COLOR_BUFFER_BIT = 0x00004000;

constexpr GLenum GL_TRIANGLES = 0x0004;
constexpr GLenum GL_LEQUAL = 0x0203;
constexpr GLenum GL_GREATER = 0x0204;
constexpr GLenum GL_SRC_COLOR = 0x0300;
constexpr GLenum GL_ONE_MINUS_SRC_COLOR = 0x0301;
constexpr GLenum GL_SRC_ALPHA = 0x0302;
constexpr GLenum GL_ONE_MINUS_SRC_ALPHA = 0x0303;
constexpr GLenum GL_DST_ALPHA = 0x0304;
constexpr GLenum GL_ONE_MINUS_DST_ALPHA = 0x0305;
constexpr GLenum GL_DST_COLOR = 0x0306;
constexpr GLenum GL_ONE_MINUS_DST_COLOR = 0x0307;
constexpr GLenum GL_FRONT = 0x0404;
constexpr GLenum GL_BACK = 0x0405;
constexpr GLenum GL_CW = 0x0900;
constexpr GLenum GL_CCW = 0x0901;

constexpr GLenum GL_CULL_FACE = 0x0B44;
constexpr GLenum GL_CULL_FACE_MODE = 0x0B45;
constexpr GLenum GL_FRONT_FACE = 0x0B46;
constexpr GLenum GL_DEPTH_TEST = 0x0B71;
constexpr GLenum GL_DEPTH_WRITEMASK = 0x0B72;
constexpr GLenum GL_DEPTH_FUNC = 0x0B74;
constexpr GLenum GL_VIEWPORT = 0x0BA2;
constexpr GLenum GL_BLEND = 0x0BE2;
constexpr GLenum GL_SCISSOR_BOX = 0x0C10;
constexpr GLenum GL_SCISSOR_TEST = 0x0C11;
constexpr GLenum GL_UNPACK_ALIGNMENT = 0x0CF5;
constexpr GLenum GL_PACK_ALIGNMENT = 0x0D05;
constexpr GLenum GL_TEXTURE_2D = 0x0DE1;

constexpr GLenum GL_UNSIGNED_BYTE = 0x1401;
constexpr GLenum GL_UNSIGNED_INT = 0x1405;
constexpr GLenum GL_FLOAT = 0x1406;
constexpr GLenum GL_RGBA = 0x1908;
constexpr GLenum GL_VERSION = 0x1F02;
constexpr GLenum GL_NEAREST = 0x2600;
constexpr GLenum GL_LINEAR = 0x2601;
constexpr GLenum GL_LINEAR_MIPMAP_LINEAR = 0x2703;
constexpr GLenum GL_TEXTURE_MAG_FILTER = 0x2800;
constexpr GLenum GL_TEXTURE_MIN_FILTER = 0x2801;
constexpr GLenum GL_TEXTURE_WRAP_S = 0x2802;
constexpr GLenum GL_TEXTURE_WRAP_T = 0x2803;
constexpr GLenum GL_REPEAT = 0x2901;

constexpr GLenum GL_FUNC_ADD = 0x8006;
constexpr GLenum GL_BLEND_EQUATION_RGB = 0x8009;
constexpr GLenum GL_FUNC_SUBTRACT = 0x800A;
constexpr GLenum GL_FUNC_REVERSE_SUBTRACT = 0x800B;
constexpr GLenum GL_RGBA8 = 0x8058;
constexpr GLenum GL_TEXTURE_BINDING_2D = 0x8069;
constexpr GLenum GL_BLEND_DST_RGB = 0x80C8;
constexpr GLenum GL_BLEND_SRC_RGB = 0x80C9;
constexpr GLenum GL_BLEND_DST_ALPHA = 0x80CA;
constexpr GLenum GL_BLEND_SRC_ALPHA = 0x80CB;
constexpr GLenum GL_CLAMP_TO_EDGE = 0x812F;
constexpr GLenum GL_DEPTH_COMPONENT24 = 0x81A6;
constexpr GLenum GL_TEXTURE0 = 0x84C0;
constexpr GLenum GL_TEXTURE1 = 0x84C1;
constexpr GLenum GL_ACTIVE_TEXTURE = 0x84E0;
constexpr GLenum GL_VERTEX_ARRAY_BINDING = 0x85B5;
constexpr GLenum GL_BLEND_EQUATION_ALPHA = 0x883D;
constexpr GLenum GL_ARRAY_BUFFER = 0x8892;
constexpr GLenum GL_ELEMENT_ARRAY_BUFFER = 0x8893;
constexpr GLenum GL_ARRAY_BUFFER_BINDING = 0x8894;
constexpr GLenum GL_ELEMENT_ARRAY_BUFFER_BINDING = 0x8895;
constexpr GLenum GL_STATIC_DRAW = 0x88E4;
constexpr GLenum GL_DYNAMIC_DRAW = 0x88E8;

constexpr GLenum GL_FRAGMENT_SHADER = 0x8B30;
constexpr GLenum GL_VERTEX_SHADER = 0x8B31;
constexpr GLenum GL_COMPILE_STATUS = 0x8B81;
constexpr GLenum GL_LINK_STATUS = 0x8B82;
constexpr GLenum GL_CURRENT_PROGRAM = 0x8B8D;

constexpr GLenum GL_READ_FRAMEBUFFER = 0x8CA8;
constexpr GLenum GL_DRAW_FRAMEBUFFER = 0x8CA9;
constexpr GLenum GL_READ_FRAMEBUFFER_BINDING = 0x8CAA;
constexpr GLenum GL_DRAW_FRAMEBUFFER_BINDING = 0x8CA6;
constexpr GLenum GL_FRAMEBUFFER_BINDING = 0x8CA6;
constexpr GLenum GL_RENDERBUFFER_BINDING = 0x8CA7;
constexpr GLenum GL_RENDERBUFFER_SAMPLES = 0x8CAB;
constexpr GLenum GL_COLOR_ATTACHMENT0 = 0x8CE0;
constexpr GLenum GL_DEPTH_ATTACHMENT = 0x8D00;
constexpr GLenum GL_FRAMEBUFFER_COMPLETE = 0x8CD5;
constexpr GLenum GL_FRAMEBUFFER = 0x8D40;
constexpr GLenum GL_RENDERBUFFER = 0x8D41;
constexpr GLenum GL_MAX_SAMPLES = 0x8D57;

void glActiveTexture(GLenum texture);
void glAttachShader(GLuint program, GLuint shader);
void glBindAttribLocation(GLuint program, GLuint index, const GLchar* name);
void glBindBuffer(GLenum target, GLuint buffer);
void glBindFramebuffer(GLenum target, GLuint framebuffer);
void glBindRenderbuffer(GLenum target, GLuint renderbuffer);
void glBindTexture(GLenum target, GLuint texture);
void glBindVertexArray(GLuint array);
void glBlendEquation(GLenum mode);
void glBlendEquationSeparate(GLenum modeRGB, GLenum modeAlpha);
void glBlendFunc(GLenum sfactor, GLenum dfactor);
void glBlendFuncSeparate(GLenum sfactorRGB, GLenum dfactorRGB, GLenum sfactorAlpha, GLenum dfactorAlpha);
void glBlitFramebuffer(GLint srcX0, GLint srcY0, GLint srcX1, GLint srcY1,
                       GLint dstX0, GLint dstY0, GLint dstX1, GLint dstY1,
                       GLbitfield mask, GLenum filter);
void glBufferData(GLenum target, GLsizeiptr size, const void* data, GLenum usage);
void glBufferSubData(GLenum target, GLintptr offset, GLsizeiptr size, const void* data);
GLenum glCheckFramebufferStatus(GLenum target);
void glClear(GLbitfield mask);
void glClearColor(GLfloat red, GLfloat green, GLfloat blue, GLfloat alpha);
void glClearDepthf(GLfloat d);
void glCompileShader(GLuint shader);
GLuint glCreateProgram(void);
GLuint glCreateShader(GLenum type);
void glCullFace(GLenum mode);
void glDeleteBuffers(GLsizei n, const GLuint* buffers);
void glDeleteFramebuffers(GLsizei n, const GLuint* framebuffers);
void glDeleteProgram(GLuint program);
void glDeleteRenderbuffers(GLsizei n, const GLuint* renderbuffers);
void glDeleteShader(GLuint shader);
void glDeleteTextures(GLsizei n, const GLuint* textures);
void glDeleteVertexArrays(GLsizei n, const GLuint* arrays);
void glDepthFunc(GLenum func);
void glDepthMask(GLboolean flag);
void glDisable(GLenum cap);
void glDrawArrays(GLenum mode, GLint first, GLsizei count);
void glDrawElements(GLenum mode, GLsizei count, GLenum type, const void* indices);
void glEnable(GLenum cap);
void glEnableVertexAttribArray(GLuint index);
void glFramebufferRenderbuffer(GLenum target, GLenum attachment, GLenum renderbuffertarget, GLuint renderbuffer);
void glFramebufferTexture2D(GLenum target, GLenum attachment, GLenum textarget, GLuint texture, GLint level);
void glFrontFace(GLenum mode);
void glGenBuffers(GLsizei n, GLuint* buffers);
void glGenerateMipmap(GLenum target);
void glGenFramebuffers(GLsizei n, GLuint* framebuffers);
void glGenRenderbuffers(GLsizei n, GLuint* renderbuffers);
void glGenTextures(GLsizei n, GLuint* textures);
void glGenVertexArrays(GLsizei n, GLuint* arrays);
void glGetBooleanv(GLenum pname, GLboolean* data);
GLenum glGetError(void);
void glGetIntegerv(GLenum pname, GLint* data);
void glGetProgramInfoLog(GLuint program, GLsizei maxLength, GLsizei* length, GLchar* infoLog);
void glGetProgramiv(GLuint program, GLenum pname, GLint* params);
void glGetRenderbufferParameteriv(GLenum target, GLenum pname, GLint* params);
void glGetShaderInfoLog(GLuint shader, GLsizei maxLength, GLsizei* length, GLchar* infoLog);
void glGetShaderiv(GLuint shader, GLenum pname, GLint* params);
const GLubyte* glGetString(GLenum name);
GLint glGetUniformLocation(GLuint program, const GLchar* name);
GLboolean glIsEnabled(GLenum cap);
void glLinkProgram(GLuint program);
void glPixelStorei(GLenum pname, GLint param);
void glReadPixels(GLint x, GLint y, GLsizei width, GLsizei height, GLenum format, GLenum type, void* pixels);
void glRenderbufferStorage(GLenum target, GLenum internalformat, GLsizei width, GLsizei height);
void glRenderbufferStorageMultisample(GLenum target, GLsizei samples, GLenum internalformat, GLsizei width, GLsizei height);
void glScissor(GLint x, GLint y, GLsizei width, GLsizei height);
void glShaderSource(GLuint shader, GLsizei count, const GLchar* const* string, const GLint* length);
void glTexImage2D(GLenum target, GLint level, GLint internalformat, GLsizei width, GLsizei height,
                  GLint border, GLenum format, GLenum type, const void* pixels);
void glTexParameteri(GLenum target, GLenum pname, GLint param);
void glUniform1f(GLint location, GLfloat v0);
void glUniform1i(GLint location, GLint v0);
void glUniform3f(GLint location, GLfloat v0, GLfloat v1, GLfloat v2);
void glUniform3fv(GLint location, GLsizei count, const GLfloat* value);
void glUniform4f(GLint location, GLfloat v0, GLfloat v1, GLfloat v2, GLfloat v3);
void glUniform4fv(GLint location, GLsizei count, const GLfloat* value);
void glUniformMatrix3fv(GLint location, GLsizei count, GLboolean transpose, const GLfloat* value);
void glUniformMatrix4fv(GLint location, GLsizei count, GLboolean transpose, const GLfloat* value);
void glUseProgram(GLuint program);
void glVertexAttribPointer(GLuint index, GLint size, GLenum type, GLboolean normalized, GLsizei stride, const void* pointer);
void glViewport(GLint x, GLint y, GLsizei width, GLsizei height);

struct AgentPal4GlesStats {
    std::uint64_t draw_calls;
    std::uint64_t triangles_submitted;
    std::uint64_t textures_uploaded;
    std::uint64_t buffers_uploaded;
};
AgentPal4GlesStats AgentPal4GetGlesStats(void);

#ifdef __cplusplus
}
#endif
