"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CloudSunIcon } from "./greeting-icons/CloudSunIcon";
import { MoonStarIcon } from "./greeting-icons/MoonStarIcon";
import { SunMediumIcon } from "./greeting-icons/SunMediumIcon";

type GreetingKind = "morning" | "day" | "night";

type GreetingWindow = { phrase: string; kind: GreetingKind };

function greetingForHour(hour: number): GreetingWindow {
  if (hour >= 5 && hour <= 11) return { phrase: "Good morning", kind: "morning" };
  if (hour >= 12 && hour <= 20) return { phrase: hour <= 16 ? "Good afternoon" : "Good evening", kind: "day" };
  return { phrase: "Good night", kind: "night" };
}

interface GreetingMarkProps {
  firstName?: string;
  className?: string;
}

function GreetingTimeIcon({ kind }: { kind: GreetingKind }) {
  const shared = {
    size: 28,
    className: "portal-animated-icon greeting-mark__icon shrink-0",
    "aria-hidden": true as const,
  };
  if (kind === "morning") return <CloudSunIcon {...shared} />;
  if (kind === "day") return <SunMediumIcon {...shared} />;
  return <MoonStarIcon {...shared} />;
}

export function GreetingMark({ firstName, className }: GreetingMarkProps) {
  const [greeting, setGreeting] = useState<GreetingWindow>(() => greetingForHour(new Date().getHours()));

  useEffect(() => {
    const tick = () => setGreeting(greetingForHour(new Date().getHours()));
    tick();
    const id = globalThis.setInterval(tick, 60_000);
    return () => globalThis.clearInterval(id);
  }, []);

  const label = firstName ? `${greeting.phrase}, ${firstName}` : greeting.phrase;

  return (
    <div className={cn("greeting-mark flex min-w-0 items-center gap-2", className)}>
      <span className="truncate text-sm font-semibold text-white">{label}</span>
      <GreetingTimeIcon kind={greeting.kind} />
    </div>
  );
}
