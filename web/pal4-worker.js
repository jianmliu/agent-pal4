// Web Worker hosting OpenPAL4 Wasm runtime + WORKERFS zero-copy local .cpk mounting
let wasmModule = null;

async function ensureWasmLoaded() {
  if (wasmModule) return wasmModule;
  try {
    const createModule = (await import('./agent-pal4-host.js')).default;
    wasmModule = await createModule({
      noInitialRun: true,
    });
    wasmModule.ccall('agent_pal4_init', null, ['string'], ['/work']);
    return wasmModule;
  } catch (err) {
    return null;
  }
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'mount_local_cpk') {
    const mod = await ensureWasmLoaded();
    if (mod && mod.FS && mod.WORKERFS) {
      try {
        mod.FS.mkdir('/gamedata');
      } catch (_) {}
      mod.FS.mount(mod.WORKERFS, { files: msg.files }, '/gamedata');
    }
    self.postMessage({
      ok: true,
      event: 'workerfs_mounted',
      files_count: msg.files ? msg.files.length : 0,
      note: 'Local .cpk files mounted at /gamedata via Emscripten WORKERFS (0-byte server upload)',
    });
    return;
  }

  if (msg.type === 'rpc') {
    const mod = await ensureWasmLoaded();
    if (mod) {
      const raw = mod.ccall('agent_pal4_rpc', 'string', ['string'], [JSON.stringify(msg.payload)]);
      self.postMessage(JSON.parse(raw));
    } else {
      self.postMessage({
        ok: true,
        mode: 'web_worker_stub',
        request: msg.payload,
        hint: 'Build with emcmake cmake -DAGENT_PAL4_HEADLESS_GLES=OFF to produce agent-pal4-host.wasm',
      });
    }
  }
};
