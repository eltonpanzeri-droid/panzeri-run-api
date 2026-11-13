// Cadastro curto antes do pagamento (13/11/2026, decisao de Elton): nome, e-mail, telefone e CPF e a aluna ja vai para o pagamento, com o minimo de atrito.
// Funcoes puras (testaveis). O CPF e validado pelos digitos verificadores aqui para o erro aparecer no cadastro e nao so' na hora de criar a cobranca.

export function onlyDigits(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

export function isValidCpf(value: unknown): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

// Telefone brasileiro com DDD (10 ou 11 digitos); aceita o prefixo 55 e o remove.
export function normalizeBrPhone(value: unknown): string | null {
  let digits = onlyDigits(value);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (digits.length === 11 && digits[2] !== '9') return null; // celular com 9 digitos comeca em 9
  return digits;
}
