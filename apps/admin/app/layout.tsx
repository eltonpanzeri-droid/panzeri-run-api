import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Panzeri Run Admin',
  description: 'Painel administrativo do MVP Panzeri Run',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
