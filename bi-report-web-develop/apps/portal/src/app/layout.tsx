import type { Metadata } from "next";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./globals.css";
import "@/modules/loaders/styles/bi-transition.css";
import { AuthProvider } from "@/modules/shared/providers/AuthProvider";
import { ThemeProvider } from "@/modules/shared/providers/ThemeProvider";
import { PortalProvider } from "@/context/PortalContext";

export const metadata: Metadata = {
  title: "Synergy BI Portal",
  description: "Power BI Report Portal with AI Analytics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(localStorage.getItem('portal_theme')==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}}catch(e){}",
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <PortalProvider>
              {children}
              <ToastContainer position="top-right" autoClose={3000} theme="colored" />
            </PortalProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
