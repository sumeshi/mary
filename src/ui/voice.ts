export type VoiceState = 'idle' | 'loading' | 'listening' | 'error' | 'blocked';

const TARGETS: Record<VoiceState, { energy: number; spread: number }> = {
  idle: { energy: 0, spread: 0 },
  loading: { energy: 0, spread: 0 },
  listening: { energy: 15, spread: 1 },
  error: { energy: 0, spread: 0 },
  blocked: { energy: 0, spread: 0 },
};

/**
 * A small rope-like wave for the start control. The three strands sample the
 * same moving envelope with different phases, so they travel together instead
 * of looping as three independent animations.
 */
export class VoiceRope {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly reducedMotion: MediaQueryList;
  private readonly resizeObserver: ResizeObserver;

  private state: VoiceState = 'idle';
  private color = '#8fd4ff';
  private energy = TARGETS.idle.energy;
  private spread = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private clock = 0;
  private lastFrame = 0;
  private raf = 0;
  private running = true;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available.');
    this.canvas = canvas;
    this.ctx = ctx;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.resize();
    this.start();
  }

  setState(state: VoiceState): void {
    this.state = state;
    if (this.reducedMotion.matches) {
      const target = TARGETS[state];
      this.energy = target.energy;
      this.spread = target.spread;
      this.draw();
    }
  }

  setColor(color: string): void {
    if (color) this.color = color;
    if (this.reducedMotion.matches) this.draw();
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.stop();
    else this.start();
  };

  private start(): void {
    if (!this.running || this.raf) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    if (!this.raf) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (!this.running) return;

    const delta = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.clock += this.reducedMotion.matches ? 0 : delta;

    const target = TARGETS[this.state];
    const energyRate = this.state === 'listening' ? 0.09 : 0.055;
    this.energy += (target.energy - this.energy) * energyRate;
    this.spread += (target.spread - this.spread) * 0.07;

    this.draw();
    if (!this.reducedMotion.matches) {
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.width && height === this.height && dpr === this.dpr) return;

    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private draw(): void {
    const { ctx, width, height } = this;
    if (width <= 0 || height <= 0) return;

    ctx.clearRect(0, 0, width, height);

    const center = height / 2;
    const flat = 1 - Math.min(1, this.spread * 1.25);
    if (flat > 0.01) this.drawFlatLine(flat, center);

    if (this.energy < 0.2 || this.spread < 0.01) return;

    const time = this.clock;
    const envelopeCount = 3.8 + 0.4 * Math.sin(time * 0.09);
    const envelopePhase = time * 0.18;
    const cycles = 4.6 + 0.7 * Math.sin(time * 0.06);
    const breathe = 0.88 + 0.12 * Math.sin(time * 1.05);
    const points = Math.max(64, Math.min(180, Math.round(width / 3)));

    const strands = [
      { scale: 1, alpha: this.spread, lineWidth: 1.7, phase: 0 },
      { scale: 0.64, alpha: 0.55 * this.spread, lineWidth: 1.25, phase: 0.55 },
      { scale: 0.4, alpha: 0.3 * this.spread, lineWidth: 1, phase: 1.5 },
    ];

    ctx.strokeStyle = this.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    for (const strand of strands) {
      if (strand.alpha < 0.01) continue;
      ctx.globalAlpha = strand.alpha;
      ctx.lineWidth = strand.lineWidth;
      ctx.beginPath();

      for (let i = 0; i <= points; i += 1) {
        const u = i / points;
        const envelope =
          0.06 +
          0.94 *
            Math.pow(
              Math.abs(Math.sin(Math.PI * (u * envelopeCount + envelopePhase))),
              1.15,
            );
        const wave =
          Math.sin(2 * Math.PI * (u * cycles - time * 0.22) + strand.phase) +
          0.32 *
            Math.sin(2 * Math.PI * (u * cycles * 1.7 + time * 0.13) + strand.phase * 1.7);
        const y = center + this.energy * breathe * envelope * wave * strand.scale;

        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(u * width, y);
      }

      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  /**
   * A flat baseline with a lit segment travelling along it. It keeps the idle
   * state visibly alive without suggesting that audio is being captured.
   */
  private drawFlatLine(alpha: number, center: number): void {
    const { ctx, width } = this;
    const loading = this.state === 'loading';
    const stopped = this.state === 'error' || this.state === 'blocked';
    const time = this.clock;

    ctx.strokeStyle = this.color;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.globalAlpha = alpha * (stopped ? 0.9 : 0.22);
    ctx.lineWidth = stopped ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(0, center);
    ctx.lineTo(width, center);
    ctx.stroke();

    if (stopped) {
      ctx.globalAlpha = 1;
      return;
    }

    const speed = loading ? 96 : 34;
    const dash = width * (loading ? 0.16 : 0.12);
    const gap = width * (loading ? 0.34 : 0.62);
    const cycle = dash + gap;

    ctx.globalAlpha = alpha * (loading ? 0.8 : 0.5);
    ctx.lineWidth = loading ? 1.8 : 1.5;
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = -((time * speed) % cycle);
    ctx.beginPath();
    ctx.moveTo(0, center);
    ctx.lineTo(width, center);
    ctx.stroke();

    ctx.globalAlpha = alpha * 0.18;
    ctx.lineWidth = 1;
    ctx.lineDashOffset = -((time * speed * 0.55 + cycle * 0.45) % cycle);
    ctx.beginPath();
    ctx.moveTo(0, center);
    ctx.lineTo(width, center);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}
