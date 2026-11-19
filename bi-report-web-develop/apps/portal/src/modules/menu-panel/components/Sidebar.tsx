"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { usePortal } from "@/context/PortalContext";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { ChevronDown, Plus, Star, X } from "lucide-react";
import { ChevronsLeftIcon } from "@/modules/shared/components/animated-icons/ChevronsLeftIcon";
import { HouseIcon } from "@/modules/shared/components/animated-icons/HouseIcon";
import { SearchIcon } from "@/modules/shared/components/animated-icons/SearchIcon";
import type { PortalReport } from "@/types";
import { toggleFavorite } from "@/services/biServices";
import synergyLogo from "@/assets/synergy-logo.png";
import { reportTags } from "@/lib/catalog/report-tags";
import { useNavChrome } from "../logic/nav-chrome";
import { useAuth } from "@/modules/shared/providers/AuthProvider";
import { isAuthEnabled } from "@/lib/config";
import {
  ancestorKeysOfReport,
  buildMenuTree,
  hasCategoryHierarchy,
  type MenuNode,
} from "@/lib/catalog/category-hierarchy";

function ReportMenuItem({
  report,
  pathname,
  onToggleFavorite,
}: {
  report: PortalReport;
  pathname: string;
  onToggleFavorite: (reportId: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label={report.favorite ? "Remove from starred" : "Add to starred"}
        className={cn("shrink-0 rounded p-1 hover:bg-white/10", report.favorite && "text-amber-300")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(report.id);
        }}
      >
        <Star className={cn("h-3.5 w-3.5", report.favorite && "fill-current")} />
      </button>
      <Link
        href={`/dashboard/${report.id}`}
        className={cn(
          "min-w-0 flex-1 truncate rounded-md px-1 py-1.5 text-sm text-white/85 hover:bg-white/10 hover:text-white",
          pathname === `/dashboard/${report.id}` && "bg-[#454a85] text-white"
        )}
      >
        {report.title ?? report.name}
      </Link>
    </div>
  );
}

function CategoryNode({
  node,
  pathname,
  isOpen,
  onToggle,
  activeKeys,
  onToggleFavorite,
}: {
  node: MenuNode;
  pathname: string;
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
  activeKeys: Set<string>;
  onToggleFavorite: (reportId: string) => void;
}) {
  const open = isOpen(node.key);
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => onToggle(node.key)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-white/10",
          !open && activeKeys.has(node.key) && "bg-white/5"
        )}
      >
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")} />
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <ul className="ml-3 border-l border-white/10 pl-2">
          {node.children.map((child) => (
            <li key={child.key}>
              <CategoryNode
                node={child}
                pathname={pathname}
                isOpen={isOpen}
                onToggle={onToggle}
                activeKeys={activeKeys}
                onToggleFavorite={onToggleFavorite}
              />
            </li>
          ))}
          {node.reports.map((r) => (
            <li key={r.id}>
              <ReportMenuItem report={r} pathname={pathname} onToggleFavorite={onToggleFavorite} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { reports, isLoading, reportsError, updateReports } = usePortal();
  const auth = useAuth();
  const authOn = isAuthEnabled();
  const { open: navOpen, setOpen: setNavOpen, search, setSearch, activeTags, toggleTag, availableTags } = useNavChrome();
  const [sessionReady, setSessionReady] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSessionReady(true);
  }, []);

  const signedIn = sessionReady && auth.isAuthenticated();

  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter((r) => {
      if (q && !(r.title ?? r.name ?? "").toLowerCase().includes(q)) return false;
      if (activeTags.size === 0) return true;
      return reportTags(r).some((t) => activeTags.has(t));
    });
  }, [reports, search, activeTags]);

  const categories = useMemo(
    () => Array.from(new Set(filteredReports.map((r) => r.categoryName || "Reports"))).sort(),
    [filteredReports]
  );

  const searching = search.trim().length > 0;

  const hierarchical = useMemo(() => hasCategoryHierarchy(reports), [reports]);
  const menuTree = useMemo(
    () => (hierarchical ? buildMenuTree(filteredReports) : []),
    [hierarchical, filteredReports]
  );
  const activeReportId = pathname.startsWith("/dashboard/") ? pathname.split("/")[2] : undefined;
  const activeKeys = useMemo(() => ancestorKeysOfReport(menuTree, activeReportId), [menuTree, activeReportId]);

  const toggle = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isOpen = (key: string) => searching || (expanded[key] ?? activeKeys.has(key));

  const toggleNode = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? activeKeys.has(key)) }));
  };

  const onToggleFavorite = async (reportId: string) => {
    try {
      const next = await toggleFavorite(reportId);
      updateReports(next);
    } catch {
      // Favorite toggle failed; menu stays on previous state.
    }
  };

  const starredReports = useMemo(
    () => filteredReports.filter((r) => r.favorite),
    [filteredReports]
  );

  const liquid = { duration: 0.72, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <motion.div
      className="relative z-50 h-screen w-0 shrink-0"
      initial={false}
      animate={{ width: navOpen ? 280 : 0 }}
      transition={liquid}
    >
    <div className="h-full overflow-hidden">
    <motion.aside
      className="portal-sidebar invisible flex h-full w-[280px] translate-y-full flex-col bg-[#333869] text-white"
      initial={false}
      animate={
        navOpen
          ? { y: "0%", visibility: "visible" }
          : { y: "105%", transitionEnd: { visibility: "hidden" } }
      }
      transition={liquid}
      aria-hidden={!navOpen}
    >
      <div className="border-b border-white/10 p-4">
        <div className="relative z-40 flex items-center gap-2">
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2 text-white" title="BI Portal">
            {navOpen ? (
              <motion.span layoutId="portal-brand" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" transition={{ layout: liquid }}>
                <Image src={synergyLogo} alt="" width={28} height={28} className="h-7 w-7 object-contain" />
              </motion.span>
            ) : (
              <span className="h-9 w-9 shrink-0" />
            )}
            <span className="truncate text-lg font-semibold">BI Portal</span>
          </Link>
          <Link
              href="/dashboard"
              aria-label="Home"
              title="Home"
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15",
                pathname === "/dashboard" && "bg-white/15"
              )}
            >
              <HouseIcon size={16} className="portal-animated-icon portal-sidebar-nav-icon text-white" />
            </Link>
        </div>
        <div className="relative mt-3">
          <SearchIcon size={16} className="portal-animated-icon absolute left-2 top-2 z-[1] text-white/60" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reports…"
            className="w-full rounded-md border border-white/10 bg-[#2a2e58] py-2 pl-8 pr-2 text-sm text-white placeholder:text-white/50 focus:border-white/40 focus:outline-none"
            aria-label="Search reports"
          />
        </div>
        <div className="mt-2 flex flex-col gap-1 rounded-md border border-white/5 bg-black/15 px-1.5 py-1.5">
            {activeTags.size > 0 && (
              <div className="flex flex-wrap gap-1 border-b border-white/5 pb-1" aria-live="polite">
                {Array.from(activeTags).sort().map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-0.5 rounded-full border border-emerald-300/45 bg-emerald-300/20 py-px pl-1.5 pr-0.5 text-[10px] font-semibold text-emerald-50">
                    {tag}
                    <button type="button" aria-label={`Remove ${tag} tag`} className="rounded-full p-px hover:bg-black/15" onClick={() => toggleTag(tag)}>
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto">
              {availableTags.filter((tag) => !activeTags.has(tag)).map((tag) => (
                <span key={tag} className="inline-flex items-center gap-0.5 rounded-full border border-slate-300/30 bg-slate-300/10 py-px pl-1.5 pr-0.5 text-[10px] font-semibold text-slate-300">
                  {tag}
                  <button type="button" aria-label={`Add ${tag} tag`} className="rounded-full p-px hover:bg-black/20" onClick={() => toggleTag(tag)}>
                    <Plus className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {isLoading && <p className="px-3 py-2 text-xs text-white/60">Loading reports…</p>}

        {!isLoading && filteredReports.length === 0 && (
          <div className="mt-2 px-3 text-xs text-white/60">
            {reportsError ??
              (signedIn
                ? "No reports for your account in synergy_bi_reports."
                : "Sign in to load your report catalog.")}
            {!signedIn && (
              <Link href="/login" className="mt-2 block text-white underline-offset-2 hover:underline">
                Sign in
              </Link>
            )}
          </div>
        )}

        {starredReports.length > 0 && (
          <div className="mb-2">
            <button
              type="button"
              onClick={() => toggle("__starred__")}
              className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-white/10"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform",
                  !(searching || expanded.__starred__) && "-rotate-90"
                )}
              />
              Starred
            </button>
            {(searching || expanded.__starred__) && (
              <ul className="ml-3 border-l border-white/10 pl-2">
                {starredReports.map((r) => (
                  <li key={`star-${r.id}`}>
                    <ReportMenuItem report={r} pathname={pathname} onToggleFavorite={onToggleFavorite} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {hierarchical && menuTree.map((node) => (
          <CategoryNode
            key={node.key}
            node={node}
            pathname={pathname}
            isOpen={isOpen}
            onToggle={toggleNode}
            activeKeys={activeKeys}
            onToggleFavorite={onToggleFavorite}
          />
        ))}

        {!hierarchical && categories.map((cat) => (
          <div key={cat} className="mb-1">
            <button
              type="button"
              onClick={() => toggle(cat)}
              className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-white/10"
            >
              <ChevronDown
                className={cn("h-4 w-4 shrink-0 transition-transform", !(searching || expanded[cat]) && "-rotate-90")}
              />
              {cat}
            </button>
            {(searching || expanded[cat]) && (
              <ul className="ml-3 border-l border-white/10 pl-2">
                {filteredReports
                  .filter((r) => (r.categoryName || "Reports") === cat)
                  .map((r) => (
                    <li key={r.id}>
                      <ReportMenuItem report={r} pathname={pathname} onToggleFavorite={onToggleFavorite} />
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ))}

      </nav>

      {!signedIn && !authOn && (
        <Link
          href="/login"
          className="border-t border-white/10 p-4 text-sm text-white hover:underline"
        >
          Sign in
        </Link>
      )}
    </motion.aside>
    </div>
    {navOpen && (
      <button
        type="button"
        className="absolute right-0 top-1/2 z-30 flex h-7 w-7 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border border-white/20 bg-[#454a85] text-white shadow"
        aria-label="Close report menu"
        onClick={() => setNavOpen(false)}
      >
        <ChevronsLeftIcon size={14} className="portal-animated-icon portal-sidebar-nav-icon text-white" />
      </button>
    )}
    </motion.div>
  );
}
