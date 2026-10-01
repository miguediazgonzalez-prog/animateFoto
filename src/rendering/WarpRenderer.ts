/** Deformación de malla 96x96 en WebGL2: la foto es la textura; cada frame desplaza vértices según FacialMotion. */
import type { Pt } from '../ai/FaceLandmarks'
import type { FacialMotion } from '../ai/MotionPlanner'
const N = 96
const g = (d: number, r: number) => Math.exp(-((d / r) ** 2))
export class WarpRenderer {
  private gl: WebGL2RenderingContext; private base: Float32Array; private cur: Float32Array
  private buf: WebGLBuffer; private n: number; private fs: number
  private mp!: WebGLProgram; private mvao!: WebGLVertexArrayObject; private ip!: WebGLProgram; private ivao!: WebGLVertexArrayObject; private ie!: WebGLUniformLocation
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, src: ImageBitmap, private L: Pt[]) {
    const S = (canvas.width = canvas.height = src.width)
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2', { antialias: true }); if (!gl) throw new Error('WebGL2 no disponible')
    this.gl = gl; this.fs = Math.hypot(L[234].x - L[454].x, L[234].y - L[454].y)
    const V = (N + 1) * (N + 1); this.base = new Float32Array(V * 2); this.cur = new Float32Array(V * 2)
    const uv = new Float32Array(V * 2), idx = new Uint32Array(N * N * 6); let q = 0
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const k = (j * (N + 1) + i) * 2; this.base[k] = (i / N) * S; this.base[k + 1] = (j / N) * S; uv[k] = i / N; uv[k + 1] = j / N }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.set([a, c, b, b, c, d], q); q += 6 }
    this.n = idx.length
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); return o }
    const pr = gl.createProgram()!
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, `#version 300 es
in vec2 p; in vec2 uv; uniform float S; out vec2 v; void main(){v=uv; gl_Position=vec4(p.x/S*2.-1.,1.-p.y/S*2.,0.,1.);}`))
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, `#version 300 es
precision mediump float; in vec2 v; uniform sampler2D t; out vec4 o; void main(){o=texture(t,v);}`))
    gl.linkProgram(pr); gl.useProgram(pr); gl.uniform1f(gl.getUniformLocation(pr, 'S'), S); this.mp = pr
    this.mvao = gl.createVertexArray()!; gl.bindVertexArray(this.mvao)
    this.buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, this.base, gl.DYNAMIC_DRAW)
    const lp = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0)
    const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW)
    const lu = gl.getAttribLocation(pr, 'uv'); gl.enableVertexAttribArray(lu); gl.vertexAttribPointer(lu, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // Interior de la boca: elipse oscura y suave que tapa el hueco entre labios al abrir (sin dientes inventados).
    const ip = (this.ip = gl.createProgram()!)
    gl.attachShader(ip, sh(gl.VERTEX_SHADER, `#version 300 es
uniform float S; out vec2 px; void main(){vec2 q=vec2(float(gl_VertexID&1),float(gl_VertexID>>1)); px=vec2(q.x,1.-q.y)*S; gl_Position=vec4(q*2.-1.,0.,1.);}`))
    gl.attachShader(ip, sh(gl.FRAGMENT_SHADER, `#version 300 es
precision mediump float; in vec2 px; uniform vec4 e; out vec4 o; void main(){float d=length((px-e.xy)/e.zw); o=vec4(.17,.06,.08,.92*(1.-smoothstep(.75,1.,d)));}`))
    gl.linkProgram(ip); gl.useProgram(ip); gl.uniform1f(gl.getUniformLocation(ip, 'S'), S); this.ie = gl.getUniformLocation(ip, 'e')!
    this.ivao = gl.createVertexArray()!
    gl.useProgram(pr); gl.bindVertexArray(this.mvao)
    gl.viewport(0, 0, S, S)
  }
  render(m: FacialMotion) {
    const { L, fs, base, cur, gl } = this, c = L[1], cs = Math.cos(m.headRoll), sn = Math.sin(m.headRoll)
    const eyes = [{ o: L[33], i: L[133], u: L[159], d: L[145], ir: L[468], b: m.eyeBlinkRight }, { o: L[263], i: L[362], u: L[386], d: L[374], ir: L[473], b: m.eyeBlinkLeft }]
      .map(e => ({ ...e, cx: (e.o.x + e.i.x) / 2, cy: (e.u.y + e.d.y) / 2, w: Math.hypot(e.o.x - e.i.x, e.o.y - e.i.y) }))
    const brows = [{ p: L[105], v: m.eyebrowRight }, { p: L[334], v: m.eyebrowLeft }], mc = [L[61], L[291]], lip = L[14], mid = L[13]
    for (let k = 0; k < cur.length; k += 2) {
      const x = base[k], y = base[k + 1]; let X = x, Y = y
      for (const e of eyes) {
        if (e.b > 0 && y < e.cy) Y += (e.cy - y) * Math.min(0.92, e.b) * g(x - e.cx, e.w * 0.6) * g(e.cy - y, e.w * 0.45)
        const w = g(Math.hypot(x - e.ir.x, y - e.ir.y), e.w * 0.26); X += m.eyeLookX * e.w * 0.13 * w; Y += m.eyeLookY * e.w * 0.1 * w
      }
      for (const b of brows) Y -= b.v * fs * 0.03 * g(Math.hypot(x - b.p.x, y - b.p.y), fs * 0.13)
      mc.forEach((p, i) => { const w = g(Math.hypot(x - p.x, y - p.y), fs * 0.13); Y -= m.mouthSmile * fs * 0.05 * w; X += (i ? 1 : -1) * (m.mouthSmile * 0.025 + (m.mouthWidth - 0.5) * 0.05 - m.lipRound * 0.03) * fs * w })
      if (y > mid.y) Y += m.mouthOpen * fs * 0.09 * g(Math.hypot(x - lip.x, y - lip.y), fs * 0.13)
      const dx = X - c.x, dy = Y - c.y, w = Math.exp(-((Math.hypot(x - c.x, y - c.y) / (fs * 1.15)) ** 4))
      X += (c.x + dx * cs - dy * sn - X) * w + m.headYaw * fs * 0.09 * w
      Y += (c.y + dx * sn + dy * cs - Y) * w + m.headPitch * fs * 0.05 * w
      cur[k] = X; cur[k + 1] = Y
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, cur)
    gl.clear(gl.COLOR_BUFFER_BIT); gl.drawElements(gl.TRIANGLES, this.n, gl.UNSIGNED_INT, 0)
    const gap = m.mouthOpen * fs * 0.09
    if (gap > 1.5) {
      gl.useProgram(this.ip); gl.bindVertexArray(this.ivao); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      const dz = Math.max(0, lip.y - mid.y)
      gl.uniform4f(this.ie, lip.x, (mid.y + lip.y + gap) / 2, Math.hypot(L[78].x - L[308].x, L[78].y - L[308].y) * 0.42 * (1 - m.lipRound * 0.35), (gap + dz) / 2 + fs * 0.012)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.disable(gl.BLEND); gl.useProgram(this.mp); gl.bindVertexArray(this.mvao)
    }
  }
}
