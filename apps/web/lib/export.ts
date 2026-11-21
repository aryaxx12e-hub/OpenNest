import { isNativeApp } from "./native";

const NATIVE_EXPORT_DIRECTORY = "exports";
const MAX_FILE_NAME_LENGTH = 120;

export function sanitizeExportFileName(fileName: string): string {
  const cleaned = fileName
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, MAX_FILE_NAME_LENGTH);

  return cleaned === "" ? "opennest-export" : cleaned;
}

async function writeAndShare(
  fileName: string,
  data: string,
  encoding?: "utf8"
): Promise<void> {
  const { Directory, Encoding, Filesystem } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const safeName = sanitizeExportFileName(fileName);
  const result = await Filesystem.writeFile({
    path: `${NATIVE_EXPORT_DIRECTORY}/${safeName}`,
    data,
    directory: Directory.Cache,
    recursive: true,
    ...(encoding === "utf8" ? { encoding: Encoding.UTF8 } : {}),
  });

  await Share.share({
    title: safeName,
    url: result.uri,
    dialogTitle: safeName,
  });
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = sanitizeExportFileName(fileName);
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

export async function exportTextFile(
  fileName: string,
  text: string,
  mimeType = "application/json"
): Promise<void> {
  if (isNativeApp()) {
    await writeAndShare(fileName, text, "utf8");
    return;
  }

  downloadBlob(fileName, new Blob([text], { type: mimeType }));
}

export async function exportBinaryFile(fileName: string, blob: Blob): Promise<void> {
  if (isNativeApp()) {
    await writeAndShare(fileName, await blobToBase64(blob));
    return;
  }

  downloadBlob(fileName, blob);
}
