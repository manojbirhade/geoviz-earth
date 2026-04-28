class ParticleSystem {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.particles = [];
    this.vectorField = null;
    this.active = false;
    this.lowPower = false;
    this.animId = null;
    this.PARTICLE_COUNT = 3000;
    this.TRAIL_LENGTH = 10;
    this._boundResize = () => this._resize();
    window.addEventListener('resize', this._boundResize);
    this._resize();
  }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    // Clear the offscreen fade buffer
    this._offscreen = null;
    if (this.particles.length && this.vectorField) {
      this.particles.forEach(p => this._resetParticle(p, true));
    }
  }

  setVectorField(data) {
    this.vectorField = data;
  }

  setLowPower(val) {
    this.lowPower = val;
    if (this.active) {
      const count = val ? 500 : this.PARTICLE_COUNT;
      this._initParticles(count);
    }
  }

  _initParticles(count) {
    this.particles = Array.from({ length: count }, () => {
      const p = { x: 0, y: 0, age: 0, maxAge: 0, speed: 0, trail: [] };
      this._resetParticle(p, true);
      // Stagger starting ages so particles don't all appear at once
      p.age = Math.floor(Math.random() * p.maxAge);
      return p;
    });
  }

  _resetParticle(p, randomAge = false) {
    const margin = 10;
    p.x = margin + Math.random() * (this.canvas.width - margin * 2);
    p.y = margin + Math.random() * (this.canvas.height - margin * 2);
    p.age = 0;
    p.maxAge = 100 + Math.random() * 120;
    p.trail = [{ x: p.x, y: p.y }];
    p.speed = 0;
  }

  _sampleVector(x, y) {
    if (!this.vectorField) return { uu: 0.1, vv: 0 };
    const { u, v, cols, rows } = this.vectorField;

    let lng, lat;
    try {
      const pt = this.map.containerPointToLatLng(L.point(x, y));
      lng = pt.lng;
      lat = pt.lat;
    } catch {
      return { uu: 0, vv: 0 };
    }

    const fi = ((lng + 180) / 360) * (cols - 1);
    const fj = ((90 - lat) / 180) * (rows - 1);
    const i0 = Math.max(0, Math.min(cols - 2, Math.floor(fi)));
    const j0 = Math.max(0, Math.min(rows - 2, Math.floor(fj)));
    const dx = fi - i0, dy = fj - j0;
    const idx = (r, c) => r * cols + c;
    const lerp = (a, b, t) => a + (b - a) * t;

    const uu = lerp(lerp(u[idx(j0,i0)], u[idx(j0,i0+1)], dx), lerp(u[idx(j0+1,i0)], u[idx(j0+1,i0+1)], dx), dy);
    const vv = lerp(lerp(v[idx(j0,i0)], v[idx(j0,i0+1)], dx), lerp(v[idx(j0+1,i0)], v[idx(j0+1,i0+1)], dx), dy);
    return { uu, vv };
  }

  // Colour scale: slow = cornflower blue, fast = deep teal/cyan
  _streamColor(speed, alpha) {
    const t = Math.min(1, speed / 2.2);
    const r = Math.round(lerp(60,  0,   t));
    const g = Math.round(lerp(120, 180, t));
    const b = Math.round(lerp(220, 210, t));
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  _step() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    // Semi-transparent clear — creates a fading trail effect.
    // On a light bg we clear to white with low alpha so trails fade quickly.
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 0, W, H);

    const speedScale = this.lowPower ? 0.5 : 0.9;

    for (const p of this.particles) {
      const { uu, vv } = this._sampleVector(p.x, p.y);
      const speed = Math.sqrt(uu * uu + vv * vv);
      p.speed = speed;

      // Move particle
      const dx = uu * speedScale;
      const dy = vv * speedScale;
      p.x += dx;
      p.y += dy;
      p.age++;

      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > this.TRAIL_LENGTH) p.trail.shift();

      // Recycle if out of bounds or expired
      if (p.x < -5 || p.x > W + 5 || p.y < -5 || p.y > H + 5 || p.age > p.maxAge) {
        this._resetParticle(p);
        continue;
      }

      if (p.trail.length < 2) continue;

      // Age envelope: fade in over first 20 frames, fade out over last 30
      const fadeIn  = Math.min(1, p.age / 20);
      const fadeOut = Math.min(1, (p.maxAge - p.age) / 30);
      const envelope = fadeIn * fadeOut;

      // Draw the trail as a tapered polyline
      const tLen = p.trail.length;
      ctx.beginPath();
      ctx.moveTo(p.trail[0].x, p.trail[0].y);
      for (let i = 1; i < tLen; i++) {
        ctx.lineTo(p.trail[i].x, p.trail[i].y);
      }
      const trailAlpha = envelope * (0.25 + speed * 0.12);
      ctx.strokeStyle = this._streamColor(speed, Math.min(0.55, trailAlpha));
      ctx.lineWidth = 0.8 + speed * 0.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Bright head dot
      const headAlpha = envelope * Math.min(0.85, 0.4 + speed * 0.2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.8 + speed * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = this._streamColor(speed, headAlpha);
      ctx.fill();
    }
  }

  start() {
    if (this.active) return;
    this.active = true;
    const count = this.lowPower ? 500 : this.PARTICLE_COUNT;
    this._initParticles(count);
    this.canvas.style.display = 'block';
    // Clear canvas before first frame
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const loop = () => {
      if (!this.active) return;
      this._step();
      this.animId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.active = false;
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animId = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.style.display = 'none';
    this.particles = [];
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._boundResize);
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

window.ParticleSystem = ParticleSystem;
