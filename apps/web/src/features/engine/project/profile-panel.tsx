import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { EngineeringProjectDetailDto } from '@voltex/shared';
import {
  ART_TYPES,
  COUNCIL_TYPES,
  generationClassOf,
  SIGNATORY_FIELD_LABELS,
  signatoryMissing,
} from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Spinner,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { NumberField } from '../editor/number-field';

const CLASS_LABEL = {
  MICRO: 'Microgeração (≤ 75 kW)',
  MINI: 'Minigeração (> 75 kW e ≤ 5 MW)',
  PLANT: 'Usina (> 5 MW)',
} as const;

/** Ficha do projeto: onde, para qual distribuidora, que potência e quem assina (ART/TRT). */
export function ProfilePanel({ project }: { project: EngineeringProjectDetailDto }) {
  const queryClient = useQueryClient();
  const p = project.profile;
  const [name, setName] = useState(project.name);
  const [distributorId, setDistributorId] = useState(p.distributorId ?? '');
  const [targetKwp, setTargetKwp] = useState<number | undefined>(p.targetKwp ?? undefined);
  const [artType, setArtType] = useState(p.artType ?? '');
  const [artNumber, setArtNumber] = useState(p.artNumber ?? '');
  const [council, setCouncil] = useState(p.councilRegistration ?? '');
  const [signatoryName, setSignatoryName] = useState(p.signatoryName ?? '');
  const [councilType, setCouncilType] = useState<string>(p.councilType ?? '');
  const [councilState, setCouncilState] = useState(p.councilState ?? '');
  const [artIssuedAt, setArtIssuedAt] = useState(p.artIssuedAt ?? '');
  const [secondReview, setSecondReview] = useState(p.requireSecondReview);
  const [notes, setNotes] = useState(p.notes ?? '');
  useEffect(() => {
    setName(project.name);
    setDistributorId(p.distributorId ?? '');
    setTargetKwp(p.targetKwp ?? undefined);
    setArtType(p.artType ?? '');
    setArtNumber(p.artNumber ?? '');
    setCouncil(p.councilRegistration ?? '');
    setSignatoryName(p.signatoryName ?? '');
    setCouncilType(p.councilType ?? '');
    setCouncilState(p.councilState ?? '');
    setArtIssuedAt(p.artIssuedAt ?? '');
    setSecondReview(p.requireSecondReview);
    setNotes(p.notes ?? '');
  }, [project, p]);

  const distributors = useQuery({
    queryKey: ['distributors'],
    queryFn: () => endpoints.distributors.list(),
  });
  const save = useMutation({
    mutationFn: () =>
      endpoints.engineering.updateProfile(project.id, {
        name,
        distributorId: distributorId || null,
        targetKwp: targetKwp ?? null,
        artType: (artType || null) as never,
        artNumber: artNumber.trim() || null,
        councilRegistration: council.trim() || null,
        signatoryName: signatoryName.trim() || null,
        councilType: (councilType || null) as never,
        councilState: councilState.trim().toUpperCase() || null,
        artIssuedAt: artIssuedAt || null,
        requireSecondReview: secondReview,
        notes: notes.trim() || null,
      }),
    onSuccess: async () => {
      toast.success('Ficha do projeto salva.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.engineeringProject(project.id) });
      await queryClient.invalidateQueries({ queryKey: ['engineering', 'documents', project.id] });
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível salvar a ficha.')),
  });
  const cls = targetKwp ? generationClassOf(targetKwp) : null;
  const editable = project.status === 'IN_PROGRESS';
  const missing = signatoryMissing(p);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ficha do projeto</CardTitle>
        <CardDescription>
          A potência-alvo define a classe (micro ou mini) e, com a distribuidora, o pacote de
          documentos da solicitação de acesso. O responsável técnico assina o projeto de execução
          com ART, TRT ou RRT (EnergIF EF-R10). Quem assina é o profissional deste projeto, com o
          registro dele; a aprovação da versão exige esses dados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="pf-name">Nome do projeto</Label>
            <Input
              id="pf-name"
              value={name}
              disabled={!editable}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pf-dist">Distribuidora</Label>
            <NativeSelect
              id="pf-dist"
              value={distributorId}
              disabled={!editable}
              onChange={(e) => setDistributorId(e.target.value)}
            >
              <option value="">Não informada</option>
              {(distributors.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <NumberField
              id="pf-kwp"
              label="Potência-alvo"
              unit="kWp"
              optional
              min={0.1}
              max={100000}
              value={targetKwp}
              disabled={!editable}
              onChange={setTargetKwp}
            />
            {cls ? (
              <Badge variant="secondary" className="w-fit">
                {CLASS_LABEL[cls]}
              </Badge>
            ) : null}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pf-art-type">Responsabilidade técnica</Label>
            <NativeSelect
              id="pf-art-type"
              value={artType}
              disabled={!editable}
              onChange={(e) => setArtType(e.target.value)}
            >
              <option value="">Não informada</option>
              {ART_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pf-art">Número da {artType || 'ART/TRT'}</Label>
            <Input
              id="pf-art"
              value={artNumber}
              disabled={!editable}
              onChange={(e) => setArtNumber(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pf-signatory">Profissional que assina</Label>
            <Input
              id="pf-signatory"
              value={signatoryName}
              disabled={!editable}
              onChange={(e) => setSignatoryName(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pf-council-type">Conselho</Label>
            <NativeSelect
              id="pf-council-type"
              value={councilType}
              disabled={!editable}
              onChange={(e) => setCouncilType(e.target.value)}
            >
              <option value="">Não informado</option>
              {COUNCIL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pf-council">Registro no conselho (CREA/CFT/CAU)</Label>
            <Input
              id="pf-council"
              value={council}
              disabled={!editable}
              onChange={(e) => setCouncil(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pf-council-state">UF do registro</Label>
            <Input
              id="pf-council-state"
              maxLength={2}
              value={councilState}
              disabled={!editable}
              onChange={(e) => setCouncilState(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pf-art-date">Data da {artType || 'ART/TRT/RRT'}</Label>
            <Input
              id="pf-art-date"
              type="date"
              value={artIssuedAt}
              disabled={!editable}
              onChange={(e) => setArtIssuedAt(e.target.value)}
            />
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm" htmlFor="pf-second-review">
          <input
            id="pf-second-review"
            type="checkbox"
            className="mt-1"
            checked={secondReview}
            disabled={!editable}
            onChange={(e) => setSecondReview(e.target.checked)}
          />
          <span>
            Exigir segunda revisão: quem enviar a versão não poderá aprová-la, e outro engenheiro
            precisa fazê-lo (como a revisão obrigatória de um PR). Sem isso, o engenheiro pode
            aprovar o próprio trabalho ou pedir a revisão de alguém.
          </span>
        </label>
        <div className="grid gap-1">
          <Label htmlFor="pf-notes">Observações</Label>
          <Input
            id="pf-notes"
            value={notes}
            disabled={!editable}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {missing.length ? (
          <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
            Para aprovar uma versão falta informar:{' '}
            {missing.map((f) => SIGNATORY_FIELD_LABELS[f]).join(', ')}.
          </p>
        ) : null}
        <Can permission="engine.project.write">
          {editable ? (
            <Button
              disabled={save.isPending || name.trim().length < 2}
              onClick={() => save.mutate()}
            >
              {save.isPending ? <Spinner /> : null} Salvar ficha
            </Button>
          ) : null}
        </Can>
      </CardContent>
    </Card>
  );
}
