import { ArrowLeft, Camera, MapPin, Phone } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { FIELD_ISSUE_TYPES, type FieldIssueType } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  toast,
} from '@voltex/ui';
import { formatDateTime } from '@/lib/format';
import {
  FIELD_ISSUE_TYPE_LABELS,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TYPE_LABELS,
} from '../operations/labels';
import { fileOf } from './field-db';
import type { FieldViewOrder } from './field-engine';
import { useField } from './field-provider';
import { compressImage, mapsUrl } from './media';
import { SignaturePad, type SignaturePadHandle } from './signature-pad';

function IssueDialog({
  order,
  open,
  onClose,
}: {
  order: FieldViewOrder;
  open: boolean;
  onClose: () => void;
}) {
  const { engine } = useField();
  const [type, setType] = useState<FieldIssueType>('OTHER');
  const [description, setDescription] = useState('');
  const [blocking, setBlocking] = useState(true);
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pendência</DialogTitle>
          <DialogDescription>
            Uma pendência que bloqueia pára a instalação até a operação resolver.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="fi-type">Tipo</Label>
            <NativeSelect
              id="fi-type"
              value={type}
              onChange={(e) => setType(e.target.value as FieldIssueType)}
            >
              {FIELD_ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_ISSUE_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fi-desc">O que aconteceu</Label>
            <Input
              id="fi-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={blocking}
              onChange={(e) => setBlocking(e.target.checked)}
            />
            Bloqueia a instalação
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={description.trim().length < 3}
            onClick={() => {
              void engine.act(order.id, {
                type: 'ISSUE',
                issueType: type,
                description: description.trim(),
                blocking,
              });
              setDescription('');
              onClose();
            }}
          >
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Miniatura de uma foto ainda não enviada (a partir dos bytes guardados no aparelho). */
function PendingThumb({ photo }: { photo: FieldViewOrder['pendingPhotos'][number] }) {
  const url = useMemo(() => URL.createObjectURL(fileOf(photo)), [photo]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <li className="relative">
      <img
        src={url}
        alt={photo.caption ?? 'Foto aguardando envio'}
        className="aspect-square w-full rounded-md object-cover"
      />
      <Badge variant="yellow" className="absolute bottom-1 left-1">
        Aguardando envio
      </Badge>
    </li>
  );
}

/** Ordem de serviço em campo: iniciar, checklist, fotos, pendências, anotações, assinatura e concluir. */
export function FieldOrderPage() {
  const { id = '' } = useParams();
  const { engine, state } = useField();
  const order = state.orders.find((o) => o.id === id);
  const [note, setNote] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);
  const [signedBy, setSignedBy] = useState('');
  const [padEmpty, setPadEmpty] = useState(true);
  const pad = useRef<SignaturePadHandle>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  if (!order)
    return (
      <div className="space-y-4">
        <Link
          to="/campo"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Ordens
        </Link>
        <p className="text-sm text-muted-foreground">
          Esta ordem não está neste aparelho. Conecte-se à internet para atualizar a lista.
        </p>
      </div>
    );

  const closed = order.status === 'DONE' || order.status === 'CANCELLED';
  const running = order.status === 'IN_PROGRESS';
  const maps = mapsUrl(order);
  const blockingOpen = order.openIssues.some((i) => i.blocking);

  const onPhotos = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        await engine.addPhoto(order.id, await compressImage(file));
      } catch {
        toast.error('Não foi possível guardar a foto.');
      }
    }
    if (photoInput.current) photoInput.current.value = '';
  };

  const saveSignature = async () => {
    const blob = await pad.current?.toBlob();
    if (!blob) return;
    await engine.saveSignature(order.id, blob, signedBy.trim());
    pad.current?.clear();
    setSignedBy('');
    toast.success('Assinatura guardada.');
  };

  return (
    <div className="space-y-4">
      <Link
        to="/campo"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Ordens
      </Link>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-lg">{order.title}</CardTitle>
            <Badge variant={running ? 'green' : order.status === 'DONE' ? 'green' : 'secondary'}>
              {WORK_ORDER_STATUS_LABELS[order.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {WORK_ORDER_TYPE_LABELS[order.type]}
            {order.projectCode ? ` · ${order.projectCode}` : ''}
            {order.crewName ? ` · ${order.crewName}` : ''}
          </p>
          {order.scheduledStart ? (
            <p className="text-sm">{formatDateTime(order.scheduledStart)}</p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {order.accountName ? <div className="font-medium">{order.accountName}</div> : null}
          {order.address ? (
            <div className="flex items-start gap-1">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{order.address}</span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {maps ? (
              <Button asChild size="sm" variant="outline">
                <a href={maps} target="_blank" rel="noreferrer">
                  <MapPin aria-hidden="true" /> Abrir no mapa
                </a>
              </Button>
            ) : null}
            {order.contactPhone ? (
              <Button asChild size="sm" variant="outline">
                <a href={`tel:${order.contactPhone.replace(/[^\d+]/g, '')}`}>
                  <Phone aria-hidden="true" /> Ligar
                  {order.contactName ? ` para ${order.contactName}` : ''}
                </a>
              </Button>
            ) : null}
          </div>
          {order.notes ? (
            <p className="whitespace-pre-line rounded-md bg-muted p-2 text-xs">{order.notes}</p>
          ) : null}
          {order.status === 'SCHEDULED' || order.status === 'PENDING' ? (
            <Button className="w-full" onClick={() => void engine.act(order.id, { type: 'START' })}>
              Iniciar
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {order.rejectedActions.length + order.rejectedFiles.length > 0 ? (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-base text-destructive">O sistema recusou algo</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm" aria-label="Itens recusados">
              {[...order.rejectedActions, ...order.rejectedFiles].map((item) => (
                <li key={item.clientActionId} className="flex items-start justify-between gap-2">
                  <span>{item.message ?? 'Recusado'}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void engine.dismiss(item.clientActionId)}
                  >
                    Entendi
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {order.checklist.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Checklist</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2" aria-label="Checklist">
              {order.checklist.map((item) => (
                <li key={item.id}>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-5"
                      checked={item.done}
                      disabled={order.status === 'CANCELLED'}
                      onChange={(e) =>
                        void engine.act(order.id, {
                          type: 'CHECK',
                          itemId: item.id,
                          done: e.target.checked,
                        })
                      }
                    />
                    <span className={item.done ? 'text-muted-foreground line-through' : ''}>
                      {item.label}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Fotos</CardTitle>
          {!closed || order.status === 'DONE' ? (
            <>
              <input
                ref={photoInput}
                id="field-photo"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                aria-label="Tirar ou escolher fotos"
                onChange={(e) => void onPhotos(e.target.files)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => photoInput.current?.click()}
                disabled={order.status === 'CANCELLED'}
              >
                <Camera aria-hidden="true" /> Foto
              </Button>
            </>
          ) : null}
        </CardHeader>
        <CardContent>
          {order.photos.length + order.pendingPhotos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma foto ainda.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2" aria-label="Fotos da ordem">
              {order.photos.map((p) => (
                <li key={p.id}>
                  {p.url && state.online ? (
                    <img
                      src={p.url}
                      alt={p.caption ?? 'Foto enviada'}
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                      Enviada
                    </div>
                  )}
                </li>
              ))}
              {order.pendingPhotos.map((p) => (
                <PendingThumb key={p.clientActionId} photo={p} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Pendências</CardTitle>
          {!closed ? (
            <Button size="sm" variant="outline" onClick={() => setIssueOpen(true)}>
              Registrar
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {order.openIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma pendência aberta.</p>
          ) : (
            <ul className="space-y-2 text-sm" aria-label="Pendências abertas">
              {order.openIssues.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-2">
                  <span>
                    {i.description}
                    <span className="text-muted-foreground">
                      {' '}
                      · {FIELD_ISSUE_TYPE_LABELS[i.type]}
                    </span>
                  </span>
                  <Badge variant={i.blocking ? 'red' : 'yellow'}>
                    {i.blocking ? 'Bloqueia' : 'Aberta'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!closed ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Anotação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="field-note" className="sr-only">
              Anotação
            </Label>
            <Input
              id="field-note"
              value={note}
              placeholder="O que o escritório precisa saber"
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!note.trim()}
              onClick={() => {
                void engine.act(order.id, { type: 'NOTE', text: note.trim() });
                setNote('');
              }}
            >
              Salvar anotação
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {running || order.status === 'DONE' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assinatura do cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {order.signedByName ? (
              <p className="text-sm">
                Assinada por {order.signedByName}
                {order.signedAt ? ` em ${formatDateTime(order.signedAt)}` : ''}.
              </p>
            ) : null}
            {order.pendingSignature ? (
              <p className="text-sm text-muted-foreground">
                Assinatura de {order.pendingSignature.signedByName} aguardando envio.
              </p>
            ) : null}
            <SignaturePad handle={pad} onChange={setPadEmpty} />
            <div className="grid gap-1.5">
              <Label htmlFor="field-signed-by">Nome de quem assina</Label>
              <Input
                id="field-signed-by"
                value={signedBy}
                onChange={(e) => setSignedBy(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={padEmpty || signedBy.trim().length < 2}
              onClick={() => void saveSignature()}
            >
              Guardar assinatura
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {running ? (
        <div className="space-y-2">
          {blockingOpen ? (
            <p role="status" className="text-sm text-destructive">
              Há pendência que bloqueia: o sistema só aceita concluir depois que a operação
              resolver.
            </p>
          ) : null}
          <Button
            className="w-full"
            onClick={() => {
              if (window.confirm('Concluir esta ordem de serviço?'))
                void engine.act(order.id, { type: 'COMPLETE' });
            }}
          >
            Concluir ordem
          </Button>
        </div>
      ) : null}

      <IssueDialog order={order} open={issueOpen} onClose={() => setIssueOpen(false)} />
    </div>
  );
}
