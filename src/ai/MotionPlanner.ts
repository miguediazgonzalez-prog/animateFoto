/** Texto en español -> AnimationInstruction (reglas) -> FacialMotion por instante (keyframes suaves + ruido sutil). */
export interface AnimationInstruction { duration: number; headMovement?: string; eyeMovement?: string; facialExpression?: string; mouthMovement?: string; speech?: string; emotion?: string; intensity?: number }
export interface FacialMotion { eyeBlinkLeft: number; eyeBlinkRight: number; eyeLookX: number; eyeLookY: number; mouthSmile: number; mouthOpen: number; eyebrowLeft: number; eyebrowRight: number; headYaw: number; headPitch: number; headRoll: number; mouthWidth: number; lipRound: number }
export interface VisemeFrame { time: number; mouthOpen: number; mouthWidth: number; lipRound: number }
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
export function parseInstruction(text: string, duration: number): AnimationInstruction {
  const s = norm(text), ex: string[] = []
  const ins: AnimationInstruction = { duration, headMovement: 'subtle', eyeMovement: 'camera', emotion: 'neutral', intensity: 0.65 }
  const sp = text.match(/\bdi(?:ga|ce|gan)?\b\s*:?\s*["“«]?(.+?)["”»]?\s*\.?$/i)
  if (sp) { ins.speech = sp[1].trim(); ins.mouthMovement = 'speech' }
  if (/sonr|saluda/.test(s)) ex.push('smile')
  if (/\bri(e|a|an)\b|risa|carcaj|riendo/.test(s)) ex.push('laugh')
  if (/guin/.test(s)) ex.push('wink')
  if (ex.length) { ins.facialExpression = ex.join('+'); ins.emotion = 'friendly' }
  // "izquierda/derecha" = lado de la pantalla tal como lo ve quien mira el vídeo
  const dir = /izquierda/.test(s) ? 'left' : /derecha/.test(s) ? 'right' : 'camera'
  ins.eyeMovement = dir !== 'camera' && /despues|luego|vuelva|vuelve|otra vez/.test(s) ? dir + '>camera' : dir
  if (/mucho|muy |enorme|grande/.test(s)) ins.intensity = 0.9
  else if (/ligera|suave|poco/.test(s)) ins.intensity = 0.45
  return ins
}
const ss = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x) }
export function motionAt(t: number, ins: AnimationInstruction, vis?: VisemeFrame[]): FacialMotion {
  const d = ins.duration, k = ins.intensity ?? 0.65, ex = ins.facialExpression ?? '', em = ins.eyeMovement ?? 'camera'
  const pulse = (t0: number, u: number, h: number, dn: number) => ss(t0, t0 + u, t) * (1 - ss(t0 + u + h, t0 + u + h + dn, t))
  const laugh = ex.includes('laugh'), smile = (ex.includes('smile') || laugh) ? Math.min(1, k * ss(0.2 * d, 0.4 * d, t) * (laugh ? 1.15 : 1)) : 0
  const lAmp = laugh ? ss(0.3 * d, 0.4 * d, t) * (1 - ss(0.85 * d, 0.95 * d, t)) : 0, lw = 0.55 + 0.45 * Math.sin(t * 6 * Math.PI)
  const nb = Math.max(0, ...[2.0, 4.4, 6.9, 9.2].filter(x => x < d - 0.5).map(x => pulse(x, 0.07, 0.02, 0.09)))
  const wink = ex.includes('wink') ? 0.95 * pulse(0.45 * d, 0.12, 0.25, 0.15) : 0
  const tgt = em.startsWith('left') ? -1 : em.startsWith('right') ? 1 : 0
  const lx = tgt * ss(0.15 * d, 0.3 * d, t) * (em.includes('>') ? 1 - ss(0.55 * d, 0.7 * d, t) : 1)
  let v = { mouthOpen: 0, mouthWidth: 0.5, lipRound: 0 }
  if (vis?.length) { const dt = vis.length > 1 ? vis[1].time - vis[0].time : 1 / 24; if (t >= vis[0].time - dt) v = vis[Math.min(vis.length - 1, Math.max(0, Math.round((t - vis[0].time) / dt)))] }
  return {
    eyeBlinkLeft: nb, eyeBlinkRight: Math.max(nb, wink),
    eyeLookX: lx + 0.02 * Math.sin(t * 3.1), eyeLookY: 0.02 * Math.sin(t * 2.3 + 1),
    mouthSmile: smile, mouthOpen: Math.max(0.3 * k * lAmp * lw, v.mouthOpen), mouthWidth: v.mouthWidth, lipRound: v.lipRound, eyebrowLeft: smile * 0.25, eyebrowRight: smile * 0.25,
    headYaw: lx * 0.8 + 0.03 * Math.sin(t * 0.9) + 0.02 * Math.sin(t * 2.3 + 1),
    headPitch: 0.025 * Math.sin(t * 1.1 + 0.5) + 0.25 * lAmp * Math.sin(t * 6 * Math.PI),
    headRoll: 0.012 * Math.sin(t * 0.7 + 2)
  }
}
