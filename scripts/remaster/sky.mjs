/**
 * A stage's sky as a panorama: the air by single scattering (Nishita et al.), cumulus clouds by ray
 * marching seeded noise, lit by the fight's sun. Columns are the turn (azimuth atan2(x, z) from 0
 * to 2π), rows the elevation from E1 down to E0 degrees. Deterministic: the same picture on every
 * machine for the same settings.
 *
 * node scripts/remaster/sky.mjs '{"out":"public/assets/remaster/sky/10.png","sun":[-0.4,0.8,0.45],"seed":10}'
 * (`mie` the haze, `coverage` the clouds' share of the sky, `exposure` the picture's brightness)
 * writes the atmosphere to `out`, and beside it the clouds over it, their colour and cover (`.clouds.png`).
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Where the picture's tone starts nearing white. */
const KNEE = 0.75;
let WIDTH = 3072;
let HEIGHT = 1024;
const E0 = -12;
const E1 = 90;

/* ---- noise ---- */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const r = rng(seed);
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i += 1) p[i] = base[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => {
    const k = h & 15;
    const u = k < 8 ? x : y;
    const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
    return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
  };
  /** Gradient noise, about -1 to 1. */
  return (x, y, z) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    const l = (a, b, t) => a + t * (b - a);
    return l(
      l(l(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), l(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      l(l(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), l(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    );
  };
}

/* ---- the air ---- */
/* The earth and the air's top, metres from its middle; the air's two kinds as Bruneton and Neyret give them: their scattering at sea level a metre and the height they thin by e. */
const EARTH = 6360e3;
const AIR = 6420e3;
const RAYLEIGH = { scatter: [5.8e-6, 13.5e-6, 33.1e-6], height: 8000 };
const HAZE = { scatter: 21e-6, height: 1200 };
/* The haze takes out a ninth more than it scatters; the forward lean of its scattering; and the sun's light, in the picture's units. */
const HAZE_EXTINCTION = 1 / 0.9;
const HAZE_LEAN = 0.86;
const SUNLIGHT = 20;
/* The share of the haze's light the picture keeps. */
const HAZE_SHARE = 0.6;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Where a ray from `o` along `d` leaves the sphere of radius `r` about the earth's middle (−1 if it misses). */
function leave(o, d, r) {
  const b = dot(o, d);
  const c = dot(o, o) - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b + Math.sqrt(disc);
}

/** Whether a ray from `o` along `d` meets the ground ahead. */
function meetsGround(o, d) {
  const b = dot(o, d);
  const c = dot(o, o) - EARTH * EARTH;
  return b < 0 && b * b - c >= 0;
}

/*
 * How much air of each kind lies from a height up a slope to the air's top (metres of sea-level
 * air), in a table over the height (finer near the ground, by its square root) and the slope's
 * cosine (finer near the horizon); a slope into the ground has none of the sun's light through it.
 */
const DEPTH_HEIGHTS = 96;
const DEPTH_SLOPES = 256;
const DEPTH_STEPS = 64;
const depths = (() => {
  const table = new Float64Array(DEPTH_HEIGHTS * DEPTH_SLOPES * 2);
  for (let i = 0; i < DEPTH_HEIGHTS; i += 1) {
    const h = (i / (DEPTH_HEIGHTS - 1)) ** 2 * (AIR - EARTH);
    const from = [0, EARTH + h, 0];
    for (let j = 0; j < DEPTH_SLOPES; j += 1) {
      const u = (j / (DEPTH_SLOPES - 1)) * 2 - 1;
      const mu = Math.sign(u) * u * u;
      const along = [Math.sqrt(Math.max(0, 1 - mu * mu)), mu, 0];
      const at = (i * DEPTH_SLOPES + j) * 2;
      if (meetsGround(from, along)) {
        table[at] = Infinity;
        table[at + 1] = Infinity;
        continue;
      }
      const length = leave(from, along, AIR);
      /* The trapezoid rule over the slope, its steps longer as the air thins. */
      let rayleigh = 0;
      let haze = 0;
      let before = 0;
      let densities = [Math.exp(-h / RAYLEIGH.height), Math.exp(-h / HAZE.height)];
      for (let k = 1; k <= DEPTH_STEPS; k += 1) {
        const t = length * (k / DEPTH_STEPS) ** 2;
        const p = [from[0] + along[0] * t, from[1] + along[1] * t, from[2] + along[2] * t];
        const up = Math.hypot(...p) - EARTH;
        const next = [Math.exp(-up / RAYLEIGH.height), Math.exp(-up / HAZE.height)];
        rayleigh += ((densities[0] + next[0]) / 2) * (t - before);
        haze += ((densities[1] + next[1]) / 2) * (t - before);
        densities = next;
        before = t;
      }
      table[at] = rayleigh;
      table[at + 1] = haze;
    }
  }
  return table;
})();

/** The air from a point (its height `h`) toward a direction whose cosine with the point's up is `mu`, from the table: [rayleigh, haze]. */
function depthUp(h, mu, out) {
  const y = Math.sqrt(Math.max(0, Math.min(1, h / (AIR - EARTH)))) * (DEPTH_HEIGHTS - 1);
  const x = ((Math.sign(mu) * Math.sqrt(Math.abs(mu)) + 1) / 2) * (DEPTH_SLOPES - 1);
  const i = Math.min(DEPTH_HEIGHTS - 2, Math.floor(y));
  const j = Math.min(DEPTH_SLOPES - 2, Math.floor(x));
  const fy = y - i;
  const fx = x - j;
  for (let k = 0; k < 2; k += 1) {
    const a = depths[(i * DEPTH_SLOPES + j) * 2 + k];
    const b = depths[(i * DEPTH_SLOPES + j + 1) * 2 + k];
    const c = depths[((i + 1) * DEPTH_SLOPES + j) * 2 + k];
    const d = depths[((i + 1) * DEPTH_SLOPES + j + 1) * 2 + k];
    out[k] = a === Infinity || b === Infinity || c === Infinity || d === Infinity ? Infinity : (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return out;
}

/** What gets through so much air of each kind, a channel. */
const through = (rayleigh, haze, c) => Math.exp(-(RAYLEIGH.scatter[c] * rayleigh + HAZE.scatter * HAZE_EXTINCTION * haze));

function render(settings, rows) {
  const { sun: s, seed, coverage, base, top, cloudScale } = settings;
  const ls = Math.hypot(...s);
  const sun = [s[0] / ls, s[1] / ls, s[2] / ls];
  const noise = makeNoise(seed);
  const noise2 = makeNoise(seed + 1);
  const eye = [0, EARTH + 30, 0];
  /* Per pixel: the atmosphere (with the sun), then the clouds' own colour and how much of the sky they cover. */
  const out = new Float32Array(rows.length * WIDTH * 7);

  /* The scattering's shares by the angle to the sun: Rayleigh's, and the haze's as Cornette and Shanks give it. */
  const rayleighPhase = (mu) => (3 / (16 * Math.PI)) * (1 + mu * mu);
  const hazePhase = (mu) => {
    const g = HAZE_LEAN;
    return ((3 * (1 - g * g)) / (8 * Math.PI * (2 + g * g))) * ((1 + mu * mu) / Math.pow(1 + g * g - 2 * g * mu, 1.5));
  };
  const VIEW_STEPS = 24;
  const sunDepth = [0, 0];

  /**
   * The light the air scatters toward the eye along `d` (up to `limit` metres where given) into
   * `outRgb`, by single scattering: at each step the air's own density, lit by the sun through the
   * air above it (none in the earth's shadow) and seen through the air back to the eye; the steps
   * shorter near the eye, where the air is densest. Returns what gets through from that far.
   */
  const sky = (d, limit, outRgb) => {
    let length = leave(eye, d, AIR);
    if (meetsGround(eye, d)) length = -dot(eye, d) - Math.sqrt(dot(eye, d) ** 2 - (dot(eye, eye) - EARTH * EARTH));
    if (limit > 0) length = Math.min(length, limit);
    const mu = dot(d, sun);
    const lit = [0, 0, 0];
    const hazeLit = [0, 0, 0];
    /* The air passed so far from the eye: rayleigh and haze. */
    let viewRayleigh = 0;
    let viewHaze = 0;
    let before = 0;
    for (let k = 0; k < VIEW_STEPS; k += 1) {
      const end = length * ((k + 1) / VIEW_STEPS) ** 2;
      const middle = (before + end) / 2;
      const step = end - before;
      const p = [eye[0] + d[0] * middle, eye[1] + d[1] * middle, eye[2] + d[2] * middle];
      const r = Math.hypot(...p);
      const h = r - EARTH;
      const rayleigh = Math.exp(-h / RAYLEIGH.height) * step;
      const haze = Math.exp(-h / HAZE.height) * step;
      /* The air to here, half this step's included. */
      viewRayleigh += rayleigh / 2;
      viewHaze += haze / 2;
      depthUp(h, dot(p, sun) / r, sunDepth);
      if (sunDepth[0] !== Infinity) {
        for (let c = 0; c < 3; c += 1) {
          const t = through(viewRayleigh + sunDepth[0], viewHaze + sunDepth[1], c);
          lit[c] += t * rayleigh;
          hazeLit[c] += t * haze;
        }
      }
      viewRayleigh += rayleigh / 2;
      viewHaze += haze / 2;
      before = end;
    }
    const pr = rayleighPhase(mu);
    const pm = hazePhase(mu);
    for (let c = 0; c < 3; c += 1) outRgb[c] = SUNLIGHT * (lit[c] * RAYLEIGH.scatter[c] * pr + HAZE_SHARE * hazeLit[c] * HAZE.scatter * pm);
    /* Deeper blue overhead, as a clear sky photographed with the sun high looks. */
    const l = 0.25 * outRgb[0] + 0.6 * outRgb[1] + 0.15 * outRgb[2];
    const deep = settings.saturation * Math.max(0, Math.min(1, d[1] * 1.6));
    for (let c = 0; c < 3; c += 1) outRgb[c] = Math.max(0, l + (outRgb[c] - l) * (1 + deep)) * (1 - 0.25 * deep);
    return [0, 1, 2].map((c) => through(viewRayleigh, viewHaze, c));
  };

  /* The sunlight reaching the clouds, through the air above their middle, and the sky's light from above them. */
  const sunAt = (() => {
    const [rayleigh, haze] = depthUp((base + top) / 2, sun[1], [0, 0]);
    return [0, 1, 2].map((c) => (rayleigh === Infinity ? 0 : through(rayleigh, haze, c)));
  })();
  const zenith = [0, 0, 0];
  sky([0, 1, 0], 0, zenith);

  const fbm = (n, x, y, z, octaves) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < octaves; o += 1) {
      sum += amp * n(x * f, y * f, z * f);
      f *= 2.03;
      amp *= 0.5;
    }
    return sum;
  };
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  /** The cloud's density at a point (metres; y its height), and whether to take the fine detail. */
  const density = (x, y, z, fine) => {
    const k = cloudScale;
    const weather = smooth(0.45, 0.68, 0.5 + 1.1 * fbm(noise2, x / (6000 * k), 0.3, z / (6000 * k), 4) + coverage - 0.5);
    if (weather <= 0) return 0;
    const h = (y - base) / (top - base);
    if (h <= 0 || h >= 1) return 0;
    const crown = 0.3 + 0.7 * weather;
    const profile = smooth(0, 0.05, h) * (1 - smooth(crown * 0.45, crown, h));
    const shape = 0.5 + 0.5 * (fbm(noise, x / (2400 * k), y / (2400 * k), z / (2400 * k), 4) + 0.45 * Math.abs(noise(x / (800 * k), y / (800 * k), z / (800 * k))));
    let d = (shape * profile - (1 - weather * profile)) / Math.max(1e-3, weather * profile);
    if (d <= 0) return 0;
    if (fine) d -= (1 - Math.min(1, d)) * 0.7 * (0.5 + 0.5 * fbm(noise2, x / (300 * k), y / (300 * k), z / (300 * k), 3));
    return Math.max(0, d);
  };

  const hg = (mu, g) => (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * mu, 1.5));
  const skyRgb = [0, 0, 0];
  const cloud = [0, 0, 0, 0];
  const LIGHT_STEPS = [60, 120, 240, 480, 900];
  const SIGMA = 0.035;

  rows.forEach((row, ri) => {
    const e = ((E1 - (row + 0.5) * ((E1 - E0) / HEIGHT)) * Math.PI) / 180;
    for (let col = 0; col < WIDTH; col += 1) {
      const phi = ((col + 0.5) / WIDTH) * 2 * Math.PI;
      const d = [Math.cos(e) * Math.sin(phi), Math.sin(e), Math.cos(e) * Math.cos(phi)];
      const view = sky(d[1] < 0.03 ? [d[0] * Math.cos(0.03), Math.sin(0.03), d[2] * Math.cos(0.03)] : d, 0, skyRgb);
      let r = skyRgb[0];
      let g = skyRgb[1];
      let b = skyRgb[2];
      const mu = dot(d, sun);
      /* The sun's disc, darkened toward its limb. */
      if (mu > Math.cos(0.012)) {
        const limb = Math.sqrt(1 - Math.min(1, (1 - mu) / (1 - Math.cos(0.012))));
        r += 40 * view[0] * (0.4 + 0.6 * limb);
        g += 40 * view[1] * (0.4 + 0.6 * limb);
        b += 40 * view[2] * (0.4 + 0.6 * limb);
      }
      if (d[1] > 0.004) {
        const t0 = leave(eye, d, EARTH + base);
        const t1 = leave(eye, d, EARTH + top);
        const far = 45000;
        if (t0 < far) {
          const t1c = Math.min(t1, far);
          const steps = 110;
          const dt = (t1c - t0) / steps;
          /* Each ray starts a hashed share of a step in, so the steps leave no bands. */
          const jitter = (((Math.imul(row * 73856093, 1) ^ Math.imul(col, 19349663)) >>> 0) % 1024) / 1024;
          let T = 1;
          const L = [0, 0, 0];
          let tHit = -1;
          const phase = 0.75 * hg(mu, 0.6) + 0.25 * hg(mu, -0.25);
          for (let i = 0; i < steps && T > 0.01; i += 1) {
            const t = t0 + dt * (i + jitter);
            const px = d[0] * t;
            const pz = d[2] * t;
            const py = Math.hypot(eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t) - EARTH;
            const den = density(px, py, pz, true);
            if (den <= 0) continue;
            if (tHit < 0) tHit = t;
            const sigma = SIGMA * den;
            let tau = 0;
            let along = 0;
            for (const step of LIGHT_STEPS) {
              along += step;
              tau += SIGMA * density(px + sun[0] * along, py + sun[1] * along, pz + sun[2] * along, false) * step;
            }
            /* Several orders of scattering at once: each fainter, less shadowed and less forward. */
            let scatter = 0;
            for (let k = 0, a = 1, bb = 1, cc = 1; k < 3; k += 1, a *= 0.5, bb *= 0.45, cc *= 0.5) scatter += a * Math.exp(-bb * tau) * (0.75 * hg(mu, 0.6 * cc) + 0.25 * hg(mu, -0.25 * cc));
            const powder = 1 - 0.6 * Math.exp(-2 * tau - 0.02);
            const hf = (py - base) / (top - base);
            const amb = settings.ambient * (0.2 + 0.8 * hf);
            const white = (zenith[0] + zenith[1] + zenith[2]) / 3;
            const sourceR = settings.sunlight * sunAt[0] * scatter * powder + amb * (0.45 * zenith[0] + 0.55 * white);
            const sourceG = settings.sunlight * sunAt[1] * scatter * powder + amb * (0.45 * zenith[1] + 0.55 * white);
            const sourceB = settings.sunlight * sunAt[2] * scatter * powder + amb * (0.45 * zenith[2] + 0.55 * white);
            const ext = Math.exp(-sigma * dt);
            const w = T * (1 - ext);
            L[0] += w * sourceR;
            L[1] += w * sourceG;
            L[2] += w * sourceB;
            T *= ext;
          }
          if (tHit > 0) {
            /* Far off, the clouds thin into the haze. */
            const thin = 1 - smooth(22000, 44000, tHit);
            T = 1 - (1 - T) * thin;
            for (let c = 0; c < 3; c += 1) L[c] *= thin;
            /* The air between the eye and the cloud: what it lets through, and what it adds. */
            const air = [0, 0, 0];
            const through = sky(d, tHit, air);
            const cover = Math.max(1e-4, 1 - T);
            cloud[0] = (L[0] * through[0] + air[0] * (1 - T)) / cover;
            cloud[1] = (L[1] * through[1] + air[1] * (1 - T)) / cover;
            cloud[2] = (L[2] * through[2] + air[2] * (1 - T)) / cover;
            cloud[3] = 1 - T;
          }
        }
      }
      const o = (ri * WIDTH + col) * 7;
      out.set([r, g, b, cloud[0], cloud[1], cloud[2], cloud[3]], o);
      cloud.fill(0);
    }
  });
  return out;
}

if (isMainThread) {
  const settings = { seed: 10, mie: 21e-6, coverage: 0.5, base: 1200, top: 3400, cloudScale: 0.5, exposure: 1.3, saturation: 0.9, ambient: 2.6, sunlight: 22, width: 3072, height: 1024, sun: [-0.4, 0.8, 0.45], ...JSON.parse(process.argv[2] ?? '{}') };
  WIDTH = settings.width;
  HEIGHT = settings.height;
  const started = Date.now();
  const workers = cpus().length;
  const parts = await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const rows = [];
      for (let row = w; row < HEIGHT; row += workers) rows.push(row);
      return new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { settings, rows } });
        worker.on('message', (data) => resolve({ rows, data }));
        worker.on('error', reject);
      });
    }),
  );
  const { encodePng } = await import(new URL('../lib/png.mjs', import.meta.url).href);
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  const clouds = new Uint8Array(WIDTH * HEIGHT * 4);
  const srgb = (v) => {
    const x = Math.max(0, v);
    /* A soft shoulder, then above `KNEE` one that nears white without reaching it, so the haze round the sun has no flat white edge; then the display's curve. */
    const t = x / (1 + x / 3.5);
    const c = t <= KNEE ? t : KNEE + (1 - KNEE) * (1 - Math.exp(-(t - KNEE) / (1 - KNEE)));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  };
  for (const { rows, data } of parts) {
    rows.forEach((row, ri) => {
      for (let col = 0; col < WIDTH; col += 1) {
        const o = (ri * WIDTH + col) * 7;
        const p = (row * WIDTH + col) * 4;
        pixels[p] = srgb(data[o] * settings.exposure);
        pixels[p + 1] = srgb(data[o + 1] * settings.exposure);
        pixels[p + 2] = srgb(data[o + 2] * settings.exposure);
        pixels[p + 3] = 255;
        clouds[p] = srgb(data[o + 3] * settings.exposure);
        clouds[p + 1] = srgb(data[o + 4] * settings.exposure);
        clouds[p + 2] = srgb(data[o + 5] * settings.exposure);
        clouds[p + 3] = Math.round(255 * Math.min(1, data[o + 6]));
      }
    });
  }
  writeFileSync(settings.out, encodePng(WIDTH, HEIGHT, pixels));
  writeFileSync(settings.out.replace(/\.png$/, '.clouds.png'), encodePng(WIDTH, HEIGHT, clouds));
  console.log(`sky ${WIDTH}x${HEIGHT} in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${settings.out}`);
  process.exit(0);
} else {
  WIDTH = workerData.settings.width;
  HEIGHT = workerData.settings.height;
  HAZE.scatter = workerData.settings.mie;
  parentPort.postMessage(render(workerData.settings, workerData.rows));
}
