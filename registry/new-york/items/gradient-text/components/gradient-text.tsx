"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Gradient Text – Headline text filled with slowly drifting blobs of color that sweep across
 * on first view when 60% visible. Real text stays in the flow so selection, copy and screen
 * readers work normally; the color layer sits above with aria-hidden="true".
 */

export type GradientTextProps = {
  /** Text or inline elements to fill with the gradient */
  children: ReactNode;
  /** Up to four colors for the drifting blobs */
  colors?: string[];
  /** Duration of one drift loop in seconds */
  speed?: number;
  /** Sweeps the color in from left to right on first view */
  sweep?: boolean;
  /** HTML tag to render */
  as?: "span" | "h1" | "h2" | "p";
  className?: string;
  style?: CSSProperties;
};

export function GradientText({
  children,
  colors = ["#dd0674", "#5e3ee0", "#ff5fae", "#7c5cff"],
  speed = 8,
  sweep = true,
  as: Tag = "span",
  className,
  style,
}: GradientTextProps) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(!sweep);

  useEffect(() => {
    if (!sweep) {
      setRevealed(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sweep]);

  const c1 = colors[0] ?? "#dd0674";
  const c2 = colors[1] ?? colors[0] ?? "#5e3ee0";
  const c3 = colors[2] ?? c1;
  const c4 = colors[3] ?? c2;

  return (
    <Tag
      ref={ref as never}
      className={["ui-gt", className].filter(Boolean).join(" ")}
      data-sweep={sweep ? (revealed ? "done" : "wait") : "off"}
      style={
        {
          "--ui-gt-c1": c1,
          "--ui-gt-c2": c2,
          "--ui-gt-c3": c3,
          "--ui-gt-c4": c4,
          "--ui-gt-speed": `${Math.max(2, speed)}s`,
          ...style,
        } as CSSProperties
      }
    >
      <style href="ui-gradient-text" precedence="default">
        {css}
      </style>
      <span className="ui-gt__base">{children}</span>
      <span className="ui-gt__fill" aria-hidden="true">
        {children}
      </span>
    </Tag>
  );
}

const css = /* css */ `
.ui-gt {
  position: relative;
  display: inline-block;
  isolation: isolate;
}

.ui-gt__base {
  color: var(--aui-ink, #09090b);
  transition: opacity 700ms cubic-bezier(0.22, 1, 0.36, 1);
}

.ui-gt[data-sweep="done"] .ui-gt__base,
.ui-gt[data-sweep="off"] .ui-gt__base {
  opacity: 0.08;
}

.ui-gt__fill {
  position: absolute;
  inset: 0;
  pointer-events: none;
  user-select: none;
  background-image:
    radial-gradient(circle at 18% 32%, var(--ui-gt-c1) 0%, transparent 58%),
    radial-gradient(circle at 82% 28%, var(--ui-gt-c2) 0%, transparent 58%),
    radial-gradient(circle at 46% 78%, var(--ui-gt-c3) 0%, transparent 62%),
    radial-gradient(circle at 75% 74%, var(--ui-gt-c4) 0%, transparent 60%),
    linear-gradient(110deg, var(--ui-gt-c1) 0%, var(--ui-gt-c2) 45%, var(--ui-gt-c3) 75%, var(--ui-gt-c4) 100%);
  background-size: 220% 220%;
  background-position: 0% 50%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: ui-gt-blobs var(--ui-gt-speed, 8s) ease-in-out infinite alternate;
  clip-path: inset(-8% 0 -8% 0);
  transition: clip-path 880ms cubic-bezier(0.22, 1, 0.36, 1);
}

.ui-gt[data-sweep="wait"] .ui-gt__fill {
  clip-path: inset(-8% 100% -8% 0);
}

.ui-gt[data-sweep="done"] .ui-gt__fill,
.ui-gt[data-sweep="off"] .ui-gt__fill {
  clip-path: inset(-8% 0% -8% 0);
}

@media (prefers-reduced-motion: reduce) {
  .ui-gt__fill {
    animation: none;
    transition: none;
    clip-path: inset(-8% 0% -8% 0) !important;
  }
  .ui-gt__base {
    opacity: 0.08;
    transition: none;
  }
}

@keyframes ui-gt-blobs {
  0% {
    background-position: 0% 40%;
  }
  50% {
    background-position: 100% 60%;
  }
  100% {
    background-position: 35% 15%;
  }
}
`;
