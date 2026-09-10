/** Injected by Vite's `define` from webapp/package.json's version. */
declare const __APP_VERSION__: string;

/** BarcodeDetector is not in TypeScript's DOM lib yet. Chrome on Android —
    the only place live scanning is supported — has shipped it since 83.
    Everything else falls back to manual ISBN entry (see ScanMode). */
declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  static getSupportedFormats(): Promise<string[]>;
  detect(source: CanvasImageSource | Blob | ImageData): Promise<{
    rawValue: string;
    format: string;
    boundingBox: DOMRectReadOnly;
    cornerPoints: { x: number; y: number }[];
  }[]>;
}

/* Camera capabilities the DOM lib does not model.

   Torch, zoom and points-of-interest focus are all in the MediaStream Image
   Capture spec and shipped in Chrome/Android, but TypeScript's lib.dom only
   carries the older core set. Declared here rather than cast at each call
   site, so the scanner's constraint objects stay type-checked. */
interface MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
}

interface MediaTrackSettings {
  torch?: boolean;
  zoom?: number;
}

interface MediaTrackConstraintSet {
  torch?: boolean;
  zoom?: number;
  focusMode?: string;
  pointsOfInterest?: { x: number; y: number }[];
}
