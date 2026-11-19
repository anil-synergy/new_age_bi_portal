"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { Upload, FileText, Clipboard } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/modules/shared/components/ui/tabs";
import type { BulkUserRow } from "@/types";
import { bulkImportUsers } from "@/services/biServices";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRow(row: Partial<BulkUserRow>): BulkUserRow {
  const errors: string[] = [];
  if (!row.email || !EMAIL_REGEX.test(row.email)) errors.push("Invalid email");
  if (!row.fullName?.trim()) errors.push("Full name required");
  return {
    email: row.email ?? "",
    fullName: row.fullName ?? "",
    role: row.role ?? "",
    groups: row.groups ?? "",
    valid: errors.length === 0,
    errors,
  };
}

function parseTextInput(text: string): BulkUserRow[] {
  const lines = text.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(/\t|,/);
    if (parts.length >= 2) {
      return validateRow({ email: parts[0].trim(), fullName: parts[1].trim(), role: parts[2]?.trim(), groups: parts[3]?.trim() });
    }
    if (EMAIL_REGEX.test(line)) {
      return validateRow({ email: line, fullName: line.split("@")[0] });
    }
    return validateRow({ email: "", fullName: line, errors: ["Could not parse line"] } as BulkUserRow);
  });
}

function parseExcel(buffer: ArrayBuffer): BulkUserRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);
  return rows.map((r) =>
    validateRow({
      email: r.email ?? r.Email ?? r.EMAIL ?? "",
      fullName: r.fullName ?? r.name ?? r.Name ?? r["Full Name"] ?? "",
      role: r.role ?? r.Role ?? "",
      groups: r.groups ?? r.Groups ?? "",
    })
  );
}

async function parseWord(file: File): Promise<BulkUserRow[]> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const emails = result.value.match(/[^\s@]+@[^\s@]+\.[^\s@]+/g) ?? [];
  return emails.map((email) => validateRow({ email, fullName: email.split("@")[0] }));
}

interface BulkUserImportProps {
  onComplete?: () => void;
}

export function BulkUserImport({ onComplete }: BulkUserImportProps) {
  const [rows, setRows] = useState<BulkUserRow[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExcel = async (file: File) => {
    const buffer = await file.arrayBuffer();
    setRows(parseExcel(buffer));
  };

  const handleImport = async () => {
    const valid = rows.filter((r) => r.valid);
    if (!valid.length) return;
    setImporting(true);
    try {
      const res = await bulkImportUsers(valid);
      setResult({ success: res.success ?? valid.length, failed: res.failed ?? 0 });
      onComplete?.();
    } catch {
      setResult({ success: 0, failed: valid.length });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="excel">
        <TabsList>
          <TabsTrigger value="excel"><Upload className="mr-1 h-3 w-3" />Excel</TabsTrigger>
          <TabsTrigger value="word"><FileText className="mr-1 h-3 w-3" />Word</TabsTrigger>
          <TabsTrigger value="paste"><Clipboard className="mr-1 h-3 w-3" />Paste</TabsTrigger>
        </TabsList>
        <TabsContent value="excel" className="space-y-2">
          <Input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && handleExcel(e.target.files[0])} />
          <p className="text-xs text-slate-500">Columns: email, fullName, role, groups</p>
        </TabsContent>
        <TabsContent value="word" className="space-y-2">
          <Input type="file" accept=".docx,.doc" onChange={(e) => e.target.files?.[0] && parseWord(e.target.files[0]).then(setRows)} />
          <p className="text-xs text-slate-500">Extracts email addresses from document text</p>
        </TabsContent>
        <TabsContent value="paste" className="space-y-2">
          <textarea
            className="w-full rounded border p-2 text-sm"
            rows={5}
            placeholder="Paste emails or CSV rows (email, name, role, groups)"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <Button size="sm" onClick={() => setRows(parseTextInput(pasteText))}>Parse</Button>
        </TabsContent>
      </Tabs>

      {rows.length > 0 && (
        <div className="max-h-48 overflow-auto rounded border">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-2 text-left">Email</th>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.valid ? "" : "bg-red-50"}>
                  <td className="p-2">{r.email}</td>
                  <td className="p-2">{r.fullName}</td>
                  <td className="p-2">{r.valid ? "✓" : r.errors.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={handleImport} disabled={importing || !rows.some((r) => r.valid)}>
          {importing ? "Importing…" : `Import ${rows.filter((r) => r.valid).length} users`}
        </Button>
        {result && (
          <span className="text-sm text-slate-600">
            {result.success} succeeded, {result.failed} failed
          </span>
        )}
      </div>
    </div>
  );
}
