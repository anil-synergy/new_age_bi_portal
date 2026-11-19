"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Building2, FileText, FolderTree, GraduationCap, Layers, LogOut, Users } from "lucide-react";
import type { StaticImageData } from "next/image";
import { usePortal } from "@/context/PortalContext";
import { useAuth } from "@/modules/shared/providers/AuthProvider";
import { canConfigurePortal } from "@/lib/auth/portal-access";
import { cn } from "@/lib/utils";

const AVATAR_STORAGE_KEY = "portal.profile.avatar";

interface AvatarOption {
  id: string;
  image: StaticImageData;
  label: string;
}

function labelFromFile(id: string): string {
  const words = id.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** Every PNG in src/assets/Userprofile_Icons, so newly added files appear without a code change. */
function loadAvatars(): AvatarOption[] {
  const context = (
    require as unknown as {
      context: (
        directory: string,
        useSubdirectories: boolean,
        regExp: RegExp
      ) => { keys(): string[]; (id: string): { default?: StaticImageData } & StaticImageData };
    }
  ).context("../../../assets/Userprofile_Icons", false, /\.png$/);

  return context
    .keys()
    .map((key) => {
      const id = key.replace(/^\.\//, "").replace(/\.png$/i, "");
      const loaded = context(key);
      const image = loaded.default?.src ? loaded.default : loaded;
      return { id, image, label: labelFromFile(id) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

const AVATARS = loadAvatars();

function readStoredAvatar(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const id = window.localStorage.getItem(AVATAR_STORAGE_KEY);
    return AVATARS.some((avatar) => avatar.id === id) ? id : null;
  } catch {
    return null;
  }
}

const ADMIN_LINKS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/reports", label: "Reports", icon: FileText },
  { href: "/admin/groups", label: "Groups", icon: FolderTree },
  { href: "/admin/categories", label: "Categories", icon: FolderTree },
  { href: "/admin/departments", label: "Departments", icon: Building2 },
  { href: "/admin/display-reports", label: "Display Reports", icon: Layers },
  { href: "/admin/smart-learning", label: "SMART Learning", icon: GraduationCap },
];

interface AccountMenuProps {
  onActivate?: () => void;
}

export function AccountMenu({ onActivate }: AccountMenuProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isSuperAdmin, isDepAdmin, userInfo } = usePortal();
  const auth = useAuth();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAvatarId(readStoredAvatar());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !trayRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setPickerOpen(false);
  }, [pathname]);

  const avatar = AVATARS.find((item) => item.id === avatarId) ?? null;
  const showAvatar = Boolean(avatar) && !avatarBroken;

  const chooseAvatar = (id: string) => {
    setAvatarBroken(false);
    setAvatarId(id);
    setPickerOpen(false);
    try {
      window.localStorage.setItem(AVATAR_STORAGE_KEY, id);
    } catch {
      // The choice still shows for this visit.
    }
  };

  const signedIn = ready && auth.isAuthenticated();
  const canConfigure = canConfigurePortal(userInfo, { isSuperAdmin, isDepAdmin });
  const initials = useMemo(() => {
    const name = (userInfo?.name ?? userInfo?.email?.split("@")[0] ?? "").trim();
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return "AC";
  }, [userInfo?.name, userInfo?.email]);

  const menuWidth = pickerOpen ? 320 : 224;

  return (
    <div className="relative" ref={buttonRef}>
      <button
        type="button"
        className={cn(
          "relative flex h-full w-full min-h-[28px] min-w-[28px] justify-center overflow-visible rounded-[11px] bg-transparent text-[11px] font-semibold text-current",
          signedIn && showAvatar && avatar ? "items-end" : "items-center",
        )}
        title={signedIn ? userInfo?.email ?? "Account" : "Sign in"}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          onActivate?.();
          if (!signedIn) {
            router.push("/login");
            return;
          }
          setPickerOpen(false);
          setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
          setOpen((current) => !current);
        }}
      >
        {signedIn && showAvatar && avatar ? (
          <Image
            src={avatar.image}
            alt=""
            width={32}
            height={32}
            onError={() => setAvatarBroken(true)}
            className="pointer-events-none absolute bottom-0 left-1/2 h-10 w-10 max-w-none -translate-x-1/2 object-contain object-bottom drop-shadow-[0_5px_4px_rgba(15,23,42,0.35)]"
          />
        ) : signedIn ? (
          initials
        ) : (
          "?"
        )}
      </button>
      {open && anchor && createPortal(
        <div
          ref={trayRef}
          role="menu"
          className="fixed z-[100001] rounded-md border border-[#e2e8f0] bg-white py-1 text-[#0b2540] shadow-xl"
          style={{
            top: anchor.bottom + 8,
            width: menuWidth,
            left: Math.max(8, Math.min(anchor.right - menuWidth, window.innerWidth - menuWidth - 8)),
          }}
        >
          <div className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
            <p className="min-w-0 flex-1 truncate text-xs text-slate-500">{userInfo?.email ?? "Signed in"}</p>
            <button
              type="button"
              className="relative flex h-8 w-8 shrink-0 items-end justify-center overflow-visible rounded-full hover:bg-[#f4f7fb]"
              aria-label="Choose profile avatar"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((current) => !current)}
            >
              {showAvatar && avatar ? (
                <Image
                  src={avatar.image}
                  alt=""
                  width={32}
                  height={32}
                  className="pointer-events-none absolute bottom-0 left-1/2 h-8 w-8 max-w-none -translate-x-1/2 -translate-y-0.5 object-contain object-bottom"
                />
              ) : (
                <span className="mb-1.5 text-[10px] font-semibold text-[#0b2540]">{initials}</span>
              )}
            </button>
          </div>
          {pickerOpen && (
            <div className="mx-2 mb-1 grid max-h-52 grid-cols-6 gap-1 overflow-y-auto rounded-md bg-[#f4f7fb] p-1.5" role="listbox" aria-label="Profile avatars">
              {AVATARS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === avatarId}
                  aria-label={item.label}
                  title={item.label}
                  className={cn(
                    "flex h-11 w-full items-end justify-center rounded-md px-0.5 pb-0.5 pt-1.5 hover:bg-white",
                    item.id === avatarId && "bg-white ring-1 ring-[#1aa6a0]"
                  )}
                  onClick={() => chooseAvatar(item.id)}
                >
                  <Image src={item.image} alt="" width={28} height={28} className="h-7 w-7 object-contain object-bottom" />
                </button>
              ))}
            </div>
          )}
          {canConfigure && (
            <>
              {ADMIN_LINKS.map((link) => (
                <button
                  key={link.href}
                  type="button"
                  role="menuitem"
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[#f4f7fb]",
                    pathname.startsWith(link.href) && "bg-[#f4f7fb] font-medium"
                  )}
                  onClick={() => {
                    setOpen(false);
                    router.push(link.href);
                  }}
                >
                  <link.icon className="h-4 w-4" /> {link.label}
                </button>
              ))}
            </>
          )}
          <div className="my-1 border-t border-[#e2e8f0]" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-[#f4f7fb]"
            onClick={() => auth.logout()}
          >
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
