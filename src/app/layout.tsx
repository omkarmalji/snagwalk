import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Noto_Sans_Devanagari } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
// Hindi and Marathi letters: Geist has no Devanagari glyphs, so the browser falls through to this face.
const devanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '600'],
  variable: '--font-devanagari',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SnagWalk - Possession day snag inspection',
  description:
    'Walk your new flat room by room, photograph defects, let Gemini classify them, and send your builder a formal snag letter.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0c10' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${geist.variable} ${geistMono.variable} ${devanagari.variable}`} suppressHydrationWarning>
      <head>
        {/* Marks JS as available before first paint, so reveal targets start hidden instead of flashing. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body className="min-h-[100dvh] overflow-x-hidden">{children}</body>
    </html>
  );
}
