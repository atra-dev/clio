import "./globals.css";
import ToastProvider from "@/components/ui/ToastProvider";

export const metadata = {
  title: "Clio HRIS",
  description:
    "Clio HRIS portal for employee records, lifecycle, attendance, performance, templates, and governed exports.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
