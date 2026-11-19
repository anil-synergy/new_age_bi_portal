function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(index, index + 0x8000)));
  }
  return btoa(binary);
}

async function postOutlook(body: unknown) {
  const response = await fetch("/api/outlook/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  }).catch((error: Error) => {
    throw new Error(error.name === "TimeoutError" ? "Outlook did not open in time. Check that Outlook is installed and not showing a dialog." : error.message);
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(data.message || "Outlook could not be opened.");
}

export function openOutlookWithSnapshots(input: { subject: string; images: { jpeg: Uint8Array }[] }) {
  return postOutlook({
    kind: "images",
    subject: input.subject,
    images: input.images.map((image) => ({ jpegBase64: bytesToBase64(image.jpeg) })),
  });
}

export function openOutlookWithAttachment(input: { subject: string; fileName: string; bytes: Uint8Array }) {
  return postOutlook({
    kind: "file",
    subject: input.subject,
    fileName: input.fileName,
    bytesBase64: bytesToBase64(input.bytes),
  });
}
