import type { Metadata, Viewport } from "next";
import "glisse/styles.css";
import "./globals.css";
import { I18nProvider } from "@/context/I18nContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { AuthProvider } from "@/context/AuthContext";
import { DeviceSyncProvider } from "@/context/DeviceSyncContext";
import { PlayerProvider } from "@/context/PlayerContext";
import { AppShell } from "@/components/AppShell";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { AndroidInitializer } from "@/components/AndroidInitializer";

export const metadata: Metadata = {
  title: {
    default: "Soundify | ساندیفای",
    template: "%s | Soundify",
  },
  description:
    "Soundify — Liquid Glass Music Streaming Platform with Synced LRC Lyrics, Waveforms & PWA Support.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/images/logo-icon.png", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Soundify",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#090915" },
    { media: "(prefers-color-scheme: light)", color: "#f2f4fb" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta httpEquiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; media-src 'self' blob: data: https:; img-src 'self' data: blob: https:; connect-src 'self' https: wss: ws: http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'self';" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <meta name="color-scheme" content="light dark" />
        <link rel="preconnect" href="https://soundify.mashhad-ix.ir" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://soundify.mashhad-ix.ir" />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem("color-scheme");document.querySelector('meta[name="color-scheme"]').content=s??"light dark";var d=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(s==="light"||s==="dark")document.documentElement.setAttribute("data-theme",s);document.documentElement.setAttribute("data-resolved-theme",d?"dark":"light");document.documentElement.classList.toggle("dark",d);var l=localStorage.getItem("soundify_lang");if(l==="en"||l==="fa"){document.documentElement.lang=l;document.documentElement.dir=l==="fa"?"rtl":"ltr";}}catch(e){}`,
          }}
        />
        <link
          rel="preload"
          href="/fonts/iranyekanx/IRANYekanXVFaNumVF.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/iranyekanx/IRANYekanXVF.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/sf-arabic/SFArabic-Bold.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              <DeviceSyncProvider>
                <PlayerProvider>
                  <ServiceWorkerRegistrar />
                  <AndroidInitializer />
                  <AppShell>{children}</AppShell>
                </PlayerProvider>
              </DeviceSyncProvider>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
