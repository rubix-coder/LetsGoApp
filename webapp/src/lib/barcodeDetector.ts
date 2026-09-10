/* Getting a working BarcodeDetector in every browser.

   Chrome on Android ships one natively, which is the fast path and costs
   nothing. Firefox and Safari do not, so those fall back to a WASM ponyfill
   with the identical API — same constructor, same static getSupportedFormats,
   same detect(), same "ean_13" format string.

   The ponyfill is loaded with a dynamic import so browsers that have the
   native implementation never download it. That matters: the WASM decoder is
   the single largest asset in the app, and the phone this was built for is
   exactly the case that does not need it. */

type Detector = {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
};

export type DetectorSource = "native" | "wasm";

export interface DetectorHandle {
  detector: Detector;
  source: DetectorSource;
}

/** Resolved once per page load — the WASM module is expensive to instantiate
    and there is no reason to do it twice. */
let ponyfillPromise: Promise<typeof import("barcode-detector/ponyfill")> | null = null;

async function loadPonyfill() {
  if (!ponyfillPromise) {
    ponyfillPromise = (async () => {
      const mod = await import("barcode-detector/ponyfill");
      // Point the decoder at the WASM we bundle rather than the CDN it
      // reaches for by default. This app is local-first and is served from a
      // private host, so a third-party fetch would fail exactly when someone
      // is cataloguing a shelf offline.
      const { prepareZXingModule } = await import("zxing-wasm/reader");
      const wasmUrl = (await import("zxing-wasm/reader/zxing_reader.wasm?url")).default;
      prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) =>
            path.endsWith(".wasm") ? wasmUrl : prefix + path,
        },
      });
      return mod;
    })();
  }
  return ponyfillPromise;
}

/** A detector that can read EAN-13, or null when this browser cannot at all. */
export async function createBarcodeDetector(): Promise<DetectorHandle | null> {
  const formats = ["ean_13"] as const;

  if (typeof BarcodeDetector !== "undefined") {
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      if (supported.includes("ean_13")) {
        return { detector: new BarcodeDetector({ formats: [...formats] }), source: "native" };
      }
      // Present but cannot read book barcodes — fall through to the ponyfill
      // rather than giving up, which is what a bare capability check would do.
    } catch {
      // Treat a broken native implementation as absent.
    }
  }

  try {
    const { BarcodeDetector: Ponyfill } = await loadPonyfill();
    return { detector: new Ponyfill({ formats: [...formats] }), source: "wasm" };
  } catch {
    return null;
  }
}
