import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Crown, Code2, Layout, Compass, ShieldCheck, Cpu, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { CHROME_EYES, CHROME_GRADIENT, MAUS_COLORS, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import { CursorAvatar, type CursorAvatarHandle } from "./CursorAvatar";
import { avatarCropRadius, botAvatarProfile, clampAvatarFocus, clampAvatarZoom, mascotFaceInk, type BotAvatarCrop, type MascotFaceColor } from "../../shared/bot-avatar";
import { MASCOT_BODIES, botMascotBody } from "../../shared/mascot-bodies";
import { isCarvedBody, type BotBodyId } from "../../shared/bot-body";
import { t } from "@/lib/i18n";
import { CarvedAvatar } from "./CarvedAvatar";
import { steelBodyImage } from "@/lib/steel-body";

export const EYE_SCALE = 1.12;
export const MOUTH_WEIGHT = 11;

const POINTER_GAZE = { forward: 1, authored: 0.25 };

interface MotionFaces
  extends Partial<
    Record<Exclude<MausMotion, "none">, { state?: MausState; blink?: boolean; spin?: number }>
  > {}

const MOTION_FACE: MotionFaces = {
  arrive: { state: "spawning", spin: 900 },
  switch: { state: "waking", spin: 620 },
  customize: { state: "proud", blink: true },
  alert: { state: "alerting" },
  thinking: { state: "thinking" },
  working: { state: "working" },
  launch: { state: "loading" },
  success: { state: "happy", blink: true },
  celebrate: { state: "celebrate", spin: 700 },
  blink: { blink: true },
  surprise: { state: "surprised", blink: true },
  failure: { state: "sad" },
};

const MOTION_FACE_MS = 1400;

function mix(hex: string, toward: string, t: number): string {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(toward.slice(1), 16);
  const channel = (shift: number) => {
    const va = (a >> shift) & 0xff;
    const vb = (b >> shift) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  return `#${[channel(16), channel(8), channel(0)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

const gradientFor = (color: MausColor): [string, string, string] => {
  if (color === "chrome") return CHROME_GRADIENT;
  const fill = MAUS_COLORS[color] ?? MAUS_COLORS.green;
  return [mix(fill, "#ffffff", 0.55), fill, mix(fill, "#000000", 0.42)];
};

export function roomAvatarGradient(color: MausColor): [string, string, string] {
  const fill = `var(--identity-${color})`;
  return [
    `color-mix(in srgb, ${fill} 82%, #ffffff)`,
    fill,
    `color-mix(in srgb, ${fill} 82%, #000000)`,
  ];
}

export type MausAvatarHandle = CursorAvatarHandle;

export type MausAvatarProps = {
  color: MausColor;
  state?: MausState;
  expression?: number;
  size?: number;
  label?: string;
  motion?: MausMotion;
  motionKey?: number;
  turn?: number;
  gaze?: { x?: number; y?: number };
  spring?: number;
  eyeScale?: number;
  showMouth?: boolean;
  mouthStroke?: number;
  forward?: boolean;
  lookAround?: number;
  trackPointer?: boolean;
  animated?: boolean;
  bodyId?: BotBodyId;
  gradient?: [string, string, string];
  faceColor?: MascotFaceColor | null;
};

function MausAvatarComponent(props: MausAvatarProps, ref: React.Ref<MausAvatarHandle>) {
  const { bodyId, color, size, state, motion, motionKey, gaze, trackPointer, animated, label } = props;
  if (isCarvedBody(bodyId)) {
    return (
      <CarvedAvatar
        ref={ref}
        body={bodyId}
        color={color}
        faceColor={props.faceColor}
        size={size}
        state={state}
        motion={motion}
        motionKey={motionKey}
        gaze={gaze}
        trackPointer={trackPointer}
        animated={animated}
        label={label}
      />
    );
  }
  return <GradientAvatar ref={ref} {...props} />;
}

function GradientAvatarComponent(
  {
    color,
    state = "idle",
    expression,
    size = 44,
    label,
    motion = "none",
    motionKey = 0,
    turn,
    gaze,
    spring,
    eyeScale,
    showMouth,
    mouthStroke,
    forward = true,
    lookAround,
    trackPointer = true,
    animated = true,
    bodyId,
    gradient,
    faceColor,
  }: MausAvatarProps,
  ref: React.Ref<MausAvatarHandle>,
) {
  const silhouette = MASCOT_BODIES[botMascotBody(bodyId)];
  const chrome = color === "chrome";
  const faceInk = mascotFaceInk(faceColor);
  const inner = useRef<CursorAvatarHandle>(null);
  useImperativeHandle(ref, () => ({
    blink: () => inner.current?.blink(),
    spin: (durationMs?: number) => inner.current?.spin(durationMs),
    setExpression: (index: number) => inner.current?.setExpression(index),
  }));

  const [motionState, setMotionState] = useState<MausState | null>(null);
  useEffect(() => {
    if (motion === "none" || !animated) return;
    const beat = MOTION_FACE[motion];
    if (!beat) return;
    if (beat.blink) inner.current?.blink();
    if (beat.spin) inner.current?.spin(beat.spin);
    if (!beat.state) return;
    setMotionState(beat.state);
    const timer = setTimeout(() => setMotionState(null), MOTION_FACE_MS);
    return () => clearTimeout(timer);
  }, [motion, motionKey, animated]);

  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const range = forward ? POINTER_GAZE.forward : POINTER_GAZE.authored;
  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!trackPointer || !animated) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)) * range,
      y: Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1)) * range,
    });
  };
  const onPointerLeave = () => setPointer({ x: 0, y: 0 });

  return (
    <span
      className="inline-flex shrink-0"
      onPointerMove={trackPointer && animated ? onPointerMove : undefined}
      onPointerLeave={trackPointer && animated ? onPointerLeave : undefined}
    >
      <CursorAvatar
        ref={inner}
        state={motionState ?? state}
        expression={expression}
        size={size}
        silhouette={silhouette}
        gradient={gradient ?? gradientFor(color)}
        picture={chrome && !faceInk ? steelBodyImage(silhouette.id, size, globalThis.devicePixelRatio ?? 1) : null}
        eyeColor={faceInk ?? (chrome ? CHROME_EYES : undefined)}
        title={label ?? null}
        lookAround={lookAround ?? (forward ? 0 : 1)}
        gaze={{ x: (gaze?.x ?? 0) + pointer.x, y: (gaze?.y ?? 0) + pointer.y }}
        turn={turn}
        spring={spring}
        eyeScale={eyeScale}
        showMouth={showMouth}
        mouthStroke={mouthStroke}
        paused={!animated}
      />
    </span>
  );
}

const GradientAvatar = forwardRef(GradientAvatarComponent);

export const MausAvatar = memo(forwardRef(MausAvatarComponent));

export type BotAvatarProps = Omit<MausAvatarProps, "color" | "gradient"> & {
  readable?: boolean;
  bot: {
    name?: string;
    color: MausColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    avatarZoom?: number;
    avatarFocusX?: number;
    avatarFocusY?: number;
    mascotBody?: BotBodyId | null;
    mascotFaceColor?: MascotFaceColor | null;
  };
};

export type BotAvatarOutcome = "flatImage" | "gradientMascot";

/** Mirrored name for name by resolveBotAvatarOutcome in ios/Sources/CompanionCore/BotAvatarRendering.swift. */
export function resolveBotAvatarOutcome(params: {
  avatarCrop: BotAvatarCrop;
  hasUrl: boolean;
  imageFailed: boolean;
}): BotAvatarOutcome {
  const { avatarCrop, hasUrl, imageFailed } = params;
  if (!hasUrl) return "gradientMascot";
  if (avatarCrop === "mascot") return "gradientMascot";
  if (imageFailed) return "gradientMascot";
  return "flatImage";
}

export function botSquircleMeta(color: MausColor | string, name = "", title = "", chief = false) {
  const n = `${name} ${title}`.toLowerCase();
  if (chief || color === "chrome" || color === "purple" || n.includes("lead") || n.includes("chief") || n.includes("maus") || n.includes("bot management")) {
    return {
      gradient: "from-purple-600 via-indigo-600 to-indigo-800",
      textColor: "text-purple-100",
      icon: Crown,
      glow: "rgba(168, 85, 247, 0.4)",
    };
  }
  if (color === "blue" || n.includes("code") || n.includes("noodle") || n.includes("dev") || n.includes("worker")) {
    return {
      gradient: "from-sky-500 via-blue-600 to-blue-700",
      textColor: "text-sky-100",
      icon: Code2,
      glow: "rgba(56, 189, 248, 0.4)",
    };
  }
  if (color === "teal" || n.includes("ui") || n.includes("mochi") || n.includes("front") || n.includes("layout")) {
    return {
      gradient: "from-teal-500 via-emerald-600 to-teal-700",
      textColor: "text-teal-100",
      icon: Layout,
      glow: "rgba(20, 184, 166, 0.4)",
    };
  }
  if (color === "orange" || color === "yellow" || n.includes("research") || n.includes("wren") || n.includes("doc")) {
    return {
      gradient: "from-amber-500 via-orange-500 to-orange-600",
      textColor: "text-amber-100",
      icon: Compass,
      glow: "rgba(245, 158, 11, 0.4)",
    };
  }
  if (color === "red" || color === "coral" || n.includes("test") || n.includes("rio") || n.includes("qa") || n.includes("audit")) {
    return {
      gradient: "from-rose-500 via-red-600 to-rose-700",
      textColor: "text-rose-100",
      icon: ShieldCheck,
      glow: "rgba(244, 63, 94, 0.4)",
    };
  }
  if (color === "green") {
    return {
      gradient: "from-emerald-500 via-green-600 to-emerald-700",
      textColor: "text-emerald-100",
      icon: Sparkles,
      glow: "rgba(34, 197, 94, 0.4)",
    };
  }
  return {
    gradient: "from-slate-700 via-slate-800 to-slate-900",
    textColor: "text-slate-100",
    icon: Cpu,
    glow: "rgba(100, 116, 139, 0.3)",
  };
}

export function TechSquircleAvatar({
  color = "blue",
  name = "",
  title = "",
  chief = false,
  size = 44,
  label,
  className,
}: {
  color?: MausColor | string;
  name?: string;
  title?: string;
  chief?: boolean;
  size?: number;
  label?: string;
  className?: string;
}) {
  const meta = botSquircleMeta(color, name, title, chief);
  const Icon = meta.icon;
  const iconSize = Math.max(12, Math.round(size * 0.46));
  const radius = Math.max(6, Math.round(size * 0.30));

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center bg-gradient-to-br border border-white/15 shadow-sm transition-transform duration-150",
        meta.gradient,
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        boxShadow: `0 3px 12px -2px ${meta.glow}`,
      }}
      aria-label={label ?? name}
      role="img"
    >
      <Icon size={iconSize} className={cn("shrink-0", meta.textColor)} />
    </span>
  );
}

export function BotAvatar(props: BotAvatarProps) {
  const { bot, size = 44, label } = props;
  const profile = botAvatarProfile(bot);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  const outcome = resolveBotAvatarOutcome({
    avatarCrop: profile.avatarCrop,
    hasUrl: Boolean(profile.avatarUrl),
    imageFailed,
  });

  if (outcome !== "flatImage") {
    return (
      <TechSquircleAvatar
        color={bot.color}
        name={bot.name}
        title={(bot as any).title ?? ""}
        chief={Boolean((bot as any).chiefOfStaff)}
        size={size}
        label={label ?? bot.name}
      />
    );
  }

  const radius = avatarCropRadius(profile.avatarCrop);
  const zoom = clampAvatarZoom(bot.avatarZoom ?? 1);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? 0.5);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? 0.5);
  const origin = `${focusX * 100}% ${focusY * 100}%`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden bg-raised"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        src={profile.avatarUrl}
        alt={label ?? (bot.name ? t("avatar.alt", { name: bot.name }) : t("avatar.altFallback"))}
        width={size}
        height={size}
        draggable={false}
        onError={() => setImageFailed(true)}
        className="block size-full max-w-none object-cover"
        style={{
          width: size,
          height: size,
          objectPosition: origin,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: origin,
        }}
      />
    </span>
  );
}

export function InitialsAvatar({
  initials,
  avatarUrl,
  size = 32,
  fallback,
  fontSize,
  className,
}: {
  initials: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
  /** drawn instead of the initials, for a person with no name or email to take them from */
  fallback?: ReactNode;
  fontSize?: number;
}) {
  // A picture that is gone (a restored backup carries the address, not the file) falls back to the initials.
  const [failed, setFailed] = useState<string | null>(null);
  if (avatarUrl && failed !== avatarUrl) {
    return <img src={avatarUrl} alt="" onError={() => setFailed(avatarUrl)} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium", className)}
      style={{ width: size, height: size, fontSize: fontSize ?? size * 0.38 }}
    >
      {fallback ?? initials}
    </div>
  );
}
