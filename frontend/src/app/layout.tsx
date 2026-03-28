import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/contexts/AuthContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import './globals.css';

export const metadata: Metadata = {
  title: 'UEL Connect',
  description: 'Tradução em tempo real para alunos internacionais',
  manifest: '/manifest.json',
  icons: {
    icon: '/logo2.png',
    apple: '/logo2.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#01884d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preload" href="/bg-app.jpg" as="image" />
        <link rel="preload" href="/bg-campus.jpg" as="image" />
      </head>
      <body className="min-h-screen bg-[#0a0a0a]">
        <LocaleProvider><AuthProvider>{children}</AuthProvider></LocaleProvider>
      </body>
    </html>
  );
}
