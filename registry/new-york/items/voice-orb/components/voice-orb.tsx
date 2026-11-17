"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

/*
 * Voice Orb – A 3D sphere of 520 dots on an HTML5 Canvas that listens, thinks and speaks.
 * - Idle: turns slowly and breathes gently.
 * - Listening: dots jump outward with voice level and shift toward the accent color.
 * - Thinking: collapses into a tilted, fast-spinning ring with a running light wave.
 * - Speaking: waves travel from pole to pole with the voice level.
 * States blend smoothly over ~320ms; dots give way to the mouse pointer when interactive.
 */

export type VoiceOrbState = "idle" | "listening" | "thinking" | "speaking";

export type VoiceOrbProps = {
  /** Current state of the voice assistant */
  state?: VoiceOrbState;
  /** Live loudness from 0 to 1 for listening and speaking – driven by a gentle wave when omitted */
  level?: number;
  /** Side length of the square stage in pixels */
  size?: number;
  /** Number of dots on the sphere */
  dots?: number;
  /** Accent color for listening, thinking and speaking (hex or rgb) */
  accent?: string;
  /** Shows the status label below the orb, or overrides the wording per state */
  label?: boolean | Partial<Record<VoiceOrbState, string>>;
  /** Dots give way slightly to the mouse pointer */
  interactive?: boolean;
  /** Called when the orb is clicked or activated with Enter / Space */
  onPress?: () => void;
  className?: string;
  style?: CSSProperties;
};

const DEFAULT_LABELS: Record<VoiceOrbState, string> = {
  idle: "Ready",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking",
};

function parseHexToRgb(color: string): [number, number, number] {
  const c = color.trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  const m = c.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return [0, 112, 243];
}

export function VoiceOrb({
  state = "idle",
  level,
  size = 220,
  dots = 520,
  accent = "#0070f3",
  label = true,
  interactive = true,
  onPress,
  className,
  style,
}: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const pointerRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });
  const stateRef = useRef<VoiceOrbState>(state);
  const levelRef = useRef<number | undefined>(level);
  stateRef.current = state;
  levelRef.current = level;

  const [inView, setInView] = useState(true);
  const [darkTheme, setDarkTheme] = useState<boolean>(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark") ||
        document.documentElement.getAttribute("data-theme") === "dark"
      : false,
  );

  // Fibonacci sphere points + ring angles
  const points = useMemo(() => {
    const count = Math.max(48, dots);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const arr: {
      bx: number;
      by: number;
      bz: number;
      theta: number;
      phi: number;
      ringAngle: number;
      ringBand: number;
      seed: number;
    }[] = [];
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = golden * i;
      const x = Math.cos(phi) * r;
      const z = Math.sin(phi) * r;
      const theta = Math.acos(Math.max(-1, Math.min(1, y)));
      const ringAngle = (i / count) * Math.PI * 2;
      const ringBand = ((i % 7) - 3) * 0.032;
      arr.push({
        bx: x,
        by: y,
        bz: z,
        theta,
        phi,
        ringAngle,
        ringBand,
        seed: Math.sin(i * 12.9898) * 43758.5453 % 1,
      });
    }
    return arr;
  }, [dots]);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      setDarkTheme(
        root.classList.contains("dark") ||
          root.getAttribute("data-theme") === "dark",
      );
    };
    sync();
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !inView) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const accentRgb = parseHexToRgb(accent);
    const baseRgb: [number, number, number] = darkTheme ? [161, 161, 170] : [82, 82, 91];

    // Blended weights for each state
    const weights = {
      idle: stateRef.current === "idle" ? 1 : 0,
      listening: stateRef.current === "listening" ? 1 : 0,
      thinking: stateRef.current === "thinking" ? 1 : 0,
      speaking: stateRef.current === "speaking" ? 1 : 0,
    };
    let smoothLevel = levelRef.current ?? 0.25;
    let rotY = 0;
    let rotX = 0.18;
    let rafId = 0;
    let lastTime = performance.now();

    const drawFrame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const t = now / 1000;

      const targetState = stateRef.current;
      const blendRate = reducedMotion ? 1 : Math.min(1, dt * 7.5);
      weights.idle += ((targetState === "idle" ? 1 : 0) - weights.idle) * blendRate;
      weights.listening += ((targetState === "listening" ? 1 : 0) - weights.listening) * blendRate;
      weights.thinking += ((targetState === "thinking" ? 1 : 0) - weights.thinking) * blendRate;
      weights.speaking += ((targetState === "speaking" ? 1 : 0) - weights.speaking) * blendRate;

      // Synthetic wave when level prop is omitted
      const rawLevel =
        levelRef.current !== undefined
          ? Math.max(0, Math.min(1, levelRef.current))
          : targetState === "listening"
            ? 0.38 + 0.28 * Math.sin(t * 4.2) + 0.15 * Math.cos(t * 7.7)
            : targetState === "speaking"
              ? 0.45 + 0.35 * Math.sin(t * 5.6) * Math.cos(t * 2.3)
              : 0.08;
      smoothLevel += (rawLevel - smoothLevel) * Math.min(1, dt * 12);

      // Rotation speed blends between slow idle and fast thinking ring
      const spinSpeed =
        0.38 * weights.idle +
        0.65 * weights.listening +
        2.65 * weights.thinking +
        0.85 * weights.speaking;
      if (!reducedMotion) {
        rotY += dt * spinSpeed;
        rotX = 0.18 * (1 - weights.thinking) + 0.52 * weights.thinking + Math.sin(t * 0.7) * 0.06;
      }

      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const baseRadius = size * 0.335;

      // Soft ambient glow behind the sphere
      const activeWeight = weights.listening + weights.thinking + weights.speaking;
      const glowAlpha = 0.05 + activeWeight * 0.12 + smoothLevel * weights.listening * 0.14;
      const glowRadius = baseRadius * (1.18 + smoothLevel * 0.22 * (weights.listening + weights.speaking));
      const grad = ctx.createRadialGradient(cx, cy, baseRadius * 0.1, cx, cy, glowRadius);
      grad.addColorStop(0, `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, ${glowAlpha})`);
      grad.addColorStop(1, `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const tiltZ = -0.26 * weights.thinking;
      const cosZ = Math.cos(tiltZ);
      const sinZ = Math.sin(tiltZ);

      const projected: {
        sx: number;
        sy: number;
        z: number;
        r: number;
        alpha: number;
        colorMix: number;
        chaser: number;
      }[] = [];

      for (let i = 0; i < points.length; i++) {
        const p = points[i];

        // 1. Sphere radius modulation (idle + listening + speaking)
        const idleBreath = 1 + Math.sin(t * 1.7 + p.theta * 1.5) * 0.025;
        const listenJump =
          1 +
          smoothLevel * (0.26 + 0.18 * Math.sin(p.phi * 3 + t * 8) * Math.sin(p.theta * 4 - t * 6));
        const speakPoleWave =
          1 +
          Math.sin(p.theta * 5.5 - t * 7.2) * (0.08 + smoothLevel * 0.22) +
          Math.cos(p.phi * 2 + t * 3.5) * 0.03 * smoothLevel;

        const sphereScale =
          weights.idle * idleBreath +
          weights.listening * listenJump +
          weights.speaking * speakPoleWave +
          weights.thinking * 1;

        const sx3 = p.bx * sphereScale;
        const sy3 = p.by * sphereScale;
        const sz3 = p.bz * sphereScale;

        // 2. Thinking ring coordinates (sphere collapses into a tilted ring)
        const ringR = 1.06 + p.ringBand + Math.sin(p.ringAngle * 3 + t * 4) * 0.025;
        const rx3 = Math.cos(p.ringAngle) * ringR;
        const ry3 = p.by * 0.11; // flattened Y
        const rz3 = Math.sin(p.ringAngle) * ringR;

        // Blend sphere and ring positions
        const wRing = weights.thinking;
        const x0 = sx3 * (1 - wRing) + rx3 * wRing;
        const y0 = sy3 * (1 - wRing) + ry3 * wRing;
        const z0 = sz3 * (1 - wRing) + rz3 * wRing;

        // Rotate around Y
        const x1 = x0 * cosY - z0 * sinY;
        const z1 = x0 * sinY + z0 * cosY;
        const y1 = y0;

        // Rotate around X
        const y2 = y1 * cosX - z1 * sinX;
        const z2 = y1 * sinX + z1 * cosX;
        const x2 = x1;

        // Rotate around Z (for thinking ring tilt)
        const x3 = x2 * cosZ - y2 * sinZ;
        const y3 = x2 * sinZ + y2 * cosZ;
        const z3 = z2;

        // Perspective projection
        const perspective = 2.8 / (2.8 - z3 * 0.65);
        let px = cx + x3 * baseRadius * perspective;
        let py = cy + y3 * baseRadius * perspective;

        // Interactive pointer repulsion
        if (interactive && pointerRef.current.active) {
          const dx = px - pointerRef.current.x;
          const dy = py - pointerRef.current.y;
          const distSq = dx * dx + dy * dy;
          const repelRadius = size * 0.22;
          if (distSq < repelRadius * repelRadius && distSq > 0.01) {
            const dist = Math.sqrt(distSq);
            const force = (1 - dist / repelRadius) * (size * 0.065);
            px += (dx / dist) * force;
            py += (dy / dist) * force;
          }
        }

        // Running light wave around the ring in thinking state
        const waveAngle = (p.ringAngle + rotY * 1.8) % (Math.PI * 2);
        const chaser =
          wRing * Math.pow(Math.max(0, Math.cos(waveAngle - t * 4.6)), 6);

        // Pole-to-pole highlight in speaking state
        const poleGlow =
          weights.speaking *
          Math.max(0, Math.sin(p.theta * 5.5 - t * 7.2)) *
          (0.35 + smoothLevel * 0.65);

        const depthNorm = (z3 + 1.2) / 2.4; // 0 (back) to 1 (front)
        const dotRadius =
          Math.max(0.75, (0.95 + depthNorm * 1.15) * (size / 220)) *
          (1 + chaser * 0.55 + weights.listening * smoothLevel * 0.25);

        const alpha = Math.max(
          0.14,
          Math.min(
            0.98,
            0.18 + depthNorm * 0.68 + chaser * 0.35 + poleGlow * 0.22,
          ),
        );

        const colorMix = Math.min(
          1,
          activeWeight * 0.72 +
            weights.listening * smoothLevel * 0.35 +
            chaser * 0.45 +
            poleGlow * 0.35,
        );

        projected.push({
          sx: px,
          sy: py,
          z: z3,
          r: dotRadius,
          alpha,
          colorMix,
          chaser,
        });
      }

      // Painter's algorithm: back-to-front
      projected.sort((a, b) => a.z - b.z);

      for (let i = 0; i < projected.length; i++) {
        const d = projected[i];
        const r = Math.round(baseRgb[0] + (accentRgb[0] - baseRgb[0]) * d.colorMix + d.chaser * 45);
        const g = Math.round(baseRgb[1] + (accentRgb[1] - baseRgb[1]) * d.colorMix + d.chaser * 45);
        const b = Math.round(baseRgb[2] + (accentRgb[2] - baseRgb[2]) * d.colorMix + d.chaser * 45);
        ctx.fillStyle = `rgba(${Math.min(255, r)}, ${Math.min(255, g)}, ${Math.min(255, b)}, ${d.alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(d.sx, d.sy, d.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reducedMotion && !document.hidden) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    rafId = window.requestAnimationFrame(drawFrame);

    const onVisibility = () => {
      if (!document.hidden && !reducedMotion) {
        lastTime = performance.now();
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [size, points, accent, interactive, inView, darkTheme]);

  const statusText =
    typeof label === "object" && label !== null
      ? label[state] ?? DEFAULT_LABELS[state]
      : DEFAULT_LABELS[state];

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!interactive) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      active: true,
    };
  };

  const handlePointerLeave = () => {
    pointerRef.current.active = false;
  };

  const sharedProps = {
    ref: stageRef as never,
    className: ["ui-vorb", className].filter(Boolean).join(" "),
    "data-state": state,
    style: { "--ui-vorb-size": `${size}px`, ...style } as CSSProperties,
    onPointerMove: handlePointerMove,
    onPointerLeave: handlePointerLeave,
  };

  const inner = (
    <>
      <style href="ui-voice-orb" precedence="default">
        {css}
      </style>
      <span className="ui-vorb__canvas-wrap">
        <canvas
          ref={canvasRef}
          className="ui-vorb__canvas"
          style={{ width: size, height: size }}
          aria-hidden="true"
        />
      </span>
      <span
        className={label === false ? "ui-vorb__sr-only" : "ui-vorb__label"}
        aria-live="polite"
      >
        <span className="ui-vorb__dot" style={{ background: accent }} aria-hidden="true" />
        {statusText}
      </span>
    </>
  );

  if (onPress) {
    return (
      <button
        type="button"
        {...sharedProps}
        aria-pressed={state === "listening"}
        aria-label={statusText}
        onClick={onPress}
      >
        {inner}
      </button>
    );
  }

  return (
    <div role="status" {...sharedProps}>
      {inner}
    </div>
  );
}

const css = /* css */ `
.ui-vorb {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--aui-font, -apple-system, BlinkMacSystemFont, "Inter", sans-serif);
  color: var(--aui-ink, #09090b);
  user-select: none;
}

button.ui-vorb {
  cursor: pointer;
  border-radius: var(--aui-radius, 14px);
  transition: transform 160ms ease;
}

button.ui-vorb:hover {
  transform: scale(1.02);
}

button.ui-vorb:active {
  transform: scale(0.98);
}

button.ui-vorb:focus-visible {
  outline: 2px solid var(--aui-focus, #0070f3);
  outline-offset: 4px;
}

.ui-vorb__canvas-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ui-vorb-size, 220px);
  height: var(--ui-vorb-size, 220px);
}

.ui-vorb__canvas {
  display: block;
  pointer-events: none;
}

.ui-vorb__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--aui-muted, #52525b);
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--aui-subtle, rgba(24, 24, 27, 0.04));
  border: 1px solid var(--aui-border, rgba(24, 24, 27, 0.08));
}

.ui-vorb__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex-shrink: 0;
}

.ui-vorb[data-state="listening"] .ui-vorb__dot,
.ui-vorb[data-state="speaking"] .ui-vorb__dot {
  animation: ui-vorb-pulse 1.2s ease-in-out infinite;
}

.ui-vorb__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes ui-vorb-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.9;
  }
  50% {
    transform: scale(1.45);
    opacity: 0.45;
  }
}
`;
