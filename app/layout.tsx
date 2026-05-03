import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MENU MADE — Cook the world\'s restaurants at home',
  description:
    'Search any restaurant in the world, browse its menu, and generate a home-cookable recreation of any dish. An original recreation tool — not affiliated with the restaurants we reference.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..800&family=Inter:wght@300..700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <a href="/" className="logo">
              <span className="logo-dot" />
              MENU MADE
            </a>
            <div className="nav-right">
              <span className="pill pill-warn">Beta</span>
            </div>
          </div>
        </nav>
        <main>{children}</main>
        <footer className="site-footer">
          <strong>MENU MADE</strong> is an original-recreation tool. We are not affiliated with,
          sponsored by, or endorsed by the restaurants we reference. Menu items are publicly
          available references; recipes are AI-generated original interpretations and not the
          restaurants' recipes.
        </footer>
      </body>
    </html>
  );
}
