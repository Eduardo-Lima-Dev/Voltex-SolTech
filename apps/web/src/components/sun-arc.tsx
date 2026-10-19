import '@/components/brand-motion.css';

/** Arco do sol da marca: a linha se desenha e o ponto de luz sobe pelo arco (CSS; parado se a pessoa preferir sem animação). */
export function SunArc({ className }: { className?: string }) {
  return (
    <svg
      className={`brand-arc pointer-events-none absolute inset-0 size-full ${className ?? ''}`}
      viewBox="0 0 700 800"
      preserveAspectRatio="xMidYMin slice"
      aria-hidden
    >
      <path d="M0 200H700" stroke="rgb(140 221 244 / 0.18)" fill="none" />
      <path
        className="brand-arc-line"
        pathLength={1}
        d="M-40 200C160 200 260 40 440 40S690 200 760 200"
        fill="none"
        stroke="rgb(140 221 244 / 0.45)"
        strokeWidth="1.5"
      />
      <circle className="brand-sun" r="9" fill="rgb(140 221 244)" />
    </svg>
  );
}
