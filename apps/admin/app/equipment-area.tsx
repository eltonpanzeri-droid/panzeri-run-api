'use client';

import React, { useState } from 'react';
import EquipmentIntelligence from './equipment-intelligence';
import StudentAccess from './student-access';

// Menu "Equipamentos": duas telas. "Inteligência" (só agregados, sem nome) e "Como as alunas acessam" (lista nominal, somente leitura; 05/11/2026).
type Tab = 'intelligence' | 'access';

export default function EquipmentArea({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [tab, setTab] = useState<Tab>('intelligence');
  return (
    <div className="eqRoot">
      <div className="eqChips" role="tablist" aria-label="Telas de Equipamentos">
        <button type="button" role="tab" aria-selected={tab === 'intelligence'} className={`eqChip${tab === 'intelligence' ? ' on' : ''}`} onClick={() => setTab('intelligence')}>Inteligência de equipamentos</button>
        <button type="button" role="tab" aria-selected={tab === 'access'} className={`eqChip${tab === 'access' ? ' on' : ''}`} onClick={() => setTab('access')}>Como as alunas acessam</button>
      </div>
      {tab === 'intelligence' ? <EquipmentIntelligence accessToken={accessToken} apiUrl={apiUrl} /> : <StudentAccess accessToken={accessToken} apiUrl={apiUrl} />}
    </div>
  );
}
