import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { LanguageProvider } from './src/contexts/LanguageContext';
import { TrainerApp } from './src/app/TrainerApp';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/** The ICU trainer is the default (also for ?case=<id> or a hash containing case=). The original simulator opens only under '#/legacy'. */
const Root: React.FC = () => {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (hash.startsWith('#/legacy')) {
    return (
      <LanguageProvider>
        <App />
      </LanguageProvider>
    );
  }
  // '/', '/?case=<id>', '#/trainer...' and any hash containing case= all open the trainer.
  return <TrainerApp onExit={hash.startsWith('#/trainer') ? () => { window.location.hash = ''; } : undefined} />;
};

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
