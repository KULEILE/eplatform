import React from 'react';
import Header from './Header';
import Footer from './Footer';

export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Header />
      <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
      <Footer />
    </div>
  );
}
