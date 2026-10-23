import { describe, expect, it } from 'vitest';
import type { FieldActionInput } from '@voltex/shared';
import { applyLocal, rebase } from './field-local';
import { fieldOrder, NOW } from './field-fixtures';

const base = {
  clientActionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  workOrderId: 'w-1',
  capturedAt: NOW,
};

describe('aplicação local das ações do campo', () => {
  it('iniciar muda a situação; iniciar de novo não muda nada', () => {
    const started = applyLocal(fieldOrder(), { ...base, type: 'START' });
    expect(started).toMatchObject({ status: 'IN_PROGRESS', startedAt: NOW });
    expect(
      applyLocal(started, { ...base, type: 'START', capturedAt: '2026-10-22T13:00:00.000Z' }),
    ).toBe(started);
  });

  it('concluir fecha a ordem e guarda as notas', () => {
    const done = applyLocal(fieldOrder({ status: 'IN_PROGRESS' }), {
      ...base,
      type: 'COMPLETE',
      notes: 'Tudo certo',
    });
    expect(done).toMatchObject({ status: 'DONE', completedAt: NOW, notes: 'Tudo certo' });
    expect(applyLocal(fieldOrder({ notes: 'antes' }), { ...base, type: 'COMPLETE' }).notes).toBe(
      'antes',
    );
  });

  it('marcar e desmarcar um item muda só ele', () => {
    const checked = applyLocal(fieldOrder(), {
      ...base,
      type: 'CHECK',
      itemId: 'k-1',
      done: true,
      note: 'ok',
    });
    expect(checked.checklist[0]).toMatchObject({ done: true, note: 'ok', doneAt: NOW });
    expect(checked.checklist[1]!.done).toBe(false);
    const unchecked = applyLocal(checked, { ...base, type: 'CHECK', itemId: 'k-1', done: false });
    expect(unchecked.checklist[0]).toMatchObject({ done: false, doneAt: null, note: 'ok' });
  });

  it('anotação é acrescentada com data', () => {
    const one = applyLocal(fieldOrder(), { ...base, type: 'NOTE', text: 'Primeira' });
    const two = applyLocal(one, { ...base, type: 'NOTE', text: 'Segunda' });
    expect(two.notes?.split('\n')).toHaveLength(2);
    expect(two.notes).toContain('Segunda');
  });

  it('pendência entra nas abertas, marcada como local', () => {
    const issue = applyLocal(fieldOrder(), {
      ...base,
      type: 'ISSUE',
      issueType: 'ACCESS',
      description: 'Sem acesso',
      blocking: true,
    });
    expect(issue.openIssues).toHaveLength(1);
    expect(issue.openIssues[0]).toMatchObject({
      id: `local-${base.clientActionId}`,
      blocking: true,
      status: 'OPEN',
    });
  });

  it('rebase põe as ações pendentes por cima da versão do servidor, na ordem em que ocorreram, e ignora as de outras ordens', () => {
    const pending: FieldActionInput[] = [
      {
        ...base,
        clientActionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01',
        type: 'COMPLETE',
        capturedAt: '2026-10-22T14:00:00.000Z',
      },
      {
        ...base,
        clientActionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02',
        type: 'START',
        capturedAt: '2026-10-22T13:00:00.000Z',
      },
      {
        ...base,
        clientActionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a03',
        workOrderId: 'w-2',
        type: 'START',
      },
    ];
    const merged = rebase(fieldOrder(), pending);
    expect(merged).toMatchObject({ status: 'DONE', startedAt: '2026-10-22T13:00:00.000Z' });
    expect(rebase(fieldOrder({ id: 'w-9' }), pending).status).toBe('SCHEDULED');
  });
});
