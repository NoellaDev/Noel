import React, { useEffect, useState } from 'react';
import LauncherWindow from './LauncherWindow';
import ChatWindow from './ChatWindow';
import ErrorScreen from './components/ErrorScreen';
import 'react-toastify/dist/ReactToastify.css';
import { ToastContainer } from 'react-toastify';
import { ModelProvider } from './components/settings/models/ModelContext';
import { ActiveKeysProvider } from './components/settings/api_keys/ActiveKeysContext';
import { loadStoredExtensionConfigs } from './extensions';

export default function App() {
  const [fatalError, setFatalError] = useState<string | null>(null);
  const searchParams = new URLSearchParams(window.location.search);
  const isLauncher = searchParams.get('window') === 'launcher';

  useEffect(() => {
    const handleFatalError = (_: any, errorMessage: string) => {
      setFatalError(errorMessage);
    };

    // Listen for fatal errors from main process
    window.electron.on('fatal-error', handleFatalError);

    // Load stored extension configs when the app starts
    // delay this by a few seconds
    setTimeout(() => {
      window.electron.logInfo('App.tsx: Loading stored extension configs');
      loadStoredExtensionConfigs().catch((error) => {
        console.error('Failed to load stored extension configs:', error);
        window.electron.logInfo('App.tsx: Failed to load stored extension configs ' + error);
      });
    }, 5000);

    return () => {
      window.electron.off('fatal-error', handleFatalError);
    };
  }, []);

  if (fatalError) {
    return <ErrorScreen error={fatalError} onReload={() => window.electron.reloadApp()} />;
  }

  return (
    <ModelProvider>
      <ActiveKeysProvider>
        {isLauncher ? <LauncherWindow /> : <ChatWindow />}
        <ToastContainer
          aria-label="Toast notifications"
          position="top-right"
          autoClose={3000}
          closeOnClick
          pauseOnHover
        />
      </ActiveKeysProvider>
    </ModelProvider>
  );
}
