<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted } from 'vue'
import { detectCaps, type Caps } from './ai/Capabilities'
import DebugPanel from './components/DebugPanel.vue'
import { modelStatus, clearLocalData } from './ai/ModelManager'
import { clampCrop, resetCrop, rotateCrop, drawCrop, sideOf } from './components/cropper'
import { detect, getDelegate } from './ai/FaceLandmarks'
import { parseInstruction, type VisemeFrame } from './ai/MotionPlanner'
import { startRecording, decodeAudio, audioVisemes, textVisemes, speakPreview, toMono } from './audio/SpeechEngine'
import { renderVideo } from './rendering/renderClient'
const tiers = { fast: { s: 512, fps: 24, d: 5, label: 'Rápido · 512 px · 5 s' }, balanced: { s: 768, fps: 24, d: 7, label: 'Normal · 768 px · 7 s' }, quality: { s: 1024, fps: 30, d: 10, label: 'Alta · 1024 px · 10 s' } }
const tier = ref<keyof typeof tiers>('fast'), prompt = ref('')
const bitmap = ref<ImageBitmap | null>(null), photoUrl = ref(''), videoUrl = ref(''), out = ref<{ blob: Blob; ext: string; audio: boolean } | null>(null)
const recording = ref(false), voiceBuf = ref<AudioBuffer | null>(null), voiceUrl = ref(''), speechText = ref(''), hasAudio = ref(false)
let rec: Awaited<ReturnType<typeof startRecording>> | null = null, aud: HTMLAudioElement | null = null
const busy = ref(false), status = ref(''), pct = ref(0), canShare = !!navigator.share
const debug = new URLSearchParams(location.search).has('debug')
const caps = ref<Caps | null>(null), modelMb = ref<number | null>(null), mode = ref('')
const capsLine = computed(() => { const c = caps.value; return c ? `Modo recomendado: ${tiers[c.tier].label}. ${c.cores} núcleos${c.memory ? ` · ~${c.memory} GB` : ''} · WebGPU ${c.webgpu ? 'disponible' : 'no disponible'} · SIMD ${c.simd ? 'sí' : 'no'}` : '' })
const modelLine = computed(() => (modelMb.value ? `Modelo descargado: ${modelMb.value.toFixed(0)} MB · disponible offline` : 'El modelo facial se descargará la primera vez.'))
onMounted(() => { detectCaps().then(c => { caps.value = c; tier.value = c.tier; if (!c.ok) status.value = c.problems.join(' ') }); modelStatus().then(v => (modelMb.value = v)) })
async function wipe() { if (!confirm('Se borrará el modelo descargado y la foto actual. ¿Continuar?')) return; clear(); clearVoice(); await clearLocalData(); modelMb.value = null; mode.value = ''; status.value = 'Datos locales borrados.' }
const crop = reactive({ zoom: 1, cx: 0, cy: 0, rot: 0 }), cv = ref<HTMLCanvasElement | null>(null)
const pts = new Map<number, { x: number; y: number }>(); let pinch0 = 1, zoom0 = 1
const gap = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1 }
function down(e: PointerEvent) { cv.value?.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { pinch0 = gap(); zoom0 = crop.zoom } }
function move(e: PointerEvent) {
  const p = pts.get(e.pointerId), bm = bitmap.value; if (!p || !bm || !cv.value) return
  if (pts.size === 1) { const u = sideOf(bm, crop) / cv.value.clientWidth; crop.cx -= (e.clientX - p.x) * u; crop.cy -= (e.clientY - p.y) * u }
  p.x = e.clientX; p.y = e.clientY
  if (pts.size === 2) crop.zoom = (zoom0 * gap()) / pinch0
}
const up = (e: PointerEvent) => { pts.delete(e.pointerId) }
watch(() => [crop.zoom, crop.cx, crop.cy, crop.rot, bitmap.value, videoUrl.value], () => { const bm = bitmap.value; if (!bm) return; clampCrop(bm, crop); if (cv.value) drawCrop(bm, crop, 512, cv.value) }, { flush: 'post' })
async function pick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return
  try { bitmap.value = await createImageBitmap(f); clear(false); resetCrop(bitmap.value, crop); photoUrl.value = URL.createObjectURL(f); status.value = '' }
  catch { status.value = 'Este navegador no puede abrir ese formato (¿HEIC?). Prueba con JPG, PNG o WebP.' }
}
async function toggleRec() {
  if (!recording.value) { try { rec = await startRecording(); recording.value = true; status.value = 'Grabando… toca de nuevo para parar.' } catch { status.value = 'No tengo permiso para usar el micrófono.' } return }
  recording.value = false; const b = await rec!.stop(); rec = null
  try { voiceBuf.value = await decodeAudio(b); voiceUrl.value = URL.createObjectURL(b); aud = null; status.value = `Voz grabada (${voiceBuf.value.duration.toFixed(1)} s).` + (voiceBuf.value.duration > 9.2 ? ' Se recortará a 10 s.' : '') }
  catch { status.value = 'No pude leer la grabación.' }
}
function clearVoice() { voiceBuf.value = null; if (voiceUrl.value) URL.revokeObjectURL(voiceUrl.value); voiceUrl.value = ''; aud = null }
function onPlay(e: Event) {
  if (hasAudio.value) return
  if (voiceUrl.value) { aud ??= new Audio(voiceUrl.value); aud.currentTime = (e.target as HTMLVideoElement).currentTime; aud.play() }
  else if (speechText.value) setTimeout(() => speakPreview(speechText.value), 500)
}
function onPause() { aud?.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel() }
function clear(all = true) { if (videoUrl.value) URL.revokeObjectURL(videoUrl.value); videoUrl.value = ''; out.value = null; pct.value = 0; if (all) { if (photoUrl.value) URL.revokeObjectURL(photoUrl.value); photoUrl.value = ''; bitmap.value = null; status.value = '' } }
async function generate() {
  const bm = bitmap.value; if (!bm || busy.value) return
  busy.value = true; clear(false)
  try {
    const T = tiers[tier.value], src = drawCrop(bm, crop, T.s)
    status.value = 'Analizando rostro…'; await new Promise(r => setTimeout(r, 30))
    const L = await detect(src); if (!L) throw new Error('No detecto ningún rostro. Usa una foto frontal y bien iluminada.')
    const buf = voiceBuf.value, dur = buf ? Math.min(10, Math.max(T.d, Math.ceil(buf.duration + 0.8))) : T.d
    const ins = parseInstruction(prompt.value, dur); let vis: VisemeFrame[] | undefined; speechText.value = ''
    if (buf) vis = audioVisemes(buf, T.fps, dur)
    else if (ins.speech) { speechText.value = ins.speech; vis = textVisemes(ins.speech, T.fps, dur) }
    const audio = buf ? { mono: toMono(buf), sampleRate: buf.sampleRate } : undefined
    status.value = 'Renderizando vídeo…'
    const res = await renderVideo({ src: await createImageBitmap(src), lm: L, ins, vis, dur, fps: T.fps, audio }, p => (pct.value = Math.round(p * 100)))
    out.value = res.out; mode.value = `En uso: detector ${getDelegate()} · render ${res.where === 'worker' ? 'en worker' : 'en hilo principal'} · ${res.out.ext.toUpperCase()}`
    modelStatus().then(v => (modelMb.value = v))
    hasAudio.value = out.value.audio; videoUrl.value = URL.createObjectURL(out.value.blob)
    status.value = buf ? (hasAudio.value ? 'Listo, con tu voz.' : 'Listo. Este dispositivo no mezcla audio en el vídeo: tu voz suena aparte en la vista previa y el archivo sale sin audio.')
      : ins.speech ? 'Listo. La voz del texto solo suena en la vista previa (el navegador no deja capturarla): el archivo sale sin audio. Para llevar voz en el archivo, graba la tuya.' : 'Listo.'
  } catch (e) { status.value = e instanceof Error ? e.message : String(e) } finally { busy.value = false }
}
const fname = () => `foto-animada.${out.value!.ext}`
function save() { const a = document.createElement('a'); a.href = videoUrl.value; a.download = fname(); a.click() }
const share = () => navigator.share({ files: [new File([out.value!.blob], fname(), { type: out.value!.blob.type })] }).catch(() => {})
</script>
<template>
  <main>
    <h1>✨ Foto animada</h1>
    <div class="badge">🟢 Procesamiento en el dispositivo. Tu fotografía no se sube a ningún servidor.</div>
    <div v-if="caps" class="badge">{{ capsLine }}</div>
    <div class="badge">{{ modelLine }}</div>
    <div v-if="mode" class="badge">{{ mode }}</div>
    <div class="frame">
      <video v-if="videoUrl" :src="videoUrl" controls playsinline :loop="!speechText && !voiceUrl" :autoplay="!hasAudio" :muted="!hasAudio" @play="onPlay" @pause="onPause" />
      <canvas v-else-if="bitmap" ref="cv" width="512" height="512" aria-label="Encuadre de la fotografía" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" />
      <label v-else class="empty">📷<input type="file" accept="image/*,.heic" hidden @change="pick" /></label>
    </div>
    <div class="row">
      <label class="btn">Elegir fotografía<input type="file" accept="image/*,.heic" hidden @change="pick" /></label>
      <button v-if="photoUrl" @click="clear()">Quitar</button>
      <button v-if="videoUrl" @click="clear(false)">Ajustar encuadre</button>
    </div>
    <div v-if="bitmap && !videoUrl" class="row"><input type="range" min="1" max="5" step="0.05" v-model.number="crop.zoom" aria-label="Zoom" /><button @click="rotateCrop(bitmap, crop)">↻ Girar</button></div>
    <label>¿Qué quieres que haga?
      <textarea v-model="prompt" placeholder="Que sonría, mire a la cámara y parpadee…" style="width:100%" /></label>
    <div class="row"><button :disabled="busy" @click="toggleRec">{{ recording ? '⏹ Parar' : '🎙 Grabar mi voz' }}</button><button v-if="voiceBuf" @click="clearVoice">Quitar voz</button></div>
    <select v-model="tier"><option v-for="(t, k) in tiers" :key="k" :value="k">{{ t.label }}</option></select>
    <button class="go" :disabled="!bitmap || busy || !!(caps && !caps.ok)" @click="generate">{{ busy ? 'Animando…' : 'Animar' }}</button>
    <div v-if="busy" class="bar"><i :style="{ width: pct + '%' }" /></div>
    <div class="st" role="status">{{ status }}</div>
    <div v-if="videoUrl" class="row"><button :disabled="busy" @click="generate">Volver a generar</button><button @click="save">Guardar</button><button v-if="canShare" @click="share">Compartir</button></div>
    <DebugPanel v-if="debug && bitmap" :bitmap="bitmap" :crop="crop" :prompt="prompt" />
    <button class="lnk" @click="wipe">Borrar datos locales</button>
  </main>
</template>
