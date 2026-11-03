cmake_minimum_required(VERSION 3.20)
project(agent_pal4 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(AGENT_PAL4_HEADLESS_GLES "Use built-in headless GLES3 state/raster shim" ON)
option(PAL4_MODERN_GAMEPAD "Enable modern analog vector movement in ChapterHost" ON)
set(PAL4_ENABLE_GLES ON CACHE BOOL "Enable GLES3 renderer and ChapterHost targets" FORCE)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    add_compile_options(-Wno-inconsistent-missing-override)
endif()

if(AGENT_PAL4_HEADLESS_GLES OR NOT EMSCRIPTEN)
    add_library(GLESv2 STATIC src/headless_gles3.cpp)
    target_include_directories(GLESv2 PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
    include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)
endif()

enable_testing()
add_subdirectory(/Volumes/T7-Data/pal/OpenPAL4/fresh/ports/runtime ${CMAKE_CURRENT_BINARY_DIR}/openpal4_runtime)

add_executable(agent-pal4-host src/agent_pal4_host.cpp)
target_link_libraries(agent-pal4-host PRIVATE pal4_portable_chapter_host pal4_portable_combat pal4_portable_battle)

add_executable(pal4_chapter_host_monster_scene_integration_tests
    /Volumes/T7-Data/pal/OpenPAL4/fresh/ports/runtime/tests/chapter_host_monster_scene_integration_tests.cpp)
target_link_libraries(pal4_chapter_host_monster_scene_integration_tests PRIVATE pal4_portable_chapter_host)
add_test(NAME pal4_chapter_host_monster_scene_integration_contract
    COMMAND pal4_chapter_host_monster_scene_integration_tests)
add_test(NAME agent_pal4_headless_bench
    COMMAND node ${CMAKE_CURRENT_SOURCE_DIR}/test/run-headless-bench.mjs $<TARGET_FILE:agent-pal4-host>)

if(EMSCRIPTEN)
    target_link_options(agent-pal4-host PRIVATE
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=134217728
        -sSTACK_SIZE=5242880
        -sEXPORTED_FUNCTIONS=['_main','_agent_pal4_init','_agent_pal4_rpc']
        -sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','FS']
    )
    if(NOT AGENT_PAL4_HEADLESS_GLES)
        target_link_options(agent-pal4-host PRIVATE
            -sMAX_WEBGL_VERSION=2
            -sMIN_WEBGL_VERSION=2
            -sFULL_ES3=1
            -lworkerfs.js
        )
    endif()
endif()
