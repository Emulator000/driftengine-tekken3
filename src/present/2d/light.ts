/**
 * Light added to and taken away from the finished picture, as the console's GPU blends its
 * semi-transparent primitives: a quad's colour added to what is under it (B + F) or taken away
 * from it (B − F), each channel held between black and white, where an ordinary sprite only lays
 * its colour over by its alpha. The scenes draw with it what the original adds or takes away: the
 * character select's columns of light, its portraits faded in and out (added, then taken away
 * through a white palette, so a slice crossfades into a bright background), its silhouette.
 *
 * A quad is laid in the original's screen units (as `ScreenLayer` lays them, 480 lines down the
 * middle 4:3 of the window; or the fight's, given as its middle and its units across), its colour shaded from its top edge to its bottom one as the GPU
 * shades a quad from its vertices, and textured or not: a picture of its own atlas multiplied by
 * the colour, or (`mask`) the colour wherever the picture has ink. `over` lays a picture as an
 * ordinary sprite does, for the slices the original draws plainly between faded ones.
 *
 * It is drawn over the finished picture and its colours are display values that go down as they
 * are, so they add and take away in the display's encoding, as they did in the console's
 * framebuffer. Its pictures are painted into an atlas of its own, which only it draws from, a
 * texture a tile of it.
 */
import { SCENE_ALPHA_KEEPS, type PassContext, type PassDefinition, type PassDevice, type RendererApi } from '@driftengine/core';
import type { SpriteRegion, UvRect } from '@driftengine/ui2d';
import { PaintAtlas, type AtlasPicture } from './atlas.ts';

export type LightBlend = 'add' | 'subtract' | 'over';
export type Rgb = readonly [number, number, number];
/** Where a quad's texels are: its atlas tile's slot and the rectangle in it. */
export type Texels = Pick<AtlasPicture, 'slot' | 'uv'>;

/** A quad as it was laid: kept a frame, so the frame can be drawn again fading out. */
export interface DrawnLight {
  readonly blend: LightBlend;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly top: Rgb;
  readonly bottom: Rgb;
  readonly texels: Texels | null;
  readonly mask: boolean;
  readonly alpha: number;
}

const BLENDS: readonly LightBlend[] = ['over', 'add', 'subtract'];
/** Floats a vertex: position, uv, colour, then whether it is textured (0 no, 1 the picture, 2 its ink) and its alpha. */
const FLOATS = 9;
const STRIDE = FLOATS * 4;
const CAPACITY = 1024;
/** Ints a run: its blend (an index), its tile's slot (-1 none yet: untextured quads draw with any), first vertex, vertex count. */
const RUN = 4;
const MIDDLE = 184;
const LINES = 480;
const ACROSS = 276;

/** A layer's screen units: x at the window's middle, and the units across a 4:3 picture's height. */
export interface LightUnits {
  readonly middle: number;
  readonly across: number;
}

const GLSL_VERTEX = `#version 300 es
layout(location = 0) in vec4 aPositionUv;
layout(location = 1) in vec4 aColourKind;
layout(location = 2) in float aAlpha;
uniform vec4 uToNdc;
out vec2 vUv;
out vec3 vColour;
flat out float vKind;
out float vAlpha;
void main() {
  vUv = aPositionUv.zw;
  vColour = aColourKind.xyz;
  vKind = aColourKind.w;
  vAlpha = aAlpha;
  gl_Position = vec4(aPositionUv.x * uToNdc.x + uToNdc.y, aPositionUv.y * uToNdc.z + uToNdc.w, 0.0, 1.0);
}`;

const GLSL_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPicture;
uniform int uOver;
in vec2 vUv;
in vec3 vColour;
flat in float vKind;
in float vAlpha;
out vec4 fragColour;
void main() {
  vec4 texel = vKind > 0.5 ? texture(uPicture, vUv) : vec4(1.0);
  vec3 colour = vKind > 1.5 ? vColour : texel.rgb * vColour;
  float cover = texel.a * vAlpha;
  fragColour = uOver == 1 ? vec4(colour * cover, cover) : vec4(colour * cover, 0.0);
}`;

const WGSL = /* wgsl */ `
struct Frame { toNdc: vec4f, over: vec4f };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var picture: texture_2d<f32>;
@group(0) @binding(2) var pictureSampler: sampler;

struct Vertex {
  @location(0) positionUv: vec4f,
  @location(1) colourKind: vec4f,
  @location(2) alpha: f32,
};

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) colour: vec3f,
  @location(2) @interpolate(flat) kind: f32,
  @location(3) alpha: f32,
};

@vertex fn vertexMain(v: Vertex) -> Varyings {
  var out: Varyings;
  let p = v.positionUv;
  out.position = vec4f(p.x * frame.toNdc.x + frame.toNdc.y, p.y * frame.toNdc.z + frame.toNdc.w, 0.5, 1.0);
  out.uv = p.zw;
  out.colour = v.colourKind.xyz;
  out.kind = v.colourKind.w;
  out.alpha = v.alpha;
  return out;
}

@fragment fn fragmentMain(f: Varyings) -> @location(0) vec4f {
  let sampled = textureSample(picture, pictureSampler, f.uv);
  let texel = select(vec4f(1.0), sampled, f.kind > 0.5);
  let colour = select(texel.rgb * f.colour, f.colour, f.kind > 1.5);
  let cover = texel.a * f.alpha;
  if (frame.over.x > 0.5) { return vec4f(colour * cover, cover); }
  return vec4f(colour * cover, 0.0);
}
`;

const GPU_BLENDS: Record<LightBlend, GPUBlendComponent> = {
  over: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  add: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  subtract: { srcFactor: 'one', dstFactor: 'one', operation: 'reverse-subtract' },
};

interface GlState {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly buffer: WebGLBuffer;
  /** A white texel, for runs with no picture; and each tile's texture, by slot. */
  readonly white: WebGLTexture;
  readonly textures: Map<number, WebGLTexture>;
  /** Each tile texture's width and height, so a rectangle goes into a texture of its canvas's size. */
  readonly sizes: Map<number, readonly [number, number]>;
  readonly toNdc: WebGLUniformLocation | null;
  readonly picture: WebGLUniformLocation | null;
  readonly over: WebGLUniformLocation | null;
}

/** A texture and its bind groups, one a blend. */
interface GpuPicture {
  readonly texture: GPUTexture;
  readonly groups: readonly GPUBindGroup[];
}

interface GpuState {
  readonly device: GPUDevice;
  readonly module: GPUShaderModule;
  readonly groupLayout: GPUBindGroupLayout;
  readonly layout: GPUPipelineLayout;
  readonly vertices: GPUBuffer;
  /** One uniform block a blend, so each run reads its own. */
  readonly uniforms: readonly GPUBuffer[];
  readonly sampler: GPUSampler;
  /** A white texel, for runs with no picture; and each tile's texture, by slot. */
  readonly white: GpuPicture;
  readonly pictures: Map<number, GpuPicture>;
  readonly pipelines: Map<string, GPURenderPipeline>;
}

const PICTURE_UNIT = 6;

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`light layer: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

/** A texture sampled linearly and clamped, bound to the picture's unit (which is left active). */
function glTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + PICTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export class LightLayer implements PassDefinition {
  readonly label: string;
  private readonly renderer: RendererApi;
  private readonly handle: number;
  private readonly vertices = new Float32Array(CAPACITY * 6 * FLOATS);
  private count = 0;
  private readonly runs = new Int32Array(CAPACITY * RUN);
  private runCount = 0;
  private readonly toNdc = new Float32Array(4);
  /** Each blend's uniform block: the mapping, then whether it lays its colour over. */
  private readonly blocks = BLENDS.map((blend) => new Float32Array([0, 0, 0, 0, blend === 'over' ? 1 : 0, 0, 0, 0]));
  private quads: DrawnLight[] = [];
  /** The lines quads are cut to, top and bottom, or none. */
  private clipping: readonly [number, number] | null = null;
  /** Its pictures, painted at the display's resolution (`kx`, `ky` device pixels a unit across and down). */
  readonly atlas: PaintAtlas;
  kx = 1;
  ky = 1;
  /**
   * The atlas's tiles painted since they went up, by slot, to be copied into their textures as the
   * quads are drawn: the rectangle painted, or null for the whole tile.
   */
  private readonly fresh = new Map<number, { source: OffscreenCanvas; region: SpriteRegion | null }>();
  private gl: GlState | null = null;
  private gpu: GpuState | null = null;
  /** The window's width and height in device pixels. */
  private width = 1;
  private lines = 0;
  private readonly middle: number;
  private readonly across: number;

  constructor(renderer: RendererApi, label: string, units: LightUnits = { middle: MIDDLE, across: ACROSS }) {
    this.label = label;
    this.renderer = renderer;
    this.middle = units.middle;
    this.across = units.across;
    this.handle = renderer.registerPass(this);
    this.atlas = new PaintAtlas([this]);
  }

  /**
   * A field's quads begun, for a window `width` by `height` device pixels, with `keep` while quads
   * laid frames ago are still laid again (a dissolve's frame before); true when the atlas was
   * emptied (a new height).
   */
  begin(width: number, height: number, keep = false): boolean {
    this.width = width;
    this.atlas.keep = keep;
    let emptied = false;
    if (height !== this.lines) {
      this.lines = height;
      this.kx = height / this.across;
      this.ky = height / LINES;
      this.atlas.clear();
      emptied = true;
    }
    const half = (this.across / 2) * (width / height);
    this.toNdc.set([1 / half, -this.middle / half, -2 / LINES, 1]);
    this.count = 0;
    this.runCount = 0;
    this.quads = [];
    this.clipping = null;
    return emptied;
  }

  /** Quads laid from now on cut to the lines from `top` to `bottom`, or not cut (null). */
  clip(top: number | null, bottom = 0): void {
    this.clipping = top === null ? null : [top, bottom];
  }

  /** The quads laid since the frame began (taken before the next begins, they are the last frame's). */
  get drawn(): readonly DrawnLight[] {
    return this.quads;
  }

  /** A tile of the atlas, painted: copied into its slot's texture as the quads are drawn (`AtlasPass`; the options are its own). */
  setTexture(slot: number, source: OffscreenCanvas): void {
    this.fresh.set(slot, { source, region: null });
  }

  /** A rectangle painted in a tile already sent: copied alone, joined with any other waiting for it. */
  updateTexture(slot: number, source: OffscreenCanvas, region: SpriteRegion): void {
    const waiting = this.fresh.get(slot);
    if (waiting !== undefined && waiting.region === null) return;
    const r = waiting?.region;
    const joined =
      r === undefined || r === null
        ? region
        : (() => {
            const x = Math.min(r.x, region.x);
            const y = Math.min(r.y, region.y);
            return { x, y, width: Math.max(r.x + r.width, region.x + region.width) - x, height: Math.max(r.y + r.height, region.y + region.height) - y };
          })();
    this.fresh.set(slot, { source, region: joined });
  }

  /**
   * A quad from (`x`, `y`) `w` by `h` units, its colour shaded from `top` to `bottom` (0 to 1 a
   * channel, as the GPU's 0 to 255 over 255; a picture's texels are multiplied by it as by 128 at
   * 1), the picture's `texels` (or none), `mask` taking the colour where the picture has ink, at
   * `alpha`.
   */
  quad(blend: LightBlend, x: number, y: number, w: number, h: number, top: Rgb, bottom: Rgb, texels: Texels | null = null, mask = false, alpha = 1): void {
    if (CAPACITY * 6 < this.count + 6) return;
    if (this.clipping !== null) {
      /* Cut to the lines, its colour and its picture's rows cut with it. */
      const [from, to] = this.clipping;
      const start = Math.max(y, from);
      const end = Math.min(y + h, to);
      if (end <= start) return;
      const at = (line: number): number => (line - y) / h;
      const shade = (t: number): Rgb => [top[0] + (bottom[0] - top[0]) * t, top[1] + (bottom[1] - top[1]) * t, top[2] + (bottom[2] - top[2]) * t];
      const cut = (uv: UvRect): UvRect => ({ u0: uv.u0, u1: uv.u1, v0: uv.v0 + (uv.v1 - uv.v0) * at(start), v1: uv.v0 + (uv.v1 - uv.v0) * at(end) });
      [top, bottom, texels] = [shade(at(start)), shade(at(end)), texels && { slot: texels.slot, uv: cut(texels.uv) }];
      [y, h] = [start, end - start];
    }
    this.quads.push({ blend, x, y, w, h, top, bottom, texels, mask, alpha });
    /* On the window's whole pixels across, as the layers place their pictures. */
    const px = Math.round(this.width / 2 + (x - this.middle) * this.kx);
    const left = this.middle + (px - this.width / 2) / this.kx;
    const kind = texels === null ? 0 : mask ? 2 : 1;
    const { u0, v0, u1, v1 } = texels?.uv ?? { u0: 0, v0: 0, u1: 0, v1: 0 };
    const corners = [
      [left, y, u0, v0, top],
      [left + w, y, u1, v0, top],
      [left, y + h, u0, v1, bottom],
      [left + w, y, u1, v0, top],
      [left + w, y + h, u1, v1, bottom],
      [left, y + h, u0, v1, bottom],
    ] as const;
    const first = this.count;
    for (const [cx, cy, cu, cv, colour] of corners) {
      this.vertices.set([cx, cy, cu, cv, colour[0], colour[1], colour[2], kind, alpha], this.count * FLOATS);
      this.count += 1;
    }
    /* A run goes on while the blend and the tile do; a quad with no picture goes with any tile. */
    const index = BLENDS.indexOf(blend);
    const slot = texels?.slot ?? -1;
    const last = (this.runCount - 1) * RUN;
    const runSlot = this.runs[last + 1]!;
    if (0 < this.runCount && this.runs[last] === index && (slot === -1 || runSlot === -1 || runSlot === slot)) {
      if (slot !== -1) this.runs[last + 1] = slot;
      this.runs[last + 3] = this.runs[last + 3]! + 6;
    } else {
      this.runs.set([index, slot, first, 6], this.runCount * RUN);
      this.runCount += 1;
    }
  }

  /** Quads a frame laid, laid again at `alpha` of their own (a dissolve's frame before). */
  redraw(quads: readonly DrawnLight[], alpha: number): void {
    for (const q of quads) this.quad(q.blend, q.x, q.y, q.w, q.h, q.top, q.bottom, q.texels, q.mask, q.alpha * alpha);
  }

  /** The field's quads drawn over the finished picture. */
  end(): void {
    this.atlas.upload();
    this.renderer.drawPass(this.handle);
  }

  init(device: PassDevice): void {
    if (device.backend === 'webgl2') this.gl = this.initGl(device.gl);
    else this.gpu = this.initGpu(device.device);
  }

  private initGl(gl: WebGL2RenderingContext): GlState {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, GLSL_VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, GLSL_FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`light layer: ${gl.getProgramInfoLog(program)}`);
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, 16);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 32);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const white = glTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return { program, vao, buffer, white, textures: new Map(), sizes: new Map(), toNdc: gl.getUniformLocation(program, 'uToNdc'), picture: gl.getUniformLocation(program, 'uPicture'), over: gl.getUniformLocation(program, 'uOver') };
  }

  private initGpu(device: GPUDevice): GpuState {
    const module = device.createShaderModule({ label: this.label, code: WGSL });
    const groupLayout = device.createBindGroupLayout({
      label: this.label,
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const vertices = device.createBuffer({ label: `${this.label}.vertices`, size: this.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const uniforms = BLENDS.map((blend) => device.createBuffer({ label: `${this.label}.${blend}`, size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const layout = device.createPipelineLayout({ label: this.label, bindGroupLayouts: [groupLayout] });
    const white = this.gpuPicture(device, groupLayout, uniforms, sampler, 1, 1);
    device.queue.writeTexture({ texture: white.texture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    return { device, module, groupLayout, layout, vertices, uniforms, sampler, white, pictures: new Map(), pipelines: new Map() };
  }

  /** A texture `width` by `height` and its bind groups. */
  private gpuPicture(device: GPUDevice, layout: GPUBindGroupLayout, uniforms: readonly GPUBuffer[], sampler: GPUSampler, width: number, height: number): GpuPicture {
    const texture = device.createTexture({
      label: `${this.label}.picture`,
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const view = texture.createView();
    const groups = uniforms.map((buffer) =>
      device.createBindGroup({
        label: this.label,
        layout,
        entries: [
          { binding: 0, resource: { buffer } },
          { binding: 1, resource: view },
          { binding: 2, resource: sampler },
        ],
      }),
    );
    return { texture, groups };
  }

  /** A pipeline for the pass this draw lands in and the blend, built once each. */
  private pipeline(gpu: GpuState, format: GPUTextureFormat, depthFormat: GPUTextureFormat, samples: number, blend: LightBlend): GPURenderPipeline {
    const key = `${format}/${depthFormat}/${samples}/${blend}`;
    const found = gpu.pipelines.get(key);
    if (found) return found;
    const pipeline = gpu.device.createRenderPipeline({
      label: `${this.label}:${key}`,
      layout: gpu.layout,
      vertex: {
        module: gpu.module,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: STRIDE,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x4' },
              { shaderLocation: 1, offset: 16, format: 'float32x4' },
              { shaderLocation: 2, offset: 32, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: gpu.module,
        entryPoint: 'fragmentMain',
        /* The picture's alpha is left as it is: light lands on it, it is not part of its surface. */
        targets: [{ format, blend: { color: GPU_BLENDS[blend], alpha: SCENE_ALPHA_KEEPS } }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      multisample: { count: samples },
      depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
    });
    gpu.pipelines.set(key, pipeline);
    return pipeline;
  }

  draw(ctx: PassContext): void {
    if (this.count === 0) return;
    if (ctx.backend === 'webgl2') this.drawGl(ctx.gl);
    else if (this.gpu) this.drawGpu(this.gpu, ctx.pass, ctx.format, ctx.depthFormat, ctx.samples);
  }

  private drawGl(gl: WebGL2RenderingContext): void {
    const state = this.gl;
    if (state === null) return;
    if (0 < this.fresh.size) {
      const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
      const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.activeTexture(gl.TEXTURE0 + PICTURE_UNIT);
      for (const [slot, { source, region }] of this.fresh) {
        const held = state.textures.get(slot);
        const texture = held ?? glTexture(gl);
        state.textures.set(slot, texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const size = state.sizes.get(slot);
        if (region === null || held === undefined || size === undefined || size[0] !== source.width || size[1] !== source.height) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
          state.sizes.set(slot, [source.width, source.height]);
          continue;
        }
        /* The rectangle alone, picked out of the canvas by the unpack state, which every upload after reads too. */
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, source.width);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, region.x);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, region.y);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, region.x, region.y, region.width, region.height, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
      this.fresh.clear();
    }
    gl.activeTexture(gl.TEXTURE0 + PICTURE_UNIT);
    gl.useProgram(state.program);
    gl.bindVertexArray(state.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices, 0, this.count * FLOATS);
    gl.uniform4fv(state.toNdc, this.toNdc);
    gl.uniform1i(state.picture, PICTURE_UNIT);
    const blendWas = gl.getParameter(gl.BLEND) as boolean;
    const depthTestWas = gl.getParameter(gl.DEPTH_TEST) as boolean;
    const depthMaskWas = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
    const cullWas = gl.getParameter(gl.CULL_FACE) as boolean;
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    for (let run = 0; run < this.runCount; run += 1) {
      const at = run * RUN;
      const blend = BLENDS[this.runs[at]!]!;
      gl.bindTexture(gl.TEXTURE_2D, state.textures.get(this.runs[at + 1]!) ?? state.white);
      gl.uniform1i(state.over, blend === 'over' ? 1 : 0);
      gl.blendEquationSeparate(blend === 'subtract' ? gl.FUNC_REVERSE_SUBTRACT : gl.FUNC_ADD, gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.ONE, blend === 'over' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE, gl.ZERO, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, this.runs[at + 2]!, this.runs[at + 3]!);
    }
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.depthMask(depthMaskWas);
    if (cullWas) gl.enable(gl.CULL_FACE);
    if (depthTestWas) gl.enable(gl.DEPTH_TEST);
    if (!blendWas) gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
  }

  private drawGpu(gpu: GpuState, pass: GPURenderPassEncoder, format: GPUTextureFormat, depthFormat: GPUTextureFormat, samples: number): void {
    const queue = gpu.device.queue;
    for (const [slot, { source, region }] of this.fresh) {
      let picture = gpu.pictures.get(slot);
      if (picture === undefined || picture.texture.width !== source.width || picture.texture.height !== source.height) {
        picture?.texture.destroy();
        picture = this.gpuPicture(gpu.device, gpu.groupLayout, gpu.uniforms, gpu.sampler, source.width, source.height);
        gpu.pictures.set(slot, picture);
        queue.copyExternalImageToTexture({ source, flipY: false }, { texture: picture.texture }, [source.width, source.height]);
      } else if (region === null) {
        queue.copyExternalImageToTexture({ source, flipY: false }, { texture: picture.texture }, [source.width, source.height]);
      } else {
        /* The rectangle alone, landing where it was in the canvas. */
        const origin = [region.x, region.y];
        queue.copyExternalImageToTexture({ source, origin, flipY: false }, { texture: picture.texture, origin }, [region.width, region.height]);
      }
    }
    this.fresh.clear();
    queue.writeBuffer(gpu.vertices, 0, this.vertices, 0, this.count * FLOATS);
    this.blocks.forEach((block, i) => {
      block.set(this.toNdc);
      queue.writeBuffer(gpu.uniforms[i]!, 0, block);
    });
    pass.setVertexBuffer(0, gpu.vertices);
    for (let run = 0; run < this.runCount; run += 1) {
      const at = run * RUN;
      const index = this.runs[at]!;
      pass.setPipeline(this.pipeline(gpu, format, depthFormat, samples, BLENDS[index]!));
      pass.setBindGroup(0, (gpu.pictures.get(this.runs[at + 1]!) ?? gpu.white).groups[index]!);
      pass.draw(this.runs[at + 3]!, 1, this.runs[at + 2]!, 0);
    }
  }

  dispose(device: PassDevice): void {
    if (this.gpu) {
      this.gpu.vertices.destroy();
      for (const buffer of this.gpu.uniforms) buffer.destroy();
      this.gpu.white.texture.destroy();
      for (const picture of this.gpu.pictures.values()) picture.texture.destroy();
      this.gpu = null;
    }
    if (this.gl && device.backend === 'webgl2') {
      device.gl.deleteProgram(this.gl.program);
      device.gl.deleteVertexArray(this.gl.vao);
      device.gl.deleteBuffer(this.gl.buffer);
      device.gl.deleteTexture(this.gl.white);
      for (const texture of this.gl.textures.values()) device.gl.deleteTexture(texture);
    }
    this.gl = null;
  }
}

/** A ramp across, black at its left and white at its right, for light shaded across. */
function rampAcross(light: LightLayer, reversed: boolean): Texels | null {
  const picture = light.atlas.picture(`ramp across ${reversed}`, 64, 4, (g, left, top) => {
    const gradient = g.createLinearGradient(left, 0, left + 64, 0);
    gradient.addColorStop(0, reversed ? '#ffffff' : '#000000');
    gradient.addColorStop(1, reversed ? '#000000' : '#ffffff');
    g.fillStyle = gradient;
    g.fillRect(left, top, 64, 4);
  });
  if (picture === null) return null;
  const { u0, u1, v0, v1 } = picture.uv;
  return { slot: picture.slot, uv: { u0: u0 + (u1 - u0) / 128, u1: u1 - (u1 - u0) / 128, v0: (v0 + v1) / 2, v1: (v0 + v1) / 2 } };
}

/** Light added or taken away over a rectangle, shaded across from none on one side to `level` on the other. */
export function lightAcross(light: LightLayer, blend: 'add' | 'subtract', x: number, y: number, w: number, h: number, colour: Rgb, fullAtRight: boolean): void {
  const texels = rampAcross(light, !fullAtRight);
  if (texels === null) return;
  const half: Rgb = [colour[0] / 2, colour[1] / 2, colour[2] / 2];
  light.quad(blend, x, y, w, h, half, half, texels);
}
