import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { assertLocalWindows, runPowerShellFile } from "@/lib/outlook/local-windows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMPOSE_SCRIPT = String.raw`
param([string]$Manifest)
$spec = Get-Content -Raw -Path $Manifest | ConvertFrom-Json
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.Subject = [string]$spec.subject
$mail.Body = "Please find the report attached."
try {
  if ($spec.kind -eq "images") {
    $parts = New-Object System.Collections.Generic.List[string]
    $index = 0
    foreach ($image in @($spec.images)) {
      $index++
      $cid = "page$index"
      $attachment = $mail.Attachments.Add([string]$image.path)
      $attachment.PropertyAccessor.SetProperty("http://schemas.microsoft.com/mapi/proptag/0x3712001F", $cid)
      $parts.Add("<p style='margin:0 0 16px'><img src='cid:$cid' style='max-width:100%;height:auto'></p>")
    }
    if ($parts.Count -gt 0) {
      $mail.HTMLBody = "<html><body>" + ($parts -join "") + "</body></html>"
    }
  } elseif ($spec.file) {
    $null = $mail.Attachments.Add([string]$spec.file)
  }
} catch {
}
$mail.Display()
try { $mail.GetInspector().Activate() } catch {}
Write-Output "displayed"
while ($true) {
  Start-Sleep -Milliseconds 500
  try {
    if (-not $mail.GetInspector().Visible) { break }
  } catch {
    break
  }
}
`;

function safeFileName(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "report").slice(0, 80);
}

export async function POST(request: Request) {
  let directory = "";
  try {
    assertLocalWindows(request);
    const body = (await request.json()) as {
      subject?: string;
      kind?: string;
      fileName?: string;
      bytesBase64?: string;
      images?: { jpegBase64?: string }[];
    };
    const subject = (body.subject || "Report").slice(0, 180);
    directory = await mkdtemp(path.join(tmpdir(), "bi-portal-mail-"));
    const manifestPath = path.join(directory, "mail.json");

    if (body.kind === "images") {
      const images = body.images ?? [];
      if (!images.length) return Response.json({ message: "There are no pages to put in the email." }, { status: 400 });
      const files: { path: string }[] = [];
      for (let index = 0; index < images.length; index += 1) {
        const encoded = images[index]?.jpegBase64 ?? "";
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
          return Response.json({ message: "A report snapshot was incomplete." }, { status: 400 });
        }
        const filePath = path.join(directory, `page-${index + 1}.jpg`);
        await writeFile(filePath, bytes);
        files.push({ path: filePath });
      }
      await writeFile(manifestPath, JSON.stringify({ kind: "images", subject, images: files }));
    } else if (body.kind === "file") {
      const encoded = body.bytesBase64 ?? "";
      const bytes = Buffer.from(encoded, "base64");
      if (!bytes.length) return Response.json({ message: "The report file was empty." }, { status: 400 });
      const filePath = path.join(directory, safeFileName(body.fileName || "report"));
      await writeFile(filePath, bytes);
      await writeFile(manifestPath, JSON.stringify({ kind: "file", subject, file: filePath }));
    } else {
      return Response.json({ message: "The email content was not recognised." }, { status: 400 });
    }

    await runPowerShellFile(COMPOSE_SCRIPT, [manifestPath]);
    const mailDir = directory;
    directory = "";
    setTimeout(() => {
      void rm(mailDir, { recursive: true, force: true });
    }, 20000);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outlook could not be opened.";
    return Response.json({ message }, { status: 500 });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
