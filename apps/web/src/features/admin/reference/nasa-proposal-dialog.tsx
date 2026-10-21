import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Spinner,
  toast,
} from '@voltex/ui';
import { parseDecimal } from '@/features/calculator/form';
import { BRAZILIAN_STATES } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

/** Pede uma proposta de irradiação e temperaturas de um local à NASA POWER. Nada é gravado até a decisão em Atualizações. */
export function NasaProposalDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [error, setError] = useState<string | null>(null);

  const propose = useMutation({
    mutationFn: () =>
      endpoints.dataHub.proposeSolarResource({
        name: name.trim(),
        ...(state ? { state } : {}),
        latitude: parseDecimal(lat) as number,
        longitude: parseDecimal(lng) as number,
      }),
    onSuccess: () => {
      toast.success('Proposta criada. Revise e decida em Atualizações.');
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível buscar a irradiação agora.')),
  });

  const submit = () => {
    const la = parseDecimal(lat);
    const lo = parseDecimal(lng);
    if (name.trim().length < 2) return setError('Informe o nome do local.');
    if (la === undefined || Number.isNaN(la) || la < -90 || la > 90)
      return setError('Latitude inválida (−90 a 90).');
    if (lo === undefined || Number.isNaN(lo) || lo < -180 || lo > 180)
      return setError('Longitude inválida (−180 a 180).');
    setError(null);
    propose.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buscar da NASA POWER</DialogTitle>
          <DialogDescription>
            Traz a irradiação mensal e as temperaturas da grade mais próxima das coordenadas. Vira
            uma{' '}
            <Link to="/admin/atualizacoes" className="underline">
              proposta em Atualizações
            </Link>
            : só entra na lista depois que você aprovar. As temperaturas são informativas, não a
            temperatura de projeto.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="nasa-name">Local</Label>
            <Input
              id="nasa-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Brasília"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nasa-uf">UF</Label>
            <NativeSelect id="nasa-uf" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Não informada</option>
              {BRAZILIAN_STATES.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="nasa-lat">Latitude</Label>
              <Input
                id="nasa-lat"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-15,78"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nasa-lng">Longitude</Label>
              <Input
                id="nasa-lng"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-47,93"
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={propose.isPending}>
              {propose.isPending ? <Spinner /> : null}
              Buscar e propor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
