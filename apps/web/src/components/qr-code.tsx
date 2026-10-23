import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** QR code gerado no próprio navegador (o segredo nunca vai a um serviço de terceiros). */
export function QrCode({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(value, { margin: 1, width: 192, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={label}
      width={192}
      height={192}
      className="rounded-md border bg-white p-1"
    />
  );
}
