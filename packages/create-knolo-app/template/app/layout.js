import './globals.css';

export const metadata = {
  title: 'KnoLo Starter Chat',
  description: 'Minimal local-doc Q&A with citations using KnoLo',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
