"use client";

import { useCallback, useEffect, useState } from "react";

type Proposal = {
  id: string;
  author?: string;
  reason?: string;
  status?: string;
  glossary_add?: unknown[];
  ontology_add?: Record<string, unknown>;
  eval_cases_add?: unknown[];
  evidence?: unknown[];
};

async function api(path: string, init?: RequestInit) {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const headers: HeadersInit = { ...(init?.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (init?.body) headers["Content-Type"] = "application/json";
  return fetch(path, { ...init, headers });
}

export default function SmartLearningAdminPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api("/api/admin/smart-learning");
    const data = (await res.json()) as { proposals?: Proposal[]; message?: string };
    if (!res.ok) {
      setMessage(data.message || "Could not load proposals");
      return;
    }
    setProposals(data.proposals || []);
    setMessage(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await api("/api/admin/smart-learning", { method: "POST" });
      const data = await res.json();
      setMessage(data.status === "ok" ? `Draft ${data.proposal?.id} created` : data.message || JSON.stringify(data));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const apply = async (id: string) => {
    setBusy(true);
    try {
      const res = await api(`/api/admin/smart-learning/${encodeURIComponent(id)}/apply`, { method: "POST" });
      const data = await res.json();
      setMessage(res.ok ? `Applied ${id}` : JSON.stringify(data.errors || data));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const reject = async (id: string) => {
    const reason = window.prompt("Rejection reason?");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const res = await api(`/api/admin/smart-learning/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      setMessage(res.ok ? `Rejected ${id}` : JSON.stringify(data));
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-[#333869]">SMART learning proposals</h1>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-[#333869] px-3 py-1.5 text-sm text-white disabled:opacity-50"
          onClick={() => void generate()}
        >
          Generate from analytics
        </button>
      </div>
      {message && <p className="text-sm text-slate-600">{message}</p>}
      <ul className="space-y-3">
        {proposals.map((p) => (
          <li key={p.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-slate-800">{p.id}</p>
                <p className="text-xs text-slate-500">{p.status || "draft"} · {p.author}</p>
                <p className="mt-1 text-sm text-slate-700">{p.reason}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || p.status === "applied"}
                  className="rounded border border-emerald-600 px-2 py-1 text-xs text-emerald-700 disabled:opacity-40"
                  onClick={() => void apply(p.id)}
                >
                  Approve & apply
                </button>
                <button
                  type="button"
                  disabled={busy || p.status === "rejected"}
                  className="rounded border border-rose-400 px-2 py-1 text-xs text-rose-700 disabled:opacity-40"
                  onClick={() => void reject(p.id)}
                >
                  Reject
                </button>
              </div>
            </div>
            {p.ontology_add && (
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[10px]">{JSON.stringify(p.ontology_add, null, 2)}</pre>
            )}
          </li>
        ))}
      </ul>
      {!proposals.length && <p className="text-sm text-slate-500">No draft proposals yet.</p>}
    </div>
  );
}