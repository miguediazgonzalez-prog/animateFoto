/** WebCodecs: H.264+AAC/MP4 si hay soporte; si no, VP9/VP8+Opus en WebM. Audio opcional intercalado frame a frame. */
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer'
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer'
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
export async function encodeVideo(canvas: HTMLCanvasElement | OffscreenCanvas, frames: number, fps: number, draw: (i: number) => void, onProgress: (p: number) => void, audio?: { mono: Float32Array; sampleRate: number }) {
  if (!('VideoEncoder' in globalThis)) throw new Error('Este navegador no soporta WebCodecs.')
  const w = canvas.width, h = canvas.height, bitrate = Math.round(w * h * fps * 0.5)
  const opts = [{ codec: 'avc1.640028', kind: 'mp4' }, { codec: 'vp09.00.10.08', kind: 'webm' }, { codec: 'vp8', kind: 'webm' }] as const
  let pick: (typeof opts)[number] | undefined
  for (const o of opts) if ((await VideoEncoder.isConfigSupported({ codec: o.codec, width: w, height: h, bitrate, framerate: fps })).supported) { pick = o; break }
  if (!pick) throw new Error('No hay códec de vídeo compatible en este dispositivo.')
  const mp4 = pick.kind === 'mp4'
  let ac: AudioEncoderConfig | undefined, mono: Float32Array | undefined
  if (audio && 'AudioEncoder' in globalThis) {
    const cfg = { codec: mp4 ? 'mp4a.40.2' : 'opus', sampleRate: audio.sampleRate, numberOfChannels: 1, bitrate: 96000 }
    if ((await AudioEncoder.isConfigSupported(cfg)).supported) {
      ac = cfg; mono = audio.mono
    }
  }
  const au = ac && { numberOfChannels: 1, sampleRate: audio!.sampleRate }
  const target = mp4 ? new Mp4Target() : new WebmTarget()
  const muxer: any = mp4
    ? new Mp4Muxer({ target: target as Mp4Target, video: { codec: 'avc', width: w, height: h }, audio: au && { codec: 'aac', ...au }, fastStart: 'in-memory' })
    : new WebmMuxer({ target: target as WebmTarget, video: { codec: pick.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: w, height: h, frameRate: fps }, audio: au && { codec: 'A_OPUS', ...au } })
  let err: unknown
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => (err = e) })
  enc.configure({ codec: pick.codec, width: w, height: h, bitrate, framerate: fps })
  const aenc = ac && new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => (err = e) })
  aenc?.configure(ac!)
  let cur = 0
  for (let i = 0; i < frames; i++) {
    if (err) throw err
    draw(i)
    const f = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps) }); enc.encode(f, { keyFrame: i % fps === 0 }); f.close()
    if (aenc && mono && audio) {
      const end = Math.min(mono.length, Math.round(((i + 1) * audio.sampleRate) / fps))
      if (end > cur) { const a = new AudioData({ format: 'f32-planar', sampleRate: audio.sampleRate, numberOfFrames: end - cur, numberOfChannels: 1, timestamp: Math.round((cur / audio.sampleRate) * 1e6), data: mono.slice(cur, end) }); aenc.encode(a); a.close(); cur = end }
    }
    while (enc.encodeQueueSize > 3) await wait(4)
    onProgress((i + 1) / frames); if (i % 3 === 0) await wait()
  }
  await enc.flush(); await aenc?.flush(); muxer.finalize(); enc.close(); aenc?.close()
  return { blob: new Blob([(target as { buffer: ArrayBuffer }).buffer], { type: mp4 ? 'video/mp4' : 'video/webm' }), ext: mp4 ? 'mp4' : 'webm', audio: !!ac }
}
