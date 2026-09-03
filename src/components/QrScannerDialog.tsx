import { useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CameraOff, ScanLine } from "lucide-react";

interface QrScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (code: string) => void;
  title?: string;
}

// Reads QR codes and common 1D barcodes (Code128, EAN, etc.) off the device camera.
// Deliberately built on the low-level Html5Qrcode class instead of the packaged
// Html5QrcodeScanner widget so the UI matches the rest of the app.
export function QrScannerDialog({ open, onOpenChange, onDetected, title }: QrScannerDialogProps) {
  // Unique per instance so two scanner dialogs mounted at once (e.g. one per tab)
  // never fight over the same DOM element id.
  const readerElementId = `warehouse-qr-scanner-reader-${useId()}`.replace(/:/g, "");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setStarting(true);

    // Everything below is wrapped in try/catch deliberately: html5-qrcode's
    // constructor throws a *raw string* (not even an Error) synchronously if
    // its target element isn't in the DOM yet, and an exception thrown inside
    // a useEffect that escapes uncaught takes the whole React tree down with
    // it (no error boundary in this app) — i.e. exactly the "whole page goes
    // black" report this guards against, rather than a normal error message.
    const startScanning = async () => {
      try {
        // Small safety net for any dialog mount/animation timing edge case —
        // wait a couple of frames for the reader div to actually exist.
        for (let attempt = 0; attempt < 10 && !document.getElementById(readerElementId); attempt++) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        if (cancelled) return;
        if (!document.getElementById(readerElementId)) {
          throw new Error("Scanner failed to initialize — try closing and reopening this dialog");
        }

        const scanner = new Html5Qrcode(readerElementId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
          ],
          verbose: false,
        });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (cancelled) return;
            cancelled = true;
            onDetected(decodedText.trim());
            onOpenChange(false);
          },
          () => {
            // per-frame decode miss — expected constantly while aiming, ignore
          },
        );
        if (!cancelled) setStarting(false);
      } catch (err: any) {
        if (cancelled) return;
        setStarting(false);
        setError(typeof err === "string" ? err : err?.message || "Could not access camera");
      }
    };

    startScanning();

    return () => {
      cancelled = true;
      const activeScanner = scannerRef.current;
      scannerRef.current = null;
      if (activeScanner) {
        activeScanner.stop().then(() => activeScanner.clear()).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            {title || "Scan QR / Barcode"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <CameraOff className="h-8 w-8 text-red-500" />
              <p className="font-medium text-foreground">Camera unavailable</p>
              <p>{error}</p>
              <p className="text-xs">Allow camera access in your browser, or type the code manually instead.</p>
            </div>
          ) : (
            <>
              <div id={readerElementId} className="w-full overflow-hidden rounded-lg bg-black" />
              <p className="text-center text-xs text-muted-foreground">
                {starting ? "Starting camera…" : "Point the camera at the ticket's QR code or barcode"}
              </p>
            </>
          )}
          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
