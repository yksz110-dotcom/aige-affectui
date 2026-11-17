"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Gradient Floor – A quiet, dark or light floor with a living wave of color along the bottom edge.
 * Peaks and valleys rise, fall and drift sideways across two blurred morphing layers
 * (color wave + plus-lighter white crest). Pauses automatically when offscreen.
 */

export type GradientFloorProps = {
  /** Content shown above the gradient floor */
  children?: ReactNode;
  /** The three stops of the color wave, from left to right */
  colors?: [string, string, string];
  /** Length of one wave cycle in seconds – smaller is faster */
  speed?: number;
  /** Additional CSS classes for the outer frame */
  className?: string;
  style?: CSSProperties;
};

export function GradientFloor({
  children,
  colors = ["#FF7700", "#FF0055", "#0073FF"],
  speed = 3,
  className,
  style,
}: GradientFloorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setPaused(!entry.isIntersecting);
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const [c1, c2, c3] = colors;

  return (
    <div
      ref={rootRef}
      className={["ui-gf", className].filter(Boolean).join(" ")}
      data-paused={paused || undefined}
      style={
        {
          "--ui-gf-c1": c1,
          "--ui-gf-c2": c2,
          "--ui-gf-c3": c3,
          "--ui-gf-speed": `${Math.max(0.8, speed)}s`,
          ...style,
        } as CSSProperties
      }
    >
      <style href="ui-gradient-floor" precedence="default">
        {css}
      </style>

      <div className="ui-gf__stage" aria-hidden="true">
        <div className="ui-gf__wave ui-gf__wave--color">
          <span className="ui-gf__peak ui-gf__peak--1" />
          <span className="ui-gf__peak ui-gf__peak--2" />
          <span className="ui-gf__peak ui-gf__peak--3" />
          <span className="ui-gf__peak ui-gf__peak--4" />
        </div>
        <div className="ui-gf__wave ui-gf__wave--crest">
          <span className="ui-gf__crest ui-gf__crest--1" />
          <span className="ui-gf__crest ui-gf__crest--2" />
          <span className="ui-gf__crest ui-gf__crest--3" />
        </div>
        <div className="ui-gf__fade" />
      </div>

      <div className="ui-gf__content">{children}</div>
    </div>
  );
}

const css = /* css */ `
.ui-gf {
  --ui-gf-bg: var(--aui-bg, #fafafa);
  position: relative;
  isolation: isolate;
  overflow-x: clip;
  background: var(--ui-gf-bg);
}

.dark .ui-gf,
[data-theme="dark"] .ui-gf {
  --ui-gf-bg: var(--aui-bg, #111113);
}

.ui-gf__stage {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.ui-gf__wave {
  position: absolute;
  left: -12%;
  right: -12%;
  bottom: -90px;
  height: 280px;
  background: linear-gradient(
    90deg,
    var(--ui-gf-c1, #FF7700) 0%,
    var(--ui-gf-c2, #FF0055) 50%,
    var(--ui-gf-c3, #0073FF) 100%
  );
  filter: blur(46px);
  opacity: 0.24;
  transform-origin: 50% 100%;
  animation: ui-gf-drift calc(var(--ui-gf-speed, 3s) * 2.4) ease-in-out infinite alternate;
  will-change: transform;
}

.dark .ui-gf__wave,
[data-theme="dark"] .ui-gf__wave {
  opacity: 0.42;
}

.ui-gf__wave--crest {
  height: 170px;
  bottom: -75px;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.55) 0%,
    rgba(255, 255, 255, 0.85) 50%,
    rgba(255, 255, 255, 0.55) 100%
  );
  mix-blend-mode: plus-lighter;
  filter: blur(34px);
  opacity: 0.32;
  animation: ui-gf-drift-reverse calc(var(--ui-gf-speed, 3s) * 1.9) ease-in-out infinite alternate;
}

.ui-gf__peak,
.ui-gf__crest {
  position: absolute;
  bottom: 0;
  border-radius: 50% 50% 0 0 / 100% 100% 0 0;
  background: inherit;
  transform-origin: 50% 100%;
}

.ui-gf__peak--1 {
  left: 4%;
  width: 34%;
  height: 185px;
  animation: ui-gf-rise var(--ui-gf-speed, 3s) ease-in-out infinite alternate;
}
.ui-gf__peak--2 {
  left: 28%;
  width: 38%;
  height: 225px;
  animation: ui-gf-rise calc(var(--ui-gf-speed, 3s) * 1.25) ease-in-out -1.1s infinite alternate;
}
.ui-gf__peak--3 {
  left: 54%;
  width: 32%;
  height: 195px;
  animation: ui-gf-rise calc(var(--ui-gf-speed, 3s) * 0.95) ease-in-out -0.6s infinite alternate;
}
.ui-gf__peak--4 {
  left: 74%;
  width: 26%;
  height: 165px;
  animation: ui-gf-rise calc(var(--ui-gf-speed, 3s) * 1.4) ease-in-out -1.8s infinite alternate;
}

.ui-gf__crest--1 {
  left: 14%;
  width: 30%;
  height: 130px;
  animation: ui-gf-rise calc(var(--ui-gf-speed, 3s) * 1.1) ease-in-out -0.4s infinite alternate;
}
.ui-gf__crest--2 {
  left: 42%;
  width: 34%;
  height: 155px;
  animation: ui-gf-rise calc(var(--ui-gf-speed, 3s) * 1.35) ease-in-out -1.3s infinite alternate;
}
.ui-gf__crest--3 {
  left: 68%;
  width: 28%;
  height: 120px;
  animation: ui-gf-rise calc(var(--ui-gf-speed, 3s) * 0.9) ease-in-out -0.9s infinite alternate;
}

.ui-gf__fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    var(--ui-gf-bg) 0%,
    var(--ui-gf-bg) 52%,
    transparent 100%
  );
}

.ui-gf__content {
  position: relative;
  z-index: 1;
}

.ui-gf[data-paused="true"] .ui-gf__wave,
.ui-gf[data-paused="true"] .ui-gf__peak,
.ui-gf[data-paused="true"] .ui-gf__crest {
  animation-play-state: paused;
}

@media (prefers-reduced-motion: reduce) {
  .ui-gf__wave,
  .ui-gf__peak,
  .ui-gf__crest {
    animation: none !important;
  }
}

@keyframes ui-gf-rise {
  0% {
    transform: translateY(18px) scaleY(0.76) scaleX(0.95);
  }
  50% {
    transform: translateY(-10px) scaleY(1.16) scaleX(1.04);
  }
  100% {
    transform: translateY(8px) scaleY(0.88) scaleX(0.98);
  }
}

@keyframes ui-gf-drift {
  0% {
    transform: translate3d(-3.5%, 0, 0) scaleX(1.03);
  }
  100% {
    transform: translate3d(3.5%, 0, 0) scaleX(1.06);
  }
}

@keyframes ui-gf-drift-reverse {
  0% {
    transform: translate3d(4%, 0, 0) scaleX(1.02);
  }
  100% {
    transform: translate3d(-4%, 0, 0) scaleX(1.05);
  }
}
`;
