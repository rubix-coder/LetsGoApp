/* JS side of the tiny PrinterPlugin (android/…/PrinterPlugin.java): renders an
   HTML document through Android's PrintManager, whose dialog offers "Save as
   PDF" — the native stand-in for the webapp's hidden-iframe window.print(). */

import { registerPlugin } from "@capacitor/core";

interface PrinterPlugin {
  print(options: { html: string; name?: string }): Promise<void>;
}

const Printer = registerPlugin<PrinterPlugin>("Printer");

export async function printHtml(html: string, name = "LetsGo"): Promise<void> {
  await Printer.print({ html, name });
}
