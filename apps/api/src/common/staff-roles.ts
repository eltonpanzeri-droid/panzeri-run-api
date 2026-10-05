// Atribuicao operacional de papeis por e-mail (05/10/2026). Mesmo padrao do COACH_EMAILS: lista em variavel
// de ambiente, sem tabela nem gerenciamento de usuarios.
// Precedencia: ADMIN_EMAILS -> 'admin'; senao COACH_EMAILS -> 'coach'; senao o papel persistido.

export function parseEmailList(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveEffectiveRole(
  email: string,
  persistedRole: string,
  adminEmailsRaw: string | undefined | null,
  coachEmailsRaw: string | undefined | null,
): string {
  const normalized = email.toLowerCase();
  if (parseEmailList(adminEmailsRaw).includes(normalized)) return 'admin';
  if (parseEmailList(coachEmailsRaw).includes(normalized)) return 'coach';
  return persistedRole;
}

// admin e coach compartilham as capacidades de acompanhamento; admin so' acrescenta administracao/diagnostico.
export const isStaffRole = (role: string | undefined | null) => role === 'coach' || role === 'admin';
