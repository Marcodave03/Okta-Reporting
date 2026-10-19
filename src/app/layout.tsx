import type { Metadata } from 'next';
import { IBM_Plex_Sans, Inter, Lato, Montserrat, Nunito, Open_Sans, Poppins, Public_Sans, Roboto, Source_Sans_3 } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { DEFAULT_PREFS, PREFS_KEY } from '@/lib/themes';

const publicSans = Public_Sans({ subsets: ['latin'], variable: '--f-public-sans', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--f-inter', display: 'swap', preload: false });
const roboto = Roboto({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--f-roboto', display: 'swap', preload: false });
const openSans = Open_Sans({ subsets: ['latin'], variable: '--f-open-sans', display: 'swap', preload: false });
const lato = Lato({ subsets: ['latin'], weight: ['400', '700'], variable: '--f-lato', display: 'swap', preload: false });
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--f-poppins', display: 'swap', preload: false });
const montserrat = Montserrat({ subsets: ['latin'], variable: '--f-montserrat', display: 'swap', preload: false });
const nunito = Nunito({ subsets: ['latin'], variable: '--f-nunito', display: 'swap', preload: false });
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--f-plex', display: 'swap', preload: false });
const sourceSans = Source_Sans_3({ subsets: ['latin'], variable: '--f-source-sans', display: 'swap', preload: false });

const fontVars = [publicSans, inter, roboto, openSans, lato, poppins, montserrat, nunito, plex, sourceSans].map((f) => f.variable).join(' ');

export const metadata: Metadata = {
  title: 'IGA Platform · Okta Identity Governance',
  description: 'Identity Governance & Administration terintegrasi Okta',
  icons: { icon: '/favicon.svg' },
};

// diterapkan sebelum paint agar tidak "flash" theme
const prefsScript = `try{var p=JSON.parse(localStorage.getItem('${PREFS_KEY}')||'{}');var d=document.documentElement;d.dataset.theme=p.theme||'${DEFAULT_PREFS.theme}';d.dataset.font=p.font||'${DEFAULT_PREFS.font}';d.dataset.design=p.design||'${DEFAULT_PREFS.design}';}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={fontVars} data-theme={DEFAULT_PREFS.theme} data-font={DEFAULT_PREFS.font} data-design={DEFAULT_PREFS.design} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: prefsScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
