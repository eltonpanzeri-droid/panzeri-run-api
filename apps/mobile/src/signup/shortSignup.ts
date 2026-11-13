// Cadastro curto (13/11/2026): nome, e-mail, telefone e CPF antes do pagamento. Funcoes puras, sem React Native, espelho das regras do servidor (apps/api/src/common/short-signup.ts):
// o teste `short-signup.spec.ts` confere que as duas versoes concordam.
export const onlyDigits = (value: string): string => value.replace(/[^0-9]/g, '');

export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return false;
  if (digits.split('').every((digit) => digit === digits[0])) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

// Telefone brasileiro com DDD (10 ou 11 digitos); aceita prefixo 55.
export function normalizeBrPhone(value: string): string | null {
  let digits = onlyDigits(value);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (digits.length === 11 && digits[2] !== '9') return null;
  return digits;
}

// Mascaras de digitacao (so' visual; o que vai ao servidor sao os digitos).
export function formatCpfInput(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatPhoneInput(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// Mensagem do primeiro campo de identificacao que falta ou esta invalido (null = tudo certo).
export function shortSignupProblem(input: { name: string; phone: string; cpf: string }): string | null {
  if (input.name.trim().length < 2) return 'Informe seu nome completo.';
  if (!normalizeBrPhone(input.phone)) return 'Informe seu WhatsApp com DDD. Exemplo: (11) 91234-5678.';
  if (!isValidCpf(input.cpf)) return 'CPF inválido. Confira os 11 números.';
  return null;
}
