"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, FileText, Mail, Moon, Presentation, Sun } from "lucide-react";
import { DownloadIcon } from "@/modules/shared/components/animated-icons/DownloadIcon";
import { HouseIcon } from "@/modules/shared/components/animated-icons/HouseIcon";
import { SearchIcon } from "@/modules/shared/components/animated-icons/SearchIcon";
import { useTheme } from "@/modules/shared/providers/ThemeProvider";
import { usePortal } from "@/context/PortalContext";
import { cn } from "@/lib/utils";
import { REPORT_REFRESH_DONE_EVENT, REPORT_REFRESH_EVENT } from "@/lib/report-events";
import visualRefreshIcon from "@/assets/visual_refresh.png";
import smartLogo from "@/assets/SMART_logo.png";
import { AnimatePresence, motion } from "framer-motion";
import { useSmartPanel } from "@/modules/smart-chatbot/hooks/useSmartPanel";
import { useSmartConversation } from "@/modules/smart-chatbot/hooks/useSmartConversation";
import { looksLikeSmartQuestion } from "@/modules/smart-chatbot/logic/smartReplyHeuristic";
import { SearchSmartBubble } from "@/modules/smart-chatbot/components/SearchSmartBubble";
import { GreetingMark } from "@/modules/homepage/components/GreetingMark";
import type { ChatMessage } from "@/types";
import { AccountMenu } from "./AccountMenu";
import { GlassTray } from "./GlassTray";
import { useNavChrome, WaveMark } from "@/modules/menu-panel/logic/nav-chrome";
import { SnapshotDialog } from "../../../../snapshot_export/SnapshotDialog";
import type { SnapshotFormat } from "../../../../snapshot_export/export-report";

interface HeaderProps {
  title?: string;
}

const ADMIN_SECTIONS = [
  { href: "/admin/departments", label: "Department / Category", match: ["/admin/departments", "/admin/categories"] },
  { href: "/admin/users", label: "Users", match: ["/admin/users"] },
  { href: "/admin/groups", label: "Groups", match: ["/admin/groups"] },
  { href: "/admin/reports", label: "Reports", match: ["/admin/reports"] },
];

function adminSection(pathname: string) {
  return ADMIN_SECTIONS.some((item) => item.match.some((path) => pathname === path || pathname.startsWith(`${path}/`)));
}

function AdminSectionNav({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Administration" className="flex items-center gap-1">
      <Link
        href="/dashboard"
        aria-label="Home"
        title="Home"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#0b2540] hover:bg-white/45 dark:text-white dark:hover:bg-white/15"
      >
        <HouseIcon size={16} className="portal-animated-icon" />
      </Link>
      {ADMIN_SECTIONS.map((item) => {
        const active = item.match.some((path) => pathname === path || pathname.startsWith(`${path}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold",
              active
                ? "bg-[#1d4e89] text-white shadow-sm"
                : "text-[#0b2540] hover:bg-white/45 dark:text-white dark:hover:bg-white/15",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

const EXPORTS = [
  { id: "ppt", label: "PPT", icon: Presentation, color: "#e25b2a" },
  { id: "pdf", label: "PDF", icon: FileText, color: "#e23b4a" },
  { id: "word", label: "Word", icon: FileText, color: "#2f6fed" },
  { id: "email", label: "Email", icon: Mail, color: "#1aa6a0" },
] as const;

const NOTIFICATIONS = [
  "You have 3 pending access requests to be approved",
  "Some visuals are not pinned to your board",
  "Aadesh Shah is now added as admin for Business Strategy",
  "Avinash Shaktivel gave access to 3 reports 2 days ago",
];

/** Report search with SMART: the same bar on the home page and in the side menu. */
export function HeaderReportSearch({ smartLauncher, className }: { smartLauncher: boolean; className?: string }) {
  const router = useRouter();
  const { reports } = usePortal();
  const smartPanel = useSmartPanel();
  const { sendMessage, openWithPrompt, loading, messages } = useSmartConversation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [bubbleReply, setBubbleReply] = useState<ChatMessage | undefined>();
  const loadingRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return reports
      .filter((r) => `${r.title ?? r.name ?? ""} ${r.categoryName ?? ""}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [reports, query]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const openReport = (id: string) => {
    setOpen(false);
    setBubbleOpen(false);
    setQuery("");
    router.push(`/dashboard/${id}`);
  };

  const refreshBox = () => setBox(wrapRef.current?.getBoundingClientRect() ?? null);

  const submitSmart = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      openWithPrompt();
      return;
    }
    refreshBox();
    setBubbleOpen(true);
    setBubbleReply(undefined);
    setOpen(false);
    void sendMessage(trimmed);
  };

  useEffect(() => {
    if (loadingRef.current && !loading && bubbleOpen) {
      const last = [...messages].reverse().find((m) => m.role === "assistant" && m.id !== "welcome");
      setBubbleReply(last);
    }
    loadingRef.current = loading;
  }, [loading, messages, bubbleOpen]);

  useEffect(() => {
    if (!bubbleOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setBubbleOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bubbleOpen]);

  const showList = open && query.trim().length > 0 && box && !bubbleOpen;

  return (
    <div ref={wrapRef} className={cn("relative shrink-0", smartLauncher ? "w-72 max-w-full" : "w-56", className)}>
      <SearchIcon size={14} className="portal-animated-icon absolute left-2 top-1/2 z-[1] -translate-y-1/2 text-slate-400" />
      {smartLauncher && smartPanel && !smartPanel.open && (
        <button
          type="button"
          className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full hover:bg-white/25 dark:hover:bg-white/10"
          aria-label="Open SMART assistant"
          title="SMART"
          aria-controls="smart-panel"
          onClick={() => openWithPrompt(query)}
        >
          <motion.span layoutId="smart-launcher" className="block h-6 w-6">
            <Image src={smartLogo} alt="" width={24} height={24} className="h-6 w-6 object-contain" />
          </motion.span>
        </button>
      )}
      <input
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
          refreshBox();
          setOpen(true);
          setBubbleOpen(false);
        }}
        onFocus={() => {
          refreshBox();
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const trimmed = query.trim();
            if (matches[highlight]) {
              openReport(matches[highlight].id);
              return;
            }
            if (smartLauncher && (matches.length === 0 || looksLikeSmartQuestion(trimmed) || !trimmed)) {
              submitSmart(trimmed);
              return;
            }
          } else if (event.key === "Escape") {
            if (bubbleOpen) setBubbleOpen(false);
            else setOpen(false);
          }
        }}
        placeholder="Search reports or ask SMART"
        aria-label="Search reports"
        aria-expanded={Boolean(showList)}
        aria-controls="header-report-results"
        role="combobox"
        className={cn(
          "h-7 w-full rounded-full border border-white/20 bg-white/20 py-1 pl-8 text-xs text-[var(--ink)] placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--smart-accent)]",
          smartLauncher ? "pr-9" : "pr-3",
        )}
      />
      {bubbleOpen && box && createPortal(
        <SearchSmartBubble
          anchor={box}
          latest={bubbleReply}
          loading={loading}
          onClose={() => setBubbleOpen(false)}
          onOpenPanel={() => {
            setBubbleOpen(false);
            openWithPrompt();
          }}
          onFollowUp={(text) => void sendMessage(text)}
        />,
        document.body,
      )}
      {showList &&
        createPortal(
          <ul
            ref={listRef}
            id="header-report-results"
            role="listbox"
            className="fixed z-[100001] max-h-80 overflow-y-auto rounded-md border border-[#e2e8f0] bg-white py-1 text-[#0b2540] shadow-lg"
            style={{ top: box.bottom + 4, left: box.left, width: Math.max(box.width, 300) }}
          >
            {matches.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No reports match “{query.trim()}”</li>}
            {matches.map((report, index) => (
              <li key={report.id} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-[#f4f7fb]",
                    index === highlight && "bg-[#f4f7fb]"
                  )}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => openReport(report.id)}
                >
                  <span className="truncate text-sm">{report.title ?? report.name}</span>
                  {report.categoryName && <span className="text-[11px] text-slate-500">{report.categoryName}</span>}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}

export function Header({ title }: HeaderProps) {
  const pathname = usePathname();
  const { reports, userInfo } = usePortal();
  const smartPanel = useSmartPanel();
  const isHome = pathname === "/dashboard";
  const firstName = userInfo?.name?.split(/\s+/)[0] ?? userInfo?.email?.split("@")[0];
  const nav = useNavChrome();
  const { theme, toggleTheme } = useTheme();
  const reportSegment = pathname.match(/^\/dashboard\/([^/]+)/)?.[1];
  const reportId = reportSegment && reportSegment !== "apps" ? reportSegment : undefined;
  const isProviderAppRoute = /^\/dashboard\/apps\/[^/]+$/.test(pathname);
  const dockOverReport = Boolean(reportId) || pathname.startsWith("/display/") || isProviderAppRoute;
  const onAdmin = adminSection(pathname);
  /** Center search+SMART on every glass header except admin and while the SMART chat panel is open. */
  const searchInBar = !onAdmin && !smartPanel?.open;
  const report = reportId ? reports.find((r) => r.id === reportId) : undefined;
  const [refreshing, setRefreshing] = useState(false);
  const [activeIcon, setActiveIcon] = useState<string | null>(null);

  useEffect(() => {
    const onDone = () => setRefreshing(false);
    window.addEventListener(REPORT_REFRESH_DONE_EVENT, onDone);
    return () => window.removeEventListener(REPORT_REFRESH_DONE_EVENT, onDone);
  }, []);

  const [exportOpen, setExportOpen] = useState(false);
  const [snapshotFormat, setSnapshotFormat] = useState<SnapshotFormat | null>(null);
  const [exportAnchor, setExportAnchor] = useState<DOMRect | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const exportTrayRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);

  const readExportAnchor = () => exportRef.current?.getBoundingClientRect() ?? null;

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideExport = exportRef.current?.contains(target) || exportTrayRef.current?.contains(target);
      if (!insideExport) setExportOpen(false);
      if (notesRef.current && !notesRef.current.contains(target)) setNotesOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExportOpen(false);
      setNotesOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const iconShift = { layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <header className={cn("pointer-events-none absolute inset-x-0 top-0 z-30 bg-transparent", dockOverReport ? "px-2 pt-1" : "px-3 pt-2")}>
      {dockOverReport && <div className="glass-backplate glass-backplate--compact" aria-hidden />}
      <div className={cn(
        "glass-bar pointer-events-auto grid items-center",
        dockOverReport
          ? "glass-bar--compact h-9 grid-cols-[auto_minmax(0,1fr)_auto] rounded-2xl px-2"
          : "h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] rounded-[22px] px-3",
      )}>
      <div className="flex items-center justify-self-start gap-1">
        {!nav.open && (
          <motion.button
            type="button"
            layout
            layoutId="portal-brand"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent hover:bg-transparent active:bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#333869]/40"
            aria-label="Open report menu"
            onClick={() => nav.setOpen(true)}
          >
            <WaveMark />
          </motion.button>
        )}
        {isHome && !onAdmin && <GreetingMark firstName={firstName} className="hidden min-w-0 sm:flex" />}
      </div>

      <div className="flex min-w-0 items-center justify-center px-2">
        {onAdmin ? (
          <AdminSectionNav pathname={pathname} />
        ) : (
          <>
            {searchInBar && (
              <HeaderReportSearch
                smartLauncher
                className={dockOverReport ? "w-full max-w-[min(22rem,100%)]" : "w-72 max-w-full"}
              />
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-self-end gap-1">
        {reportId && (
          <motion.button
            type="button"
            layout
            transition={iconShift}
            className="glass-icon flex items-center justify-center disabled:opacity-60"
            aria-label="Refresh visuals"
            title="Refresh visuals"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              window.dispatchEvent(new Event(REPORT_REFRESH_EVENT));
            }}
          >
            <Image
              src={visualRefreshIcon}
              alt=""
              width={20}
              height={20}
              className={cn("h-5 w-5 object-contain", refreshing && "animate-spin")}
            />
          </motion.button>
        )}

        <GlassTray activeId={activeIcon} className="relative">
          {/* 1. Download / export */}
          <motion.div layout transition={iconShift} className="relative" ref={exportRef}>
            <button
              type="button"
              data-tray-id="download"
              data-active={activeIcon === "download"}
              className="glass-tray__item glass-icon flex items-center justify-center"
              aria-label="Export report"
              aria-expanded={exportOpen}
              title="Export"
              onClick={() => {
                setActiveIcon("download");
                setNotesOpen(false);
                setExportAnchor(readExportAnchor());
                setExportOpen((open) => !open);
              }}
            >
              <DownloadIcon size={18} className="portal-animated-icon" />
            </button>
            {exportOpen && exportAnchor && createPortal(
              <div
                ref={exportTrayRef}
                className="fixed z-[100001] flex gap-1.5 rounded-lg border border-[#e2e8f0] bg-white p-1.5 shadow-lg"
                style={{ top: exportAnchor.bottom + 6, left: Math.max(8, Math.min(exportAnchor.left - 170, window.innerWidth - 210)) }}
                role="dialog"
                aria-label="Export options"
              >
                {EXPORTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={`Export as ${item.label}`}
                    className="flex w-11 flex-col items-center gap-1 rounded-md px-1 py-1 text-[10px] font-medium text-slate-600 hover:bg-[#f4f7fb]"
                    onClick={() => {
                      setExportAnchor(readExportAnchor());
                      setExportOpen(false);
                      setSnapshotFormat(item.id);
                    }}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-md text-white" style={{ backgroundColor: item.color }}>
                      <item.icon className="h-3.5 w-3.5" />
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>,
              document.body
            )}
          </motion.div>

          {/* 2. Notifications */}
          <motion.div layout transition={iconShift} className="relative" ref={notesRef}>
            <button
              type="button"
              data-tray-id="notifications"
              data-active={activeIcon === "notifications"}
              className="glass-tray__item glass-icon relative flex items-center justify-center"
              aria-label="Notifications"
              aria-expanded={notesOpen}
              onClick={() => {
                setActiveIcon("notifications");
                setExportOpen(false);
                setNotesOpen((open) => !open);
              }}
            >
              <Bell className="h-[18px] w-[18px]" strokeWidth={1.6} />
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#e11d48] px-1 text-[10px] font-semibold text-white">
                {NOTIFICATIONS.length}
              </span>
            </button>
            {notesOpen && (
              <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-[#e2e8f0] bg-white p-3 shadow-lg" role="region" aria-label="Notifications">
                <p className="mb-2 text-sm font-semibold text-[#0b2540]">Notifications</p>
                <ul className="space-y-2">
                  {NOTIFICATIONS.map((note) => (
                    <li key={note} className="rounded-md px-2 py-2 text-sm text-slate-600 hover:bg-[#f4f7fb]">
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>

          {/* 3. Theme switch */}
          <motion.button
            type="button"
            layout
            transition={iconShift}
            data-tray-id="theme"
            data-active={activeIcon === "theme"}
            className="glass-tray__item glass-icon flex items-center justify-center"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            onClick={() => {
              setActiveIcon("theme");
              toggleTheme();
            }}
          >
            {theme === "dark" ? <Sun className="h-[18px] w-[18px]" strokeWidth={1.6} /> : <Moon className="h-[18px] w-[18px]" strokeWidth={1.6} />}
          </motion.button>

          {/* 4. User account */}
          <motion.div
            layout
            transition={iconShift}
            data-tray-id="user"
            data-active={activeIcon === "user"}
            className="glass-tray__item glass-tray__item--account glass-icon flex items-center justify-center overflow-visible"
          >
            <AccountMenu onActivate={() => setActiveIcon("user")} />
          </motion.div>

          {/* 5. SMART launcher — hands off to the chat panel's shared logo on open */}
          <AnimatePresence initial={false}>
            {smartPanel && !smartPanel.open && !searchInBar && (
              <motion.button
                key="smart-launcher"
                type="button"
                layout
                data-tray-id="smart"
                data-active={activeIcon === "smart"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={iconShift}
                className="glass-tray__item glass-icon flex items-center justify-center"
                aria-label="Open SMART assistant"
                title="SMART"
                aria-expanded={false}
                aria-controls="smart-panel"
                onClick={() => {
                  setActiveIcon(null);
                  smartPanel.toggle();
                }}
              >
                <motion.span layoutId="smart-launcher" className="block h-6 w-6">
                  <Image src={smartLogo} alt="" width={24} height={24} className="h-6 w-6 object-contain" />
                </motion.span>
              </motion.button>
            )}
          </AnimatePresence>
        </GlassTray>
      </div>
      </div>

      {snapshotFormat && (
        <SnapshotDialog
          format={snapshotFormat}
          reportTitle={report?.title ?? report?.name ?? title ?? "Report"}
          anchor={exportAnchor}
          onClose={() => setSnapshotFormat(null)}
        />
      )}
    </header>
  );
}
