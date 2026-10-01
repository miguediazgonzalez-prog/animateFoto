/** Trabajo de render compartido: lo ejecuta el Worker (OffscreenCanvas) o, como respaldo, el hilo principal. */
import type { Pt } from '../ai/FaceLandmarks'
import { motionAt, type AnimationInstruction, type VisemeFrame } from '../ai/MotionPlanner'
import { WarpRenderer } from './WarpRenderer'
import { encodeVideo } from './VideoEncoder'
export interface RenderJob { src: ImageBitmap; lm: Pt[]; ins: AnimationInstruction; vis?: VisemeFrame[]; dur: number; fps: number; audio?: { mono: Float32Array; sampleRate: number } }
export function runJob(j: RenderJob, canvas: HTMLCanvasElement | OffscreenCanvas, onProgress: (p: number) => void) {
  const r = new WarpRenderer(canvas, j.src, j.lm)
  return encodeVideo(canvas, j.dur * j.fps, j.fps, i => r.render(motionAt(i / j.fps, j.ins, j.vis)), onProgress, j.audio)
}
