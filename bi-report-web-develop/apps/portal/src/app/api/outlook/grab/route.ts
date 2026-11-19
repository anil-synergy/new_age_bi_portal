import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { assertLocalWindows, runPowerShell } from "@/lib/outlook/local-windows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRAB_SCRIPT = `
Add-Type -AssemblyName System.Drawing
$x = [int]$env:SNAP_X
$y = [int]$env:SNAP_Y
$w = [int]$env:SNAP_W
$h = [int]$env:SNAP_H
$bitmap = New-Object System.Drawing.Bitmap $w, $h
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$bitmap.Save($env:SNAP_OUT, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$graphics.Dispose()
$bitmap.Dispose()
`;

export async function POST(request: Request) {
  try {
    assertLocalWindows(request);
    const body = (await request.json()) as { x?: number; y?: number; width?: number; height?: number };
    const x = Number(body.x);
    const y = Number(body.y);
    const width = Number(body.width);
    const height = Number(body.height);
    if (![x, y, width, height].every((value) => Number.isFinite(value))) {
      return Response.json({ message: "The report canvas position was not available." }, { status: 400 });
    }
    if (width < 1 || height < 1 || width > 8000 || height > 8000) {
      return Response.json({ message: "The report canvas size could not be captured." }, { status: 400 });
    }

    const directory = await mkdtemp(path.join(tmpdir(), "bi-portal-snap-"));
    const outFile = path.join(directory, "canvas.jpg");
    try {
      await runPowerShell(GRAB_SCRIPT, {
        SNAP_X: String(Math.round(x)),
        SNAP_Y: String(Math.round(y)),
        SNAP_W: String(Math.round(width)),
        SNAP_H: String(Math.round(height)),
        SNAP_OUT: outFile,
      });
      const jpeg = await readFile(outFile);
      return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg" } });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not capture the report canvas.";
    return Response.json({ message }, { status: 500 });
  }
}
