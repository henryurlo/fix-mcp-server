import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FIX-MCP Mission Control',
  description: 'FIX-MCP Mission Control — Trading infrastructure monitoring and diagnostics',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#06080d] text-[#e4e7f1] antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
