import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

export interface SignaturePadHandle {
  /** Imagem PNG da assinatura, ou `null` se nada foi desenhado. */
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
  isEmpty: () => boolean;
}

/** Área para o cliente assinar com o dedo ou o mouse. Desenha em um canvas e entrega a imagem PNG. */
export function SignaturePad({
  handle,
  onChange,
  label = 'Assinatura do cliente',
}: {
  handle?: Ref<SignaturePadHandle>;
  onChange?: (empty: boolean) => void;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const setEmptyState = useCallback(
    (value: boolean) => {
      setEmpty(value);
      onChange?.(value);
    },
    [onChange],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 160;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);
    context.lineWidth = 2.2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111827';
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
    // Um toque sem arrastar vira um ponto.
    context.lineTo(x + 0.01, y + 0.01);
    context.stroke();
    setEmptyState(false);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
    setEmptyState(true);
  }, [setEmptyState]);

  useImperativeHandle(
    handle,
    () => ({
      clear,
      isEmpty: () => empty,
      toBlob: () =>
        new Promise((resolve) => {
          const canvas = canvasRef.current;
          if (!canvas || empty) return resolve(null);
          canvas.toBlob((blob) => resolve(blob), 'image/png');
        }),
    }),
    [clear, empty],
  );

  return (
    <div className="grid gap-2">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="h-40 w-full touch-none rounded-md border border-dashed bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      <button
        type="button"
        onClick={clear}
        disabled={empty}
        className="justify-self-start text-sm text-primary underline-offset-2 hover:underline disabled:opacity-50"
      >
        Limpar assinatura
      </button>
    </div>
  );
}
