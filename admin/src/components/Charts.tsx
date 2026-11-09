import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** Rounds a maximum up to a clean axis top and splits it into `count` steps: 0 / 50K / 100K / 150K. */
function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw) ?? raw;
  return Array.from({ length: count + 1 }, (_, index) => index * step);
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export type ChartPoint = { key: string; label: string; axisLabel: string; value: number; detail?: string };

type AreaChartProps = {
  points: ChartPoint[];
  /** Full value for the tooltip, e.g. ₹1,04,500. */
  format: (value: number) => string;
  /** Short value for the y-axis, e.g. ₹1L. */
  formatAxis: (value: number) => string;
  label: string;
  height?: number;
};

const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

/**
 * One series over time: a 2px line over a 10% wash, hairline gridlines, and a crosshair with a tooltip
 * that follows the pointer. Arrow keys move the crosshair for keyboard users and the value is announced.
 */
export function AreaChart({ points, format, formatAxis, label, height = 240 }: AreaChartProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(...points.map((point) => point.value)));
  const top = ticks[ticks.length - 1]!;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (points.length > 1 ? (index / (points.length - 1)) * plotW : plotW / 2);
  const y = (value: number) => PAD.top + plotH - (value / top) * plotH;

  const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  // Evenly spaced dates along the bottom, about one per 72px, always including the first and last.
  const maxLabels = Math.max(2, Math.min(5, Math.floor(plotW / 72)));
  const labelEvery = Math.max(1, Math.ceil((points.length - 1) / (maxLabels - 1)));
  const xLabels = points.map((point, index) => ({ point, index })).filter(({ index }) => index % labelEvery === 0 || index === points.length - 1);
  if (xLabels.length > 1 && xLabels[xLabels.length - 1]!.index - xLabels[xLabels.length - 2]!.index < labelEvery * 0.7) xLabels.splice(xLabels.length - 2, 1);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - PAD.left) / Math.max(1, plotW);
    setActive(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const current = active ?? points.length - 1;
    setActive(Math.min(points.length - 1, Math.max(0, current + moves[event.key]!)));
  };

  const point = active === null ? null : points[active];
  const tipLeft = active === null ? 0 : Math.min(Math.max(x(active), 90), width - 90);

  return (
    <div ref={wrapRef} className="area-chart" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}. Use the left and right arrow keys to read each day.`}
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((current) => current ?? points.length - 1)}
          onBlur={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="area-chart__grid" x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
              <text className="area-chart__tick" x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatAxis(tick)}
              </text>
            </g>
          ))}
          {xLabels.map(({ point: item, index }) => (
            <text key={item.key} className="area-chart__tick" x={x(index)} y={height - 8} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>
              {item.axisLabel}
            </text>
          ))}
          <path className="area-chart__area" d={area} />
          <path className="area-chart__line" d={line} />
          {active !== null && point && (
            <g aria-hidden>
              <line className="area-chart__crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} />
              <circle className="area-chart__dot" cx={x(active)} cy={y(point.value)} r={5} />
            </g>
          )}
        </svg>
      )}
      {point && (
        <div className="chart-tip" style={{ left: tipLeft }} aria-hidden>
          <span className="chart-tip__label">{point.label}</span>
          <span className="chart-tip__value num">{format(point.value)}</span>
          {point.detail && <span className="chart-tip__detail">{point.detail}</span>}
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">
        {point ? `${point.label}: ${format(point.value)}${point.detail ? `, ${point.detail}` : ''}` : ''}
      </p>
    </div>
  );
}

/** A small trend line for stat tiles: quiet gray, with the latest value marked in the accent. */
export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const x = (index: number) => 2 + (index / (values.length - 1)) * (width - 6);
  const y = (value: number) => height - 3 - (value / max) * (height - 6);
  const d = values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join('');
  const last = values.length - 1;
  return (
    <svg className="sparkline" width={width} height={height} aria-hidden>
      <path d={d} />
      <circle cx={x(last)} cy={y(values[last]!)} r={3} />
    </svg>
  );
}
