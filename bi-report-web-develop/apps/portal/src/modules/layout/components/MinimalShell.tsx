"use client";

interface MinimalShellProps {
  children: React.ReactNode;
  title?: string;
}

export function MinimalShell({ children, title = "Synergy BI Portal" }: MinimalShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b bg-white px-6 py-4 shadow-sm">
        <h1 className="text-lg font-bold text-primary">{title}</h1>
        <p className="text-xs text-slate-500">Power BI report viewer — Azure Function embed</p>
      </header>
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
