/* Saving a generated file, on both shells.

   Web: the Blob + <a download> pattern — a real download, no questions asked.
   Native: an Android WebView silently ignores that pattern (no DownloadListener
   is installed), so the file is written to the app cache and handed to the
   system share sheet instead — from there it can go to Files ("save to
   device"), Drive, mail, another app. Same bytes either way. */

import { isNative } from "./native/platform";

export async function saveTextFile(filename: string, mime: string, text: string): Promise<void> {
  if (isNative) {
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      await Share.share({ title: filename, url: uri });
    } catch {
      /* Share sheet dismissed — the write itself succeeded; nothing to do. */
    }
    return;
  }

  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
