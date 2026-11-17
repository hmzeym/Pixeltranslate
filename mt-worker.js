/* Pixel Translate: the offline translator. It runs in its own worker so the camera view and the subtitles stay smooth
   while the model thinks. The model is downloaded once, kept in the browser's storage, and then used without internet. */
let translator = null;
let queue = Promise.resolve();
const post = (m) => self.postMessage(m);

async function init(cfg) {
  const t0 = performance.now();
  try {
    const lib = await import(cfg.lib);
    const env = lib.env;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    try { env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false; } catch (e) { /* older build */ }
    translator = await lib.pipeline('translation', cfg.model, {
      dtype: cfg.dtype || 'q8',
      device: 'wasm',
      progress_callback: (p) => post({ type: 'progress', file: p.file || p.name || '', status: p.status || '', loaded: p.loaded || 0, total: p.total || 0 })
    });
    post({ type: 'ready', ms: Math.round(performance.now() - t0) });
  } catch (e) {
    post({ type: 'error', stage: 'init', message: String((e && e.message) || e) });
  }
}

async function run(id, text, cfg) {
  const t0 = performance.now();
  try {
    if (!translator) throw new Error('Çeviri motoru yüklenmedi');
    const maxNew = Math.max(24, Math.min(160, Math.round(String(text).length * 0.9) + 16));
    const out = await translator(text, { max_new_tokens: maxNew, num_beams: 1, do_sample: false });
    const first = Array.isArray(out) ? out[0] : out;
    const tr = first && (first.translation_text || first.generated_text);
    if (!tr) throw new Error('Çeviri boş döndü');
    post({ type: 'result', id, text: String(tr), ms: Math.round(performance.now() - t0) });
  } catch (e) {
    post({ type: 'fail', id, message: String((e && e.message) || e) });
  }
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'init') init(m);
  else if (m.type === 'translate') queue = queue.then(() => run(m.id, m.text, m));
};
