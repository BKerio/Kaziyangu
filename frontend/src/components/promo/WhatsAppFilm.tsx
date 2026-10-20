import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowBigUp, Calculator, Camera, Check, CheckCheck, ChevronLeft, CircleCheck, CircleDashed, Clock3, CloudSun, Compass, Delete,
  Folder, Globe, Heart, List, Mail, Map as MapIcon, MessageCircle, Mic, Music, Navigation, NotebookPen, Phone, Pin, Plus, Search,
  Settings, Smile, Sun, Users, Video, Wallet, X,
} from 'lucide-react';
import logo from '@/assets/logos/logo(3).png';
import '@/styles/whatsapp-film.css';

/**
 * Login-page iPhone film: updating a task through the WhatsApp Task Assistant.
 * Home → WhatsApp opens (Face ID in the Dynamic Island → green tick) → Chats →
 * the business chat: type "Hi" → menu → Update Task → task → Status →
 * Completed / Closed → "Task updated" → swipe home, where the My Task widget
 * has already synced.
 *
 * Every frame is a pure function of one clock `t` (seconds), drawn on a fixed
 * 308×682 stage that scales to the screen; `?wafilm=12.3` freezes a frame.
 * Bot copy mirrors backend/src/modules/whatsapp (menus.ts, whatsapp-bot.service.ts).
 */

const W = 308;
const H = 682;
const BUSINESS = 'Millenium Solutions';
const BOT_NUMBER = (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined)?.trim() ?? '';
const MENU_FOOTER = 'Millenium Solutions · Type menu at any time';

// ── Timing helpers ────────────────────────────────────────────────────────────
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (t: number, start: number, dur: number) => clamp((t - start) / dur);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const backOut = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
/** A gentler overshoot than backOut - iOS sheet spring. */
const springOut = (x: number) => 1 + 1.6 * Math.pow(x - 1, 3) + 0.6 * Math.pow(x - 1, 2);

function rise(t: number, at: number, dur = 0.45, dist = 14): CSSProperties {
  const e = easeOut(prog(t, at, dur));
  return { opacity: e, transform: `translateY(${(1 - e) * dist}px)`, filter: e < 1 ? `blur(${(1 - e) * 5}px)` : undefined };
}

function pop(t: number, at: number, dur = 0.5): CSSProperties {
  const x = prog(t, at, dur);
  return { opacity: clamp(x * 3), transform: `scale(${0.6 + 0.4 * (x === 0 ? 0 : backOut(x))})` };
}

/** A fingertip: presses in and fades. */
function Tap({ lt, at, x, y }: { lt: number; at: number; x: number; y: number }) {
  const p = prog(lt, at - 0.18, 0.5);
  if (p <= 0 || p >= 1) return null;
  const press = Math.sin(p * Math.PI);
  return <span className="wf-tap" style={{ left: x, top: y, opacity: press * 0.9, transform: `translate(-50%, -50%) scale(${0.65 + press * 0.45})` }} />;
}

/** A fingertip dragging up from the home indicator. */
function SwipeUp({ lt, at }: { lt: number; at: number }) {
  const p = prog(lt, at, 0.42);
  if (p <= 0 || p >= 1) return null;
  const e = easeInOut(p);
  return <span className="wf-tap" style={{ left: W / 2, top: H - 14 - e * 170, opacity: Math.sin(p * Math.PI) * 0.9, transform: 'translate(-50%, -50%)' }} />;
}

// ── WhatsApp text: *bold*, _italic_, one block per line ──────────────────────

function inline(line: string): ReactNode[] {
  return line.split(/(\*[^*]+\*|_[^_]+_)/g).map((part, i) => {
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <b key={i}>{part.slice(1, -1)}</b>;
    if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) return <i key={i}>{part.slice(1, -1)}</i>;
    return part;
  });
}

function WaText({ text }: { text: string }) {
  return <>{text.split('\n').map((line, i) => (line === '' ? <span key={i} className="wf-gap" /> : <span key={i} className="wf-line">{inline(line)}</span>))}</>;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function WhatsAppGlyph({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 4.2A11.8 11.8 0 0 0 5.8 21.9L4.3 27.7l6-1.5A11.8 11.8 0 1 0 16 4.2Z" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinejoin="round" />
      <path
        transform="translate(9.6 9.4) scale(.54)"
        fill="#fff"
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z"
      />
    </svg>
  );
}

function Verified({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="wf-verified">
      <path fill="#1DAA61" d="m12 1.5 2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3 1 3-2.6 1.9-1 3-3.2-.1L12 22.5l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3-1-3 2.6-1.9 1-3 3.2.1Z" />
      <path d="m7.8 12.2 2.8 2.8 5.6-5.8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Receipt = 'pending' | 'sent' | 'delivered' | 'read';

function Ticks({ state }: { state: Receipt }) {
  if (state === 'pending') return <Clock3 size={10} strokeWidth={2.4} className="wf-ticks" style={{ color: '#8696A0' }} />;
  if (state === 'sent') return <Check size={13} strokeWidth={2.4} className="wf-ticks" style={{ color: '#8696A0' }} />;
  return <CheckCheck size={13} strokeWidth={2.4} className="wf-ticks" style={{ color: state === 'read' ? '#53BDEB' : '#8696A0' }} />;
}

/** Outgoing message lifecycle: clock → ✓ → ✓✓ → blue ✓✓ once the assistant reads it. */
const receiptAt = (since: number): Receipt => (since < 0.2 ? 'pending' : since < 0.4 ? 'sent' : since < 0.7 ? 'delivered' : 'read');

// ── Home screen ───────────────────────────────────────────────────────────────

type App = { label: string; Icon?: typeof Phone; text?: string; img?: string; wa?: boolean; bg: string; fg?: string };

const APPS: App[] = [
  { label: 'Calendar', bg: '#fff' },
  { label: 'FaceTime', Icon: Video, bg: 'linear-gradient(180deg,#5EE07A,#22B847)' },
  { label: 'Mail', Icon: Mail, bg: 'linear-gradient(180deg,#4FB2FF,#1170F0)' },
  { label: 'Clock', bg: '#111' },
  { label: 'Camera', Icon: Camera, bg: 'linear-gradient(180deg,#E4E4E9,#A4A4AC)', fg: '#2C2C2E' },
  { label: 'Weather', Icon: CloudSun, bg: 'linear-gradient(180deg,#4FA3F7,#2266D6)' },
  { label: 'Notes', Icon: NotebookPen, bg: 'linear-gradient(180deg,#FFD84D 0 26%,#fff 26%)', fg: '#A07800' },
  { label: 'Maps', Icon: MapIcon, bg: 'linear-gradient(135deg,#8BE29C,#F4E78A)', fg: '#1F6FE5' },
  { label: 'Health', Icon: Heart, bg: '#fff', fg: '#FF2D55' },
  { label: 'Wallet', Icon: Wallet, bg: '#111' },
  { label: 'Settings', Icon: Settings, bg: 'linear-gradient(180deg,#B9B9C0,#7C7C85)' },
  { label: 'Files', Icon: Folder, bg: '#fff', fg: '#1E90FF' },
  { label: 'Calculator', Icon: Calculator, bg: '#1C1C1E', fg: '#FF9F0A' },
  { label: 'Outlook', text: 'O', bg: 'linear-gradient(180deg,#2B8CF0,#0A56C2)' },
  { label: 'My Task', img: logo, bg: '#fff' },
  { label: 'Teams', Icon: Users, bg: 'linear-gradient(180deg,#7B83EB,#4B53BC)' },
];
const DOCK: App[] = [
  { label: 'Phone', Icon: Phone, bg: 'linear-gradient(180deg,#5EE07A,#22B847)' },
  { label: 'WhatsApp', wa: true, bg: 'linear-gradient(180deg,#5FFC7B,#25C150)' },
  { label: 'Safari', Icon: Compass, bg: 'linear-gradient(180deg,#fff,#E4E9F2)', fg: '#1F6FE5' },
  { label: 'Music', Icon: Music, bg: 'linear-gradient(180deg,#FF6E7F,#FA2D48)' },
];

const ICON = 54;
const GRID_X = 22;
const GRID_GAP = (W - GRID_X * 2 - ICON * 4) / 3;
const WIDGET = ICON * 2 + GRID_GAP;
const WIDGET_Y = 58;
const GRID_Y = WIDGET_Y + WIDGET + 30;
const ROW_H = 78;
const appX = (i: number) => GRID_X + (i % 4) * (ICON + GRID_GAP);
const appY = (i: number) => GRID_Y + Math.floor(i / 4) * ROW_H;
// Dock: 288px wide, 10px padding, icons spaced evenly - WhatsApp is the 2nd.
const DOCK_STEP = (W - 40 - ICON * 4) / 4;
const WA_X = 20 + DOCK_STEP / 2 + ICON / 2 + (ICON + DOCK_STEP);
const WA_Y = H - 22 - 41;

function ClockFace({ minute }: { minute: number }) {
  const hand = (deg: number, len: number, w: number, color: string) => {
    const r = ((deg - 90) * Math.PI) / 180;
    return <line x1={0} y1={0} x2={Math.cos(r) * len} y2={Math.sin(r) * len} stroke={color} strokeWidth={w} strokeLinecap="round" />;
  };
  return (
    <svg width="48" height="48" viewBox="-24 -24 48 48">
      <circle r="23" fill="#fff" />
      {Array.from({ length: 12 }, (_, i) => {
        const r = (i * Math.PI) / 6;
        return <line key={i} x1={Math.cos(r) * 17.5} y1={Math.sin(r) * 17.5} x2={Math.cos(r) * 20.5} y2={Math.sin(r) * 20.5} stroke="#1C1C1E" strokeWidth={i % 3 === 0 ? 1.6 : 0.8} />;
      })}
      {hand(270 + minute * 0.5, 10, 2.4, '#1C1C1E')}
      {hand(minute * 6, 15.5, 1.7, '#1C1C1E')}
      {hand(36, 18, 0.8, '#FF9500')}
      <circle r="1.7" fill="#FF9500" />
    </svg>
  );
}

function AppIcon({ app, pressed = false, minute = 41 }: { app: App; pressed?: boolean; minute?: number }) {
  return (
    <span className="wf-app-ico" style={{ background: app.bg, color: app.fg ?? '#fff', transform: pressed ? 'scale(.86)' : undefined, filter: pressed ? 'brightness(.75)' : undefined }}>
      {app.label === 'Calendar' ? <span className="wf-cal"><em>FRI</em><b>16</b></span>
        : app.label === 'Clock' ? <ClockFace minute={minute} />
        : app.wa ? <WhatsAppGlyph size={34} />
        : app.img ? <img src={app.img} alt="" className="wf-app-img" />
        : app.Icon ? <app.Icon size={26} strokeWidth={1.9} />
        : <b>{app.text}</b>}
    </span>
  );
}

/** The My Task widget: `done` 0 → 1 flips "1 of 2 done" to "2 of 2 done" as the update syncs. */
function TaskWidget({ done, glow }: { done: number; glow: number }) {
  const complete = done >= 0.5;
  return (
    <div className="wf-widget wf-taskw" style={glow ? { boxShadow: `0 6px 18px rgba(0,20,80,.25), 0 ${6 * glow}px ${30 * glow}px rgba(52,199,89,${0.5 * glow})` } : undefined}>
      <span className="wf-tw-head"><img src={logo} alt="" /> My Task</span>
      <b className="wf-tw-hours">3h 30m</b>
      <span className="wf-tw-sub">logged today</span>
      <span className="wf-tw-bar"><i style={{ width: `${50 + 50 * done}%`, background: complete ? '#34C759' : '#C8202B' }} /></span>
      <span className={`wf-tw-foot${complete ? ' ok' : ''}`}>{complete ? <><CircleCheck size={9} /> 2 of 2 tasks done</> : '1 of 2 tasks done'}</span>
    </div>
  );
}

function HomeScreen({ pressWa = false, done = 0, glow = 0, minute = 41 }: { pressWa?: boolean; done?: number; glow?: number; minute?: number }) {
  return (
    <div className="wf-scene wf-home">
      <div className="wf-wall"><i className="w1" /><i className="w2" /><i className="w3" /></div>

      <span className="wf-wslot" style={{ left: GRID_X, top: WIDGET_Y }}>
        <div className="wf-widget wf-weather">
          <span className="wf-w-city">Nairobi <Navigation size={8} fill="currentColor" strokeWidth={0} /></span>
          <b className="wf-w-temp">24°</b>
          <span className="wf-w-foot"><Sun size={14} color="#FFD43B" fill="#FFD43B" strokeWidth={2.2} /><span>Mostly Sunny</span><span>H:27° L:15°</span></span>
        </div>
        <span className="wf-app-label">Weather</span>
      </span>
      <span className="wf-wslot" style={{ left: GRID_X + WIDGET + GRID_GAP, top: WIDGET_Y }}>
        <TaskWidget done={done} glow={glow} />
        <span className="wf-app-label">My Task</span>
      </span>

      {APPS.map((app, i) => (
        <span key={app.label} className="wf-app" style={{ left: appX(i), top: appY(i) }}>
          <AppIcon app={app} minute={minute} />
          <span className="wf-app-label">{app.label}</span>
        </span>
      ))}
      <div className="wf-page-dots"><i className="on" /><i /><i /></div>
      <div className="wf-dock">
        {DOCK.map((app) => <AppIcon key={app.label} app={app} pressed={pressWa && app.wa} />)}
      </div>
    </div>
  );
}

// ── App lock (Face ID runs in the Dynamic Island, see islandAt) ───────────────

const FACE_START = 0.55;
const FACE_OK = 1.9;
const FACE_DONE = 2.75;
const UNLOCK = 2.8;

function FaceIdGlyph({ lt, size = 64 }: { lt: number; size?: number }) {
  // Scanning: the face turns side to side (squashing as it turns) and the frame breathes.
  const scan = lt < FACE_OK ? Math.sin((lt - FACE_START) * 6.2) : 0;
  const breathe = lt < FACE_OK ? 1 - 0.05 * (0.5 + 0.5 * Math.sin((lt - FACE_START) * 9)) : 1;
  const ok = easeOut(prog(lt, FACE_OK, 0.22));
  const ring = easeOut(prog(lt, FACE_OK + 0.05, 0.42));
  const tick = easeOut(prog(lt, FACE_OK + 0.3, 0.28));
  const C = 2 * Math.PI * 38;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <g style={{ opacity: 1 - ok, transform: `scale(${breathe - ok * 0.25})`, transformOrigin: '50px 50px' }} fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 30V18a10 10 0 0 1 10-10h12" />
        <path d="M70 8h12a10 10 0 0 1 10 10v12" />
        <path d="M92 70v12a10 10 0 0 1-10 10H70" />
        <path d="M30 92H18A10 10 0 0 1 8 82V70" />
        <g style={{ transform: `translateX(${scan * 7}px) scaleX(${1 - Math.abs(scan) * 0.14})`, transformOrigin: '50px 50px' }}>
          <path d="M34 36v8M66 36v8" />
          <path d="M52 36v20a4 4 0 0 1-4 4h-3" />
          <path d="M35 70c9 7 21 7 30 0" />
        </g>
      </g>
      <circle cx="50" cy="50" r="38" fill="none" stroke="#34C759" strokeWidth="6.5" strokeLinecap="round"
        strokeDasharray={`${C * ring} ${C}`} transform="rotate(-90 50 50)" style={{ opacity: ok }} />
      <path d="M33 51.5 45 63.5 68 39" fill="none" stroke="#34C759" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round"
        pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - tick} style={{ opacity: tick > 0 ? 1 : 0 }} />
    </svg>
  );
}

function LockScreen({ lt }: { lt: number }) {
  const scanning = lt > FACE_START && lt < FACE_OK;
  return (
    <div className="wf-scene wf-lock">
      <span className="wf-lock-logo" style={rise(lt, 0.15, 0.4, 10)}><WhatsAppGlyph size={44} /></span>
      <b className="wf-lock-title" style={rise(lt, 0.22, 0.4, 10)}>WhatsApp Locked</b>
      <span className="wf-lock-sub" style={rise(lt, 0.28, 0.4, 10)}>{scanning ? 'Looking for your face…' : 'Unlock with Face ID to open WhatsApp.'}</span>
      <span className="wf-lock-btn" style={rise(lt, 0.34, 0.4, 10)}>Use Face ID</span>
    </div>
  );
}

// ── Chats list ────────────────────────────────────────────────────────────────

const CHATS_ROW_Y = 222;
const CHATS_ROW_H = 70;

const CHATS: { name: string; msg: string; time: string; initials?: string; color?: string; unread?: number; mine?: boolean }[] = [
  { name: BUSINESS, msg: 'Task saved · Deployment', time: 'Yesterday' },
  { name: 'Infra Team', initials: 'IT', color: '#7E57C2', msg: 'Kevin: Core switch replaced at Westlands', time: '09:38', unread: 4 },
  { name: 'Grace Wanjiku', initials: 'GW', color: '#EF6C00', msg: 'Sending the BOQ now', time: '09:30', mine: true },
  { name: 'Finance', initials: 'FI', color: '#00897B', msg: 'Ann: Invoice 0142 approved', time: '08:15' },
  { name: 'Kevin Otieno', initials: 'KO', color: '#5C6BC0', msg: 'See you at the site visit', time: 'Yesterday', mine: true },
];

function ChatsScreen({ lt, tapAt }: { lt: number; tapAt: number }) {
  const pressed = lt > tapAt - 0.05;
  return (
    <div className="wf-scene wf-chats">
      <div className="wf-chats-top"><span className="wf-dots-btn">···</span><span className="wf-chats-icons"><Camera size={17} /><Plus size={18} className="wf-plus-round" /></span></div>
      <b className="wf-chats-title">Chats</b>
      <div className="wf-search"><Search size={13} /> Ask Meta AI or Search</div>
      <div className="wf-pills"><span className="on">All</span><span>Unread 4</span><span>Favourites</span><span>Groups</span></div>
      {CHATS.map((c, i) => (
        <div key={c.name} className={`wf-chat-row${pressed && i === 0 ? ' on' : ''}`} style={{ top: CHATS_ROW_Y + i * CHATS_ROW_H, height: CHATS_ROW_H }}>
          {i === 0
            ? <span className="wf-av wf-av-logo"><img src={logo} alt="" /></span>
            : <span className="wf-av" style={{ background: c.color }}>{c.initials}</span>}
          <span className="wf-chat-main">
            <span className="wf-row-head"><b>{c.name}{i === 0 && <Verified />}</b><small className={c.unread ? 'hot' : undefined}>{c.time}</small></span>
            <span className="wf-chat-msg">
              <span>{c.mine && <Ticks state="read" />}{c.msg}</span>
              {c.unread ? <em>{c.unread}</em> : i === 0 ? <Pin size={11} className="wf-pin" /> : null}
            </span>
          </span>
        </div>
      ))}
      <div className="wf-tabbar">
        {[['Updates', CircleDashed], ['Calls', Phone], ['Communities', Users], ['Chats', MessageCircle], ['Settings', Settings]].map(([label, Icon]) => {
          const I = Icon as typeof Phone;
          return <span key={label as string} className={label === 'Chats' ? 'on' : undefined}><I size={19} strokeWidth={label === 'Chats' ? 2.4 : 1.8} />{label as string}</span>;
        })}
      </div>
      <Tap lt={lt} at={tapAt} x={154} y={CHATS_ROW_Y + CHATS_ROW_H / 2} />
    </div>
  );
}

// ── iOS keyboard ──────────────────────────────────────────────────────────────

const KB_H = 266;
const KW = (W - 6 - 9 * 5) / 10;
const KEY_H = 38;
const KEY_ROWS = [46, 92, 138, 184];

interface Key { id: string; x: number; y: number; w: number; fn?: boolean }

const KEYS: Key[] = (() => {
  const keys: Key[] = [];
  'qwertyuiop'.split('').forEach((k, i) => keys.push({ id: k, x: 3 + i * (KW + 5), y: KEY_ROWS[0], w: KW }));
  'asdfghjkl'.split('').forEach((k, i) => keys.push({ id: k, x: 3 + (KW + 5) / 2 + i * (KW + 5), y: KEY_ROWS[1], w: KW }));
  const zStart = (W - (7 * KW + 6 * 5)) / 2;
  keys.push({ id: 'shift', x: 3, y: KEY_ROWS[2], w: 38, fn: true });
  'zxcvbnm'.split('').forEach((k, i) => keys.push({ id: k, x: zStart + i * (KW + 5), y: KEY_ROWS[2], w: KW }));
  keys.push({ id: 'del', x: W - 3 - 38, y: KEY_ROWS[2], w: 38, fn: true });
  keys.push({ id: '123', x: 3, y: KEY_ROWS[3], w: 38, fn: true });
  keys.push({ id: 'emoji', x: 46, y: KEY_ROWS[3], w: 38, fn: true });
  keys.push({ id: 'space', x: 89, y: KEY_ROWS[3], w: W - 89 - 88 });
  keys.push({ id: 'return', x: W - 3 - 80, y: KEY_ROWS[3], w: 80, fn: true });
  return keys;
})();
const keyById = (id: string) => KEYS.find((k) => k.id === id)!;

// Chat-scene seconds.
const FIELD_TAP = 0.5;
const KB_OPEN = 0.55;
const STROKES = [{ key: 'h', at: 1.2 }, { key: 'i', at: 1.5 }];
const SEND_TAP = 1.95;
const KB_CLOSE = 2.15;

function typedAt(c: number): string {
  if (c >= SEND_TAP + 0.05) return '';
  return c >= STROKES[1].at ? 'Hi' : c >= STROKES[0].at ? 'H' : '';
}

const SUGGESTIONS: Record<string, string[]> = { '': ['I', 'The', "I'm"], H: ['"H"', 'Hi', 'Hello'], Hi: ['"Hi"', 'Hi!', 'Hiya'] };

function Keyboard({ c, open }: { c: number; open: number }) {
  if (open <= 0) return null;
  const draft = typedAt(c);
  // Auto-capitalisation: shift is on for the first letter only.
  const caps = draft === '' && c < STROKES[0].at;
  const pressed = STROKES.find((s) => c > s.at - 0.04 && c < s.at + 0.16)?.key;
  return (
    <div className="wf-kb" style={{ height: KB_H, transform: `translateY(${(1 - open) * 100}%)` }}>
      <div className="wf-kb-suggest">{(SUGGESTIONS[draft] ?? SUGGESTIONS['']).map((s, i) => <span key={i}>{s}</span>)}</div>
      {KEYS.map((k) => (
        <span key={k.id} className={`wf-key${k.fn ? ' fn' : ''}${pressed === k.id ? ' on' : ''}${k.id === 'shift' && caps ? ' lit' : ''}`} style={{ left: k.x, top: k.y, width: k.w, height: KEY_H }}>
          {k.id === 'shift' ? <ArrowBigUp size={17} fill={caps ? 'currentColor' : 'none'} />
            : k.id === 'del' ? <Delete size={17} />
            : k.id === 'emoji' ? <Smile size={17} />
            : k.id === 'space' ? 'space'
            : k.fn ? k.id
            : caps ? k.id.toUpperCase() : k.id}
        </span>
      ))}
      {pressed && (() => {
        const k = keyById(pressed);
        return <span className="wf-key-pop" style={{ left: k.x - 7, top: k.y - 50, width: k.w + 14 }}>{pressed === 'h' ? 'H' : pressed}</span>;
      })()}
      <span className="wf-kb-globe"><Globe size={19} /></span>
      <span className="wf-kb-mic"><Mic size={19} /></span>
    </div>
  );
}

// ── The conversation ──────────────────────────────────────────────────────────

interface ListMsg { header: string; body: string; footer?: string; button: string }
interface Msg { at: number; from: 'me' | 'bot'; text?: string; list?: ListMsg; time?: string }
interface SheetRow { title: string; desc?: string }
interface Sheet { tapAt: number; pickAt: number; sendAt: number; title: string; sections: { title: string; rows: SheetRow[] }[]; pick: [number, number] }

const TASK_BEFORE =
  '*Deployment*  ·  Infrastructure\n_Millenium Solutions E.A Limited_\nStatus: *In Progress*\nProgress: ■■■■■■□□□□ 60%\nTime: 2 h 30 min\nNotes: Proxmox cluster upgrade';
const TASK_AFTER =
  '*Deployment*  ·  Infrastructure\n_Millenium Solutions E.A Limited_\nStatus: *Completed / Closed*\nProgress: ■■■■■■■■■■ 100%\nTime: 2 h 30 min\nNotes: Proxmox cluster upgrade';

const UPDATED_AT = 16.5;
const SWIPE_AT = 18.85;
const CHAT_EXIT = 19.1;

const MESSAGES: Msg[] = [
  { at: 2.0, from: 'me', text: 'Hi' },
  {
    at: 3.1, from: 'bot',
    list: {
      header: 'Task Assistant',
      body:
        'Good morning, Brian\n_Friday, 16 October_\n\n*Today*\n■■■■□□□□□□  3 h 30 min of 8 h · 2 tasks\n\n' +
        '*This week*\n■■■■□□□□□□  16 h of 40 h · 7 tasks\n\n4 h 30 min to go for a full day.\n\nTap *Open Menu* to choose what to do next.',
      footer: MENU_FOOTER,
      button: 'Open Menu',
    },
  },
  { at: 6.1, from: 'me', text: 'Update Task' },
  {
    at: 6.95, from: 'bot',
    list: { header: 'Update Task', body: '*Which task would you like to update?*\n\nShowing what you logged today.', footer: MENU_FOOTER, button: 'Choose Task' },
  },
  { at: 9.35, from: 'me', text: '1. Deployment' },
  { at: 10.05, from: 'bot', list: { header: 'Update Task', body: `${TASK_BEFORE}\n\n*What would you like to change?*`, button: 'Choose Field' } },
  { at: 12.55, from: 'me', text: 'Status' },
  { at: 13.2, from: 'bot', list: { header: 'Update Task', body: '*Choose the new status*', button: 'Choose Status' } },
  { at: 15.7, from: 'me', text: 'Completed / Closed' },
  {
    at: UPDATED_AT, from: 'bot',
    list: { header: 'Task Assistant', body: `*Task updated*\n\n${TASK_AFTER}\n\nTap *Open Menu* to choose what to do next.`, footer: MENU_FOOTER, button: 'Open Menu' },
  },
];

const SHEETS: Sheet[] = [
  {
    tapAt: 4.4, pickAt: 5.25, sendAt: 5.8, title: 'Open Menu', pick: [0, 2],
    sections: [
      { title: 'Quick actions', rows: [
        { title: 'Log New Task', desc: 'Eight quick steps, about a minute' },
        { title: 'Repeat Last Task', desc: 'Same setup as Deployment · Millenium Solutions' },
        { title: 'Update Task', desc: '2 tasks from today ready to update' },
      ] },
      { title: 'Your progress', rows: [
        { title: "Today's Tasks", desc: '■■■■□□□□□□  3 h 30 min · 2 tasks' },
        { title: 'This Week', desc: '■■■■□□□□□□  16 h of 40 h' },
      ] },
    ],
  },
  {
    tapAt: 7.85, pickAt: 8.6, sendAt: 9.1, title: 'Choose Task', pick: [0, 0],
    sections: [
      { title: "Today's tasks", rows: [
        { title: '1. Deployment', desc: 'In Progress · 60% · 2 h 30 min · Proxmox cluster upgrade' },
        { title: '2. Support (Break/Fix)', desc: 'Completed / Closed · 100% · 1 h · Printer queue fix' },
      ] },
      { title: 'Navigation', rows: [{ title: 'Main Menu', desc: 'Leave without changes' }] },
    ],
  },
  {
    tapAt: 11.05, pickAt: 11.8, sendAt: 12.3, title: 'Choose Field', pick: [0, 0],
    sections: [
      { title: 'Fields', rows: [
        { title: 'Status', desc: 'Now: In Progress' },
        { title: 'Progress', desc: '■■■■■■□□□□  60%' },
        { title: 'Time Spent', desc: '■■■□□□□□□□  2 h 30 min' },
        { title: 'Organization', desc: 'Millenium Solutions E.A Limited' },
        { title: 'Blockers', desc: 'None recorded' },
      ] },
    ],
  },
  {
    tapAt: 14.1, pickAt: 14.95, sendAt: 15.45, title: 'Choose Status', pick: [0, 4],
    sections: [
      { title: 'Status', rows: [
        { title: 'Not Started', desc: 'Planned, work has not begun' },
        { title: 'In Progress', desc: 'Work is under way' },
        { title: 'Resolved', desc: 'Issue fixed, awaiting closure' },
        { title: 'Blocked', desc: 'Waiting on something before it can continue' },
        { title: 'Completed / Closed', desc: 'Finished and signed off' },
        { title: 'Escalated', desc: 'Handed up for further action' },
      ] },
    ],
  },
];

// Chat geometry
const CHAT_TOP = 100;
const INPUT_H = 50;
const INPUT_TOP = H - 24 - INPUT_H;
const BUBBLE_W = 236;
const BUBBLE_BTN_Y = INPUT_TOP - 8 - 18; // the newest bubble's button row, just above the input bar
const SHEET_TOP = 236;
const SHEET_HEAD = 50;
const SECTION_HEAD = 28;
const SECTION_GAP = 8;
const SHEET_ROW = 52;
const SHEET_FOOT = 84;
const SEND_Y = H - SHEET_FOOT + 12 + 22;

function sheetRowY(sheet: Sheet, s: number, r: number) {
  let y = SHEET_TOP + SHEET_HEAD;
  for (let i = 0; i < s; i++) y += SECTION_HEAD + sheet.sections[i].rows.length * SHEET_ROW + SECTION_GAP;
  return y + SECTION_HEAD + r * SHEET_ROW + SHEET_ROW / 2;
}

/** The assistant shows "typing…" for a beat before each reply. */
const typingAt = (c: number) => MESSAGES.some((m) => m.from === 'bot' && c > m.at - 0.6 && c < m.at);

function Bubble({ m, c, clock }: { m: Msg; c: number; clock: string }) {
  const e = easeOut(prog(c, m.at, 0.38));
  const style: CSSProperties = { maxHeight: e * 460, opacity: clamp(e * 1.6), transform: `translateY(${(1 - e) * 12}px) scale(${0.96 + 0.04 * e})` };
  const time = m.time ?? clock;
  if (m.from === 'me') {
    return (
      <div className="wf-msg me" style={{ ...style, transformOrigin: '100% 100%' }}>
        <div className="wf-bubble me">
          <span>{m.text}</span>
          <span className="wf-meta">{time} <Ticks state={receiptAt(c - m.at)} /></span>
        </div>
      </div>
    );
  }
  if (!m.list) {
    return (
      <div className="wf-msg bot" style={{ ...style, transformOrigin: '0 100%' }}>
        <div className="wf-bubble bot wf-bubble-pad" style={{ maxWidth: BUBBLE_W }}>
          <div className="wf-list-body"><WaText text={m.text ?? ''} /></div>
          <span className="wf-list-foot"><span /><span className="wf-meta">{time}</span></span>
        </div>
      </div>
    );
  }
  const l = m.list;
  return (
    <div className="wf-msg bot" style={{ ...style, transformOrigin: '0 100%' }}>
      <div className="wf-bubble bot" style={{ width: BUBBLE_W }}>
        <div className="wf-bubble-pad">
          <b className="wf-list-head">{l.header}</b>
          <div className="wf-list-body"><WaText text={l.body} /></div>
          <span className="wf-list-foot">
            {l.footer ? <small>{l.footer}</small> : <span />}
            <span className="wf-meta">{time}</span>
          </span>
        </div>
        <span className="wf-list-btn"><List size={14} strokeWidth={2.4} />{l.button}</span>
      </div>
    </div>
  );
}

function ListSheet({ sheet, c }: { sheet: Sheet; c: number }) {
  const openP = prog(c, sheet.tapAt + 0.1, 0.42);
  const open = openP === 0 ? 0 : springOut(openP);
  const close = easeInOut(prog(c, sheet.sendAt + 0.05, 0.3));
  if (openP === 0 || close === 1) return null;
  const picked = c >= sheet.pickAt;
  const pressing = c > sheet.pickAt - 0.05 && c < sheet.pickAt + 0.25;
  return (
    <>
      <div className="wf-sheet-dim" style={{ opacity: 0.38 * clamp(open) * (1 - close) }} />
      <div className="wf-sheet" style={{ top: SHEET_TOP, transform: `translateY(${(1 - open + close) * 100}%)` }}>
        <i className="wf-grabber" />
        <div className="wf-sheet-head"><X size={17} /><b>{sheet.title}</b><span /></div>
        {sheet.sections.map((sec, s) => (
          <div key={sec.title} className="wf-sheet-sec" style={{ marginBottom: SECTION_GAP }}>
            <span className="wf-sheet-sec-title" style={{ height: SECTION_HEAD }}>{sec.title}</span>
            <div className="wf-sheet-rows">
              {sec.rows.map((row, r) => {
                const isPick = s === sheet.pick[0] && r === sheet.pick[1];
                return (
                  <div key={row.title} className={`wf-sheet-row${isPick && pressing ? ' press' : ''}`} style={{ height: SHEET_ROW }}>
                    <span className="wf-sheet-row-main"><b>{row.title}</b>{row.desc && <small>{row.desc}</small>}</span>
                    <i className={`wf-radio${isPick && picked ? ' on' : ''}`} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="wf-sheet-foot" style={{ height: SHEET_FOOT }}>
          <span className={`wf-send${picked ? ' on' : ''}${c > sheet.sendAt - 0.05 && c < sheet.sendAt + 0.15 ? ' press' : ''}`}>Send</span>
        </div>
      </div>
    </>
  );
}

function ChatScreen({ c, clock }: { c: number; clock: string }) {
  const kb = easeOut(prog(c, KB_OPEN, 0.32)) * (1 - easeInOut(prog(c, KB_CLOSE, 0.3)));
  const inputTop = INPUT_TOP - (KB_H - 24) * kb;
  const draft = typedAt(c);
  const focused = c > FIELD_TAP && c < KB_CLOSE;
  const sheet = SHEETS.find((s) => c >= s.tapAt && c < s.sendAt + 0.4);
  const typing = typingAt(c);
  return (
    <div className="wf-scene wf-chat">
      <div className="wf-chat-bg" />
      <div className="wf-chat-head">
        <span className="wf-chat-back"><ChevronLeft size={22} strokeWidth={2.4} /></span>
        <span className="wf-av wf-av-logo sm"><img src={logo} alt="" /></span>
        <span className="wf-chat-who">
          <b>{BUSINESS}<Verified size={12} /></b>
          <small className={typing ? 'typing' : undefined}>{typing ? 'typing…' : BOT_NUMBER || 'Business account'}</small>
        </span>
        <span className="wf-chat-actions"><Video size={19} /><Phone size={17} /></span>
      </div>

      <div className="wf-thread" style={{ top: CHAT_TOP, bottom: H - inputTop }}>
        <span className="wf-chip">Yesterday</span>
        <Bubble m={{ at: -9, from: 'bot', text: '*Task saved*\n\n*Deployment*  ·  Infrastructure\nStatus: *In Progress*\nNotes: Proxmox cluster upgrade', time: '17:48' }} c={c} clock={clock} />
        <span className="wf-chip">Today</span>
        {MESSAGES.filter((m) => c >= m.at).map((m) => <Bubble key={m.at} m={m} c={c} clock={clock} />)}
      </div>

      <div className="wf-input" style={{ top: inputTop, height: INPUT_H }}>
        <Plus size={20} strokeWidth={2} />
        <span className={`wf-field${focused ? ' focus' : ''}`}>{draft}{focused && <i className="wf-caret" />}</span>
        {draft
          ? <span className={`wf-send-btn${c > SEND_TAP - 0.05 && c < SEND_TAP + 0.15 ? ' press' : ''}`}><Navigation size={13} fill="#fff" strokeWidth={0} style={{ transform: 'rotate(90deg)' }} /></span>
          : <><Camera size={19} /><Mic size={19} /></>}
      </div>
      <Keyboard c={c} open={kb} />

      {sheet && <ListSheet sheet={sheet} c={c} />}

      <Tap lt={c} at={FIELD_TAP} x={140} y={INPUT_TOP + INPUT_H / 2} />
      {STROKES.map((s) => { const k = keyById(s.key); return <Tap key={s.key} lt={c} at={s.at} x={k.x + k.w / 2} y={H - KB_H + k.y + KEY_H / 2} />; })}
      <Tap lt={c} at={SEND_TAP} x={W - 24} y={H - KB_H - INPUT_H / 2} />
      {SHEETS.map((s) => (
        <span key={s.title}>
          <Tap lt={c} at={s.tapAt} x={8 + BUBBLE_W / 2} y={BUBBLE_BTN_Y} />
          <Tap lt={c} at={s.pickAt} x={W / 2} y={sheetRowY(s, s.pick[0], s.pick[1])} />
          <Tap lt={c} at={s.sendAt} x={W / 2} y={SEND_Y} />
        </span>
      ))}
      <SwipeUp lt={c} at={SWIPE_AT} />
    </div>
  );
}

// ── Chapters ──────────────────────────────────────────────────────────────────

interface Chapter { start: number; end: number; label: string; dark?: boolean; render: (lt: number) => ReactNode; enter: (lt: number) => CSSProperties }

const WA_TAP = 1.5;
const LOCK_AT = 1.95;
const CHATS_AT = LOCK_AT + UNLOCK;
const CHATS_TAP = 1.2;
const CHAT_AT = CHATS_AT + 1.65;
const HOME2_AT = CHAT_AT + CHAT_EXIT;
const END_AT = HOME2_AT + 4.2;
const FILM_DURATION = END_AT + 4.4;
const CLOCK_TICK = CHAT_AT + 10;

const clockAt = (t: number) => (t >= CLOCK_TICK ? '9:42' : '9:41');

/** An app zooming open out of (or back into) the WhatsApp dock icon. */
function iconZoom(e: number): CSSProperties {
  return { transformOrigin: `${WA_X}px ${WA_Y}px`, transform: `scale(${0.12 + 0.88 * e})`, opacity: clamp(e * 2.5), borderRadius: `${(1 - e) * 44}px`, overflow: 'hidden' };
}

const CHAPTERS: Chapter[] = [
  {
    start: 0, end: LOCK_AT + 0.6, label: 'home', dark: true,
    // As WhatsApp opens, the home screen pushes in and blurs behind it.
    enter: (lt) => {
      const open = easeInOut(prog(lt, WA_TAP + 0.12, 0.5));
      return { opacity: easeOut(prog(lt, 0, 0.35)), transform: `scale(${1 + 0.1 * open})`, filter: open ? `blur(${open * 6}px)` : undefined };
    },
    render: (lt) => (
      <>
        <HomeScreen pressWa={lt > WA_TAP - 0.1 && lt < WA_TAP + 0.3} />
        <Tap lt={lt} at={WA_TAP} x={WA_X} y={WA_Y} />
      </>
    ),
  },
  {
    start: LOCK_AT, end: CHATS_AT + 0.5, label: 'lock',
    enter: (lt) => {
      const unlock = easeInOut(prog(lt, UNLOCK, 0.4));
      if (unlock > 0) return { opacity: 1 - unlock, transform: `scale(${1 + 0.08 * unlock})`, filter: `blur(${unlock * 10}px)` };
      return iconZoom(easeInOut(prog(lt, 0, 0.5)));
    },
    render: (lt) => <LockScreen lt={lt} />,
  },
  {
    start: CHATS_AT, end: CHAT_AT + 0.5, label: 'chats',
    enter: (lt) => ({ opacity: easeOut(prog(lt, 0, 0.35)), transform: `scale(${0.96 + 0.04 * easeOut(prog(lt, 0, 0.45))})` }),
    render: (lt) => <ChatsScreen lt={lt} tapAt={CHATS_TAP} />,
  },
  {
    // Back on the home screen the My Task widget has already synced.
    start: HOME2_AT, end: END_AT + 0.6, label: 'home2', dark: true,
    enter: (lt) => {
      const settle = easeOut(prog(lt, 0.05, 0.6));
      return { transform: `scale(${1.1 - 0.1 * settle})`, filter: settle < 1 ? `blur(${(1 - settle) * 6}px)` : undefined };
    },
    render: (lt) => (
      <>
        <HomeScreen done={easeInOut(prog(lt, 0.9, 0.7))} glow={prog(lt, 0.85, 0.3) * (1 - prog(lt, 2.6, 0.6))} minute={42} />
        <div className="wf-home-scrim" style={{ opacity: easeOut(prog(lt, 1.6, 0.5)) }} />
        <span className="wf-home-caption" style={rise(lt, 1.75, 0.5, 18)}>
          Synced to your workspace.<br /><span className="wf-serif">Instantly.</span>
        </span>
      </>
    ),
  },
  {
    start: CHAT_AT, end: CHAT_EXIT + CHAT_AT + 0.55, label: 'chat',
    // Pushed in from the Chats list; on the swipe home it shrinks back into the icon.
    enter: (lt) => (lt < CHAT_EXIT ? push(lt) : iconZoom(1 - easeInOut(prog(lt, CHAT_EXIT, 0.45)))),
    render: (lt) => <ChatScreen c={lt} clock={clockAt(CHAT_AT + lt).padStart(5, '0')} />,
  },
  {
    start: END_AT, end: FILM_DURATION + 0.01, label: 'end',
    enter: (lt) => ({ clipPath: `circle(${easeInOut(prog(lt, 0, 0.55)) * 120}% at 50% 42%)` }),
    render: (lt) => (
      <div className="wf-scene wf-end">
        <span className="wf-end-logo" style={pop(lt, 0.3, 0.6)}><img src={logo} alt="" /></span>
        <span className="wf-end-word" style={rise(lt, 0.8, 0.5)}>
          <span className="wf-end-your">Your Task,</span>
          <span className="wf-end-my">My Task</span>
        </span>
        <p className="wf-end-tag" style={rise(lt, 1.3, 0.5)}>Update your tasks<br /><span className="wf-serif">right from WhatsApp.</span></p>
        <span className="wf-end-cta" style={pop(lt, 1.9, 0.45)}><WhatsAppGlyph size={16} />{BOT_NUMBER ? `Message ${BOT_NUMBER}` : 'Message the Task Assistant'}</span>
        <span className="wf-end-foot" style={rise(lt, 2.2)}>face id · whatsapp · live sync</span>
      </div>
    ),
  },
];

/** iOS push: the new screen slides in from the right. */
function push(lt: number): CSSProperties {
  return { transform: `translateX(${(1 - easeInOut(prog(lt, 0, 0.42))) * 100}%)`, boxShadow: '-12px 0 30px rgba(0,0,0,.12)' };
}

function filmIsDark(t: number): boolean {
  // The frontmost chapter whose entry has covered the top of the screen.
  const covering = CHAPTERS.filter((c) => t >= c.start + 0.3 && t < c.end);
  const top = covering[covering.length - 1] ?? CHAPTERS.find((c) => t >= c.start && t < c.end);
  if (top?.label === 'chat' && t - CHAT_AT > CHAT_EXIT + 0.2) return true; // shrinking away over the home screen
  return !!top && !!top.dark;
}

type Island = { kind: 'faceid'; lt: number } | { kind: 'text'; text: string } | null;

function islandAt(t: number): Island {
  const lock = t - LOCK_AT;
  if (lock > FACE_START && lock < FACE_DONE) return { kind: 'faceid', lt: lock };
  const c = t - CHAT_AT;
  if (c > UPDATED_AT + 0.2 && c < UPDATED_AT + 2.2) return { kind: 'text', text: 'Task updated' };
  return null;
}

/** Looping rAF clock (film time + wall time for the idle sway), paused while the tab is hidden. `?wafilm=8.2` freezes a frame. */
function useFilmClock(): { t: number; wall: number; live: boolean } {
  const frozen = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('wafilm') : null;
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const live = !frozen && !reduced;
  // Reduced motion: hold on "Task updated", the frame that tells the whole story.
  const [clock, setClock] = useState({ t: frozen ? Number(frozen) : reduced ? CHAT_AT + UPDATED_AT + 1 : 0, wall: 0 });

  useEffect(() => {
    if (!live) return;
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    let wall = 0;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000;
      elapsed = (elapsed + dt) % FILM_DURATION;
      wall += dt;
      last = now;
      setClock({ t: elapsed, wall });
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); }
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVisibility); };
  }, [live]);

  return { ...clock, live };
}

function Film({ t }: { t: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Measure before first paint so the stage never shows at its design size. offsetWidth is the
  // layout width - getBoundingClientRect would return the narrower, 3D-tilted projection.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setScale(el.offsetWidth / W);
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="wf-box" ref={boxRef}>
      <div className="wf-stage" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        {CHAPTERS.filter((c) => t >= c.start && t < c.end).map((c) => (
          <div key={c.label} className="wf-layer" style={c.enter(t - c.start)}>
            {c.render(t - c.start)}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBar({ light, dimmed, time }: { light: boolean; dimmed: boolean; time: string }) {
  return (
    <div className={`wf-status${light ? ' light' : ''}${dimmed ? ' dimmed' : ''}`}>
      <span className="wf-status-time">{time}</span>
      <span className="wf-status-icons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
          <path d="M8 2.4c2.3 0 4.4.9 6 2.3l1.3-1.4A10.6 10.6 0 0 0 8 .4 10.6 10.6 0 0 0 .7 3.3L2 4.7a8.7 8.7 0 0 1 6-2.3Z" />
          <path d="M8 6c1.3 0 2.5.5 3.4 1.3l1.3-1.4A7 7 0 0 0 8 4a7 7 0 0 0-4.7 1.9l1.3 1.4C5.5 6.5 6.7 6 8 6Z" />
          <path d="M8 9.4c.5 0 1 .2 1.3.5L8 11.6 6.7 9.9c.3-.3.8-.5 1.3-.5Z" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect x=".5" y=".5" width="23" height="12" rx="3.6" fill="none" stroke="currentColor" opacity=".4" />
          <rect x="2" y="2" width="17" height="9" rx="2.2" fill="currentColor" />
          <path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" fill="currentColor" opacity=".45" />
        </svg>
      </span>
    </div>
  );
}

/** The iPhone, playing the film: a slow 3D float, glass glare, and a Dynamic Island that runs Face ID. Decorative. */
function WhatsAppPhone() {
  const { t, wall, live } = useFilmClock();
  const island = islandAt(t);
  const ry = live ? -5 + 3.2 * Math.sin(wall * 0.45) : -5;
  const rx = live ? 3 + 1.4 * Math.sin(wall * 0.33 + 1) : 3;
  const lift = live ? Math.sin(wall * 0.7) * 5 : 0;
  return (
    <div className="wf-rig" aria-hidden="true">
      <div className="wf-device" style={{ transform: `translateY(${lift}px) rotateX(${rx}deg) rotateY(${ry}deg)` }}>
        <i className="wf-btn wf-btn-action" />
        <i className="wf-btn wf-btn-volup" />
        <i className="wf-btn wf-btn-voldown" />
        <i className="wf-btn wf-btn-power" />
        <div className="wf-screen">
          <StatusBar light={filmIsDark(t)} dimmed={island?.kind === 'text'} time={clockAt(t)} />
          <div className={`wf-island${island ? ` open ${island.kind}` : ''}`}>
            {island?.kind === 'faceid' ? (
              <span className="wf-island-face"><FaceIdGlyph lt={island.lt} /></span>
            ) : (
              <>
                <span className="wf-island-mark"><WhatsAppGlyph size={16} /></span>
                <span className="wf-island-text">{island?.kind === 'text' ? island.text : ''}</span>
                <CircleCheck size={15} className="wf-island-check" />
              </>
            )}
          </div>
          <Film t={t} />
          <div className="wf-home-bar" />
          <i className="wf-glare" style={{ backgroundPosition: `${50 - ry * 9}% 0` }} />
        </div>
      </div>
      <i className="wf-floor" style={{ transform: `translateX(${-ry * 2}px) scale(${1 - lift * 0.012})`, opacity: 0.9 - lift * 0.02 }} />
    </div>
  );
}

export default WhatsAppPhone;
