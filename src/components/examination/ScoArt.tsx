/** Hình minh họa đầu trang cho các cuộc thi SCO: mỗi môn một biểu tượng riêng,
 *  cùng khung, quầng sáng và nhãn với sơ đồ mạng nơ-ron của SIAIO. */
import type { CSSProperties } from 'react';

export type ScoArtKind = 'ai' | 'physics' | 'chemistry' | 'biology' | 'sdg';

const CX = 285;
const CY = 213;
const SDG_COLORS = ['#E5243B', '#DDA63A', '#4C9F38', '#C5192D', '#FF3A21', '#26BDE2', '#FCC30B', '#A21942', '#FD6925',
  '#DD1367', '#FD9D24', '#BF8B2E', '#3F7E44', '#0A97D9', '#56C02B', '#00689D', '#19486A'];

const polar = (radius: number, degrees: number) => {
  const angle = (degrees - 90) * Math.PI / 180;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
};
const order = (index: number) => ({ '--i': index }) as CSSProperties;

function Core({ glyph, size = 75 }: { glyph: string; size?: number }) {
  const fontSize = glyph.length > 3 ? 40 : glyph.length > 2 ? 50 : 66;
  return <>
    <circle className="siaio-neural-orbit" cx={CX} cy={CY} r={size + 29} fill="none" stroke="currentColor" strokeDasharray="3 8" opacity=".42" />
    <circle cx={CX} cy={CY} r={size} fill="#141c36" stroke="currentColor" strokeWidth="1" opacity=".94" />
    <text x={CX} y={CY + fontSize * 0.34} textAnchor="middle" fontSize={fontSize} fontWeight="900" fill="#f5f6ff" letterSpacing={glyph.length > 2 ? -3 : -6}>{glyph}</text>
  </>;
}

function Node({ x, y, index, big = false }: { x: number; y: number; index: number; big?: boolean }) {
  return <g className="siaio-neural-node" style={order(index)}>
    <circle cx={x} cy={y} r={big ? 7 : 4} fill={index % 3 === 0 ? '#f3c992' : 'currentColor'} />
    <circle className="siaio-neural-ring" cx={x} cy={y} r={big ? 20 : 13} fill="none" stroke="currentColor" opacity=".25" />
  </g>;
}

function Neural() {
  const nodes = [
    [92, 72], [241, 45], [369, 105], [476, 46], [53, 218], [166, 188],
    [321, 221], [503, 211], [89, 366], [235, 340], [397, 373], [518, 335],
  ];
  const edges = [[0, 1], [0, 4], [1, 2], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5],
    [4, 8], [5, 6], [5, 9], [6, 7], [6, 10], [7, 11], [8, 9], [9, 10], [10, 11]];
  return <>
    {edges.map(([a, b], index) => <line key={index} className="siaio-neural-edge" style={order(index)} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke="url(#sco-line)" strokeWidth="1.1" opacity={index % 3 === 0 ? '.66' : '.32'} />)}
    {nodes.map(([x, y], index) => <Node key={index} x={x} y={y} index={index} big={index === 6} />)}
    <Core glyph="AI" />
  </>;
}

/** Nguyên tử: ba quỹ đạo elip quay chậm quanh hạt nhân, sóng chạy phía dưới. */
function Physics() {
  const wave = Array.from({ length: 49 }, (_, i) => {
    const x = 40 + i * 10.2;
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${(395 + 14 * Math.sin(i / 2.2)).toFixed(1)}`;
  }).join(' ');
  return <>
    {[0, 60, 120].map((angle, index) => (
      <g key={angle} className="sco-spin" style={{ '--spin': `${26 + index * 9}s`, '--spin-from': `${angle}deg` } as CSSProperties}>
        <ellipse cx={CX} cy={CY} rx="215" ry="72" fill="none" stroke="url(#sco-line)" strokeWidth="1.2" opacity=".55" />
        <circle cx={CX + 215} cy={CY} r="7" fill={index === 1 ? '#f3c992' : 'currentColor'} />
        <circle className="siaio-neural-ring" cx={CX + 215} cy={CY} r="16" fill="none" stroke="currentColor" opacity=".3" style={order(index * 3)} />
      </g>
    ))}
    <path className="siaio-neural-edge" d={wave} fill="none" stroke="url(#sco-line)" strokeWidth="1.4" opacity=".55" style={order(2)} />
    <Core glyph="Ph" />
  </>;
}

/** Phân tử: vòng sáu cạnh ở giữa, các nguyên tử nối ra ngoài như công thức cấu tạo. */
function Chemistry() {
  const ring = Array.from({ length: 6 }, (_, i) => polar(118, i * 60 + 30));
  const outer = ring.map((_, i) => polar(196, i * 60 + 30));
  const tips = [0, 2, 4].map(i => polar(258, i * 60 + 30 + (i === 2 ? 14 : -14)));
  return <>
    {ring.map(([x, y], i) => {
      const [nx, ny] = ring[(i + 1) % 6];
      return <line key={`r${i}`} className="siaio-neural-edge" style={order(i)} x1={x} y1={y} x2={nx} y2={ny} stroke="url(#sco-line)" strokeWidth="1.6" opacity=".7" />;
    })}
    {ring.map(([x, y], i) => i % 2 === 0 && (() => {
      const [nx, ny] = ring[(i + 1) % 6];
      const ix = CX + (x - CX) * 0.84; const iy = CY + (y - CY) * 0.84;
      const jx = CX + (nx - CX) * 0.84; const jy = CY + (ny - CY) * 0.84;
      return <line key={`d${i}`} x1={ix} y1={iy} x2={jx} y2={jy} stroke="currentColor" strokeWidth="1" opacity=".45" />;
    })())}
    {ring.map(([x, y], i) => <line key={`s${i}`} className="siaio-neural-edge" style={order(i + 6)} x1={x} y1={y} x2={outer[i][0]} y2={outer[i][1]} stroke="url(#sco-line)" strokeWidth="1.1" opacity=".45" />)}
    {[0, 2, 4].map((i, k) => <line key={`t${i}`} className="siaio-neural-edge" style={order(k + 12)} x1={outer[i][0]} y1={outer[i][1]} x2={tips[k][0]} y2={tips[k][1]} stroke="url(#sco-line)" strokeWidth="1" opacity=".35" />)}
    {ring.map(([x, y], i) => <Node key={`n${i}`} x={x} y={y} index={i} />)}
    {outer.map(([x, y], i) => <Node key={`o${i}`} x={x} y={y} index={i + 6} big={i % 2 === 1} />)}
    {tips.map(([x, y], i) => <Node key={`p${i}`} x={x} y={y} index={i + 12} />)}
    <Core glyph="Ch" size={70} />
  </>;
}

/** Chuỗi xoắn kép DNA chạy ngang khung, các cặp base nối hai mạch. */
function Biology() {
  const points = Array.from({ length: 17 }, (_, i) => {
    const x = 45 + i * 30;
    const offset = 112 * Math.sin(i / 2.35);
    return { x, top: CY - offset, bottom: CY + offset };
  });
  const strand = (key: 'top' | 'bottom') => points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p[key].toFixed(1)}`).join(' ');
  return <>
    {points.map((p, i) => <line key={`b${i}`} className="siaio-neural-edge" style={order(i)} x1={p.x} y1={p.top} x2={p.x} y2={p.bottom} stroke="url(#sco-line)" strokeWidth="1.1" opacity={i % 2 ? '.3' : '.55'} />)}
    <path d={strand('top')} fill="none" stroke="currentColor" strokeWidth="2" opacity=".75" strokeLinejoin="round" />
    <path d={strand('bottom')} fill="none" stroke="#f3c992" strokeWidth="2" opacity=".6" strokeLinejoin="round" />
    {points.filter((_, i) => i % 2 === 0).map((p, i) => <Node key={`t${i}`} x={p.x} y={p.top} index={i} />)}
    {points.filter((_, i) => i % 2 === 1).map((p, i) => <Node key={`u${i}`} x={p.x} y={p.bottom} index={i + 9} />)}
    <Core glyph="Bio" size={62} />
  </>;
}

/** Vòng 17 màu của các Mục tiêu Phát triển Bền vững, quay rất chậm. */
function Sdg() {
  const radius = 158;
  const step = 360 / SDG_COLORS.length;
  return <>
    <g className="sco-spin" style={{ '--spin': '90s', '--spin-from': '0deg' } as CSSProperties}>
      {SDG_COLORS.map((color, i) => {
        const [x1, y1] = polar(radius, i * step + 1.4);
        const [x2, y2] = polar(radius, (i + 1) * step - 1.4);
        return <path key={color} d={`M${x1.toFixed(1)} ${y1.toFixed(1)} A${radius} ${radius} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`} fill="none" stroke={color} strokeWidth="30" />;
      })}
    </g>
    {SDG_COLORS.map((color, i) => {
      const [x, y] = polar(212, i * step + step / 2);
      return <circle key={`d${i}`} className="siaio-neural-ring" style={order(i)} cx={x} cy={y} r="3.5" fill={color} opacity=".8" />;
    })}
    <Core glyph="SDGs" size={92} />
  </>;
}

export default function ScoArt({ kind, animated, tags }: { kind: ScoArtKind; animated: boolean; tags: [string, string, string] }) {
  const Art = { ai: Neural, physics: Physics, chemistry: Chemistry, biology: Biology, sdg: Sdg }[kind];
  return <div className={`siaio-neural ${animated ? 'is-animated' : ''}`} aria-hidden="true">
    <div className="siaio-neural-halo" />
    <svg viewBox="0 0 570 430" className="siaio-neural-svg">
      <defs><linearGradient id="sco-line"><stop stopColor="currentColor" /><stop offset="1" stopColor="#c9aff5" /></linearGradient></defs>
      <Art />
    </svg>
    <span className="siaio-neural-tag siaio-neural-tag--one">{tags[0]}</span>
    <span className="siaio-neural-tag siaio-neural-tag--two">{tags[1]}</span>
    <span className="siaio-neural-tag siaio-neural-tag--three">{tags[2]}</span>
  </div>;
}
