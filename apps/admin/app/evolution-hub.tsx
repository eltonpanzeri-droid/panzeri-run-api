'use client';
import * as React from 'react';
import TrainingIntelligenceStudio, { CustomPeriodForm, Modal } from './ti/studio';
import EvolutionExplorer, { type PeriodSelection } from './ti/explorer';
import { PERIODS, dateLabel } from './ti/data';
import type { ExportProfile } from './ti/anonymous-export';
import './ti/explorer.css';

// Aba Evolucao do aluno (27/10/2026): uma central com um unico cabecalho de periodo e abas internas. A exploracao de indicadores e a comparacao usam a infraestrutura do
// Training Intelligence (catalogo, matematica longitudinal e grafico); as demais analises existentes entram como paineis (slots) vindos da pagina do aluno.
export type HubTab = 'geral' | 'explorar' | 'comparar' | 'treinos' | 'saude' | 'linha' | 'registros';
export const HUB_TABS: Array<{ id: HubTab; label: string }> = [
  { id: 'geral', label: 'Visão geral' }, { id: 'explorar', label: 'Explorar' }, { id: 'comparar', label: 'Comparar' },
  { id: 'treinos', label: 'Treinos e carga' }, { id: 'saude', label: 'Saúde' }, { id: 'linha', label: 'Linha do tempo' }, { id: 'registros', label: 'Registros' },
];
export const HUB_PERIODS = PERIODS;
export type { PeriodSelection };

export default function EvolutionHub({ studentId, token, studentIsFemale, exportProfile, period, onPeriodChange, onOpenOriginal, onOpenIntegrations, slots, initialTab = 'geral' }: {
  studentId: string; token: string; studentIsFemale: boolean | null; exportProfile?: ExportProfile;
  period: PeriodSelection; onPeriodChange: (next: PeriodSelection) => void; onOpenOriginal: (target: { date: string; sessionId?: string }) => void; onOpenIntegrations?: () => void;
  slots: Record<'geral' | 'volume' | 'carga' | 'treinos' | 'saude' | 'linha' | 'registros', React.ReactNode>; initialTab?: HubTab;
}) {
  const [tab, setTab] = React.useState<HubTab>(initialTab);
  const [visited, setVisited] = React.useState<Set<HubTab>>(new Set([initialTab]));
  const [picking, setPicking] = React.useState(false);
  function open(next: HubTab) { setTab(next); setVisited((current) => (current.has(next) ? current : new Set(current).add(next))); }
  const panel = (id: HubTab, node: React.ReactNode) => (visited.has(id) ? <div className="evh-panel" hidden={tab !== id} data-hub-panel={id}>{node}</div> : null);
  const customLabel = period.id === 'custom' && period.custom ? `${dateLabel(period.custom[0])}–${dateLabel(period.custom[1])}` : 'Personalizar';

  return <div className="evh">
    <div className="evh-bar">
      <div className="evh-tabs" role="tablist" aria-label="Seções da Evolução">
        {HUB_TABS.map(({ id, label }) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => open(id)}>{label}</button>)}
      </div>
      <div className="evh-period" aria-label="Período da Evolução">
        <span>Período</span>
        {PERIODS.map((item) => <button key={item.id} type="button" className={period.id === item.id ? 'active' : ''} aria-pressed={period.id === item.id} onClick={() => onPeriodChange({ id: item.id, custom: null })}>{item.label}</button>)}
        <button type="button" className={period.id === 'custom' ? 'active' : ''} aria-pressed={period.id === 'custom'} onClick={() => setPicking(true)}>{customLabel}</button>
      </div>
    </div>
    {panel('geral', <>
      <div className="evh-shortcuts">
        <button type="button" onClick={() => open('explorar')}>Explorar indicadores</button>
        <button type="button" onClick={() => open('comparar')}>Comparar séries</button>
        <button type="button" onClick={() => open('treinos')}>Treinos e carga</button>
        <button type="button" onClick={() => open('linha')}>Linha do tempo</button>
      </div>
      {slots.geral}
    </>)}
    {panel('explorar', <EvolutionExplorer key={studentId} studentId={studentId} token={token} studentIsFemale={studentIsFemale} period={period} onOpenOriginal={onOpenOriginal} onOpenIntegrations={onOpenIntegrations} panels={{ volume: slots.volume, carga: slots.carga }} />)}
    {panel('comparar', <>
      <p className="evh-note">Compare séries na mesma janela de tempo, cada uma com a sua escala, fonte e significado. Coincidência temporal não demonstra causa nem efeito.</p>
      <TrainingIntelligenceStudio key={studentId} accessToken={token} initialStudentId={studentId} exportProfile={exportProfile} compareOnly controlledPeriod={period} />
    </>)}
    {panel('treinos', slots.treinos)}
    {panel('saude', slots.saude)}
    {panel('linha', slots.linha)}
    {panel('registros', slots.registros)}
    {picking && <div className="ti-app ti-app-embedded" data-theme="light" style={{ border: 'none', background: 'transparent', height: 0, overflow: 'visible' }}>
      <Modal title="Período personalizado" onClose={() => setPicking(false)}>
        <CustomPeriodForm onApply={(range) => { onPeriodChange({ id: 'custom', custom: range }); setPicking(false); }} />
      </Modal>
    </div>}
  </div>;
}
