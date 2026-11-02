import React, { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { HomeColors, HomeSpace } from './homeTheme';
import { fetchSnapshot } from './homeApi';
import { SnapshotLite, WeeklyDescriptor } from './insights';
import { WeeklyCard } from './EvolutionObjective';

// Aderencia por SEMANA (02/11/2026, lote 6): a serie `training.adherencePercent` do servidor (treinos feitos ÷ feitos + nao feitos; sem registro nunca entra), com faixa habitual e media
// de 3 semanas do servidor. Semana em andamento fica de fora; semana sem nenhum treino registrado nao tem ponto (nunca 0%). Descricao, nao nota.
const ADHERENCE: WeeklyDescriptor = {
  fmt: (v) => `${Math.round(v)}%`,
  lastLine: (v, c) => (c?.numerator != null && c?.denominator != null
    ? `você fez ${c.numerator} de ${c.denominator} ${c.denominator === 1 ? 'treino registrado' : 'treinos registrados'} (${Math.round(v)}%)`
    : `sua aderência foi de ${Math.round(v)}%`),
};

export function AdherenceWeekly({ accessToken }: { accessToken: string }) {
  const [snapshot, setSnapshot] = useState<SnapshotLite | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchSnapshot('training.adherencePercent', accessToken, { reference: true }).then((s) => { if (alive) setSnapshot(s); });
    return () => { alive = false; };
  }, [accessToken]);

  if (snapshot === undefined) return <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} style={{ marginTop: HomeSpace.component }} />;
  return (
    <WeeklyCard
      title="Aderência por semana"
      meaningId="training.adherencePercent"
      snapshot={snapshot}
      descriptor={ADHERENCE}
      unit="% dos treinos registrados que foram feitos"
      formatY={(v) => String(Math.round(v))}
      emptyText="Ainda não há semanas completas com treinos registrados para calcular a aderência."
      caution="Aderência = treinos feitos ÷ (feitos + não feitos). Treinos sem registro não entram na conta. Descrição dos seus registros; não indica o que é certo ou errado."
    />
  );
}
