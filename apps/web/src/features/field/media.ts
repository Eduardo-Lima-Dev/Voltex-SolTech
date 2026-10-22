import type { FieldGeoInput } from '@voltex/shared';

/**
 * Reduz a foto antes de guardar e enviar (lado maior de 1920 px, JPEG): economiza o plano de dados e o espaço do
 * aparelho. Redesenhar a imagem também descarta os metadados (EXIF), inclusive a localização embutida pela câmera;
 * a posição, quando existe, vai separada e só da ordem de serviço. Sem suporte do navegador, devolve o original.
 */
export async function compressImage(file: Blob, maxSide = 1920, quality = 0.8): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    return blob && blob.size > 0 ? blob : file;
  } catch {
    return file;
  }
}

/** Posição atual do aparelho, se a pessoa permitir e o GPS responder a tempo. Nunca trava a ação. */
export function getPosition(timeoutMs = 6000): Promise<FieldGeoInput | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Link para abrir o endereço no aplicativo de mapas do aparelho. */
export const mapsUrl = (order: {
  address: string | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
}): string | null => {
  if (order.siteLatitude !== null && order.siteLongitude !== null)
    return `https://www.google.com/maps/search/?api=1&query=${order.siteLatitude},${order.siteLongitude}`;
  return order.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`
    : null;
};
