import React, { useState, useEffect } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { useNavigate, useLocation } from 'react-router-dom';
import { getApiUrl, getSecretKey } from '../../config';
import { Settings as SettingsType } from './types';
import {
  FullExtensionConfig,
  addExtension,
  removeExtension,
  getBuiltInExtensions,
  DEFAULT_BUILT_IN_EXTENSIONS,
} from '../../extensions';
import { ConfigureExtensionModal } from './extensions/ConfigureExtensionModal';
import { ManualExtensionModal } from './extensions/ManualExtensionModal';
import { ConfigureBuiltInExtensionModal } from './extensions/ConfigureBuiltInExtensionModal';
import BackButton from '../ui/BackButton';
import { RecentModelsRadio } from './models/RecentModels';
import { ExtensionItem } from './extensions/ExtensionItem';
import { FreedomLevel, GooseFreedom } from './freedom/FreedomLevel';
import { toast } from 'react-toastify';

const EXTENSIONS_DESCRIPTION =
  'The Model Context Protocol (MCP) is a system that allows AI models to securely connect with local or remote resources using standard server setups. It works like a client-server setup and expands AI capabilities using three main components: Prompts, Resources, and Tools.';

const EXTENSIONS_SITE_LINK = 'https://block.github.io/goose/v1/extensions/';

const DEFAULT_SETTINGS: SettingsType = {
  models: [
    {
      id: 'gpt4',
      name: 'GPT 4.0',
      description: 'Standard config',
      enabled: false,
    },
    {
      id: 'gpt4lite',
      name: 'GPT 4.0 lite',
      description: 'Standard config',
      enabled: false,
    },
    {
      id: 'claude',
      name: 'Claude',
      description: 'Standard config',
      enabled: true,
    },
  ],
  // Get default extensions with all disabled in caged mode (default)
  extensions: getBuiltInExtensions('caged'),
  freedom: 'caged' as GooseFreedom, // Default to most restrictive mode
};

export default function Settings() {
  const navigate = useNavigate();
  const location = useLocation();

  const [settings, setSettings] = React.useState<SettingsType>(() => {
    const saved = localStorage.getItem('user_settings');
    window.electron.logInfo('Settings: ' + saved);
    let currentSettings = saved ? JSON.parse(saved) : DEFAULT_SETTINGS;

    // Ensure built-in extensions are included if not already present
    const builtIns = getBuiltInExtensions(currentSettings.freedom || 'caged');
    builtIns.forEach((builtIn) => {
      const exists = currentSettings.extensions.some(
        (ext: FullExtensionConfig) => ext.id === builtIn.id
      );
      if (!exists) {
        // If in caged mode, ensure extension is disabled
        currentSettings.extensions.push({
          ...builtIn,
          enabled: currentSettings.freedom === 'caged' ? false : builtIn.enabled,
        });
      }
    });

    // Ensure freedom level is set
    if (!currentSettings.freedom) {
      currentSettings.freedom = DEFAULT_SETTINGS.freedom;
    }

    return currentSettings;
  });

  const [extensionBeingConfigured, setExtensionBeingConfigured] =
    useState<FullExtensionConfig | null>(null);

  const [isManualModalOpen, setIsManualModalOpen] = useState(false);

  // Persist settings changes
  React.useEffect(() => {
    localStorage.setItem('user_settings', JSON.stringify(settings));
  }, [settings]);

  // Listen for settings updates from extension storage
  useEffect(() => {
    const handleSettingsUpdate = (_: any) => {
      const saved = localStorage.getItem('user_settings');
      if (saved) {
        let currentSettings = JSON.parse(saved);
        setSettings(currentSettings);
      }
    };

    window.electron.on('settings-updated', handleSettingsUpdate);
    return () => {
      window.electron.off('settings-updated', handleSettingsUpdate);
    };
  }, []);

  // Handle URL parameters for auto-opening extension configuration
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const extensionId = params.get('extensionId');
    const showEnvVars = params.get('showEnvVars');

    if (extensionId && showEnvVars === 'true') {
      // Find the extension in settings
      const extension = settings.extensions.find((ext) => ext.id === extensionId);
      if (extension) {
        // Auto-open the configuration modal
        setExtensionBeingConfigured(extension);
        // Scroll to extensions section
        const element = document.getElementById('extensions');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
      }
    }
  }, [location.search, settings.extensions]);

  const handleExtensionToggle = async (extensionId: string) => {
    // Find the extension to get its current state
    const extension = settings.extensions.find((ext) => ext.id === extensionId);

    if (!extension) return;

    const newEnabled = !extension.enabled;

    // Check permissions based on freedom level
    if (newEnabled) {
      if (settings.freedom === 'caged') {
        toast.error(
          <div>
            <strong>Cannot Enable Extension</strong>
            <div>No extensions can be enabled in Caged mode</div>
          </div>
        );
        return;
      }

      // For cage_free, only allow built-in extensions
      if (settings.freedom === 'cage_free' && !isBuiltIn(extensionId)) {
        toast.error(
          <div>
            <strong>Cannot Enable Extension</strong>
            <div>Only built-in extensions are allowed in Cage Free mode</div>
          </div>
        );
        return;
      }
    }

    const originalSettings = settings;

    // Optimistically update local component state
    setSettings((prev) => ({
      ...prev,
      extensions: prev.extensions.map((ext) =>
        ext.id === extensionId ? { ...ext, enabled: newEnabled } : ext
      ),
    }));

    let response: Response;

    try {
      if (newEnabled) {
        response = await addExtension(extension);
      } else {
        response = await removeExtension(extension.name);
      }

      if (!response.ok) {
        // Revert settings and show error
        setSettings(originalSettings);
        toast.error(
          <div>
            <strong>Extension Error</strong>
            <div>{newEnabled ? 'Failed to add extension' : 'Failed to remove extension'}</div>
          </div>
        );
      }
    } catch (error) {
      // Revert settings and show error
      setSettings(originalSettings);
      toast.error(
        <div>
          <strong>Extension Error</strong>
          <div>Unexpected error occurred</div>
        </div>
      );
    }
  };

  const handleExtensionRemove = async () => {
    if (!extensionBeingConfigured) return;

    const response = await removeExtension(extensionBeingConfigured.name, true);

    if (response.ok) {
      toast.success(`Successfully removed ${extensionBeingConfigured.name} extension`);

      // Remove from localstorage
      setSettings((prev) => ({
        ...prev,
        extensions: prev.extensions.filter((ext) => ext.id !== extensionBeingConfigured.id),
      }));
      setExtensionBeingConfigured(null);
      navigate('/settings', { replace: true });
    }
  };

  const handleNavClick = (section: string, e: React.MouseEvent) => {
    e.preventDefault();
    const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]');
    const element = document.getElementById(section.toLowerCase());

    if (scrollArea && element) {
      const topPos = element.offsetTop;
      scrollArea.scrollTo({
        top: topPos,
        behavior: 'smooth',
      });
    }
  };

  const handleExtensionConfigSubmit = () => {
    setExtensionBeingConfigured(null);
    // Clear the URL parameters after configuration
    navigate('/settings', { replace: true });
  };

  const handleFreedomChange = async (freedom: GooseFreedom) => {
    try {
      const originalSettings = settings;

      // If switching to caged mode, disable all extensions first
      if (freedom === 'caged') {
        // Create an array of promises for disabling all enabled extensions
        const disablePromises = settings.extensions
          .filter((ext) => ext.enabled)
          .map(async (ext) => {
            try {
              const response = await removeExtension(ext.name);
              if (!response.ok) {
                throw new Error(`Failed to disable extension: ${ext.name}`);
              }
            } catch (error) {
              console.error(`Error disabling extension ${ext.name}:`, error);
              throw error;
            }
          });

        try {
          await Promise.all(disablePromises);
        } catch (error) {
          // If any extension fails to disable, revert settings and show error
          setSettings(originalSettings);
          toast.error(
            <div>
              <strong>Error Setting Caged Mode</strong>
              <div>Failed to disable all extensions</div>
            </div>
          );
          return;
        }
      }

      // If switching to cage_free, disable all non-built-in extensions
      if (freedom === 'cage_free') {
        const disablePromises = settings.extensions
          .filter((ext) => ext.enabled && !isBuiltIn(ext.id))
          .map(async (ext) => {
            try {
              const response = await removeExtension(ext.name);
              if (!response.ok) {
                throw new Error(`Failed to disable extension: ${ext.name}`);
              }
            } catch (error) {
              console.error(`Error disabling extension ${ext.name}:`, error);
              throw error;
            }
          });

        try {
          await Promise.all(disablePromises);
        } catch (error) {
          setSettings(originalSettings);
          toast.error(
            <div>
              <strong>Error Setting Cage Free Mode</strong>
              <div>Failed to disable non-built-in extensions</div>
            </div>
          );
          return;
        }
      }

      // Update the settings state with new freedom level and disabled extensions if needed
      setSettings((prev) => ({
        ...prev,
        freedom,
        extensions: prev.extensions.map((ext) => ({
          ...ext,
          enabled:
            freedom === 'caged'
              ? false
              : freedom === 'cage_free' && !isBuiltIn(ext.id)
                ? false
                : ext.enabled,
        })),
      }));

      // Send the update to the backend
      const response = await fetch(getApiUrl('/agent/freedom'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Secret-Key': getSecretKey(),
        },
        body: JSON.stringify({
          freedom: freedom.toLowerCase(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update freedom level on server');
      }

      // Log the change
      window.electron.logInfo(`Freedom level changed to: ${freedom}`);

      // Show success toast based on the mode change
      if (freedom === 'caged') {
        toast.success(
          <div>
            <strong>Caged Mode Enabled</strong>
            <div>All extensions have been disabled</div>
          </div>
        );
      } else if (freedom === 'cage_free') {
        toast.success(
          <div>
            <strong>Cage Free Mode Enabled</strong>
            <div>Only built-in extensions are allowed</div>
          </div>
        );
      }
    } catch (error) {
      console.error('Failed to update freedom level:', error);
      // Revert the local state if the server update failed
      const saved = localStorage.getItem('user_settings');
      if (saved) {
        const savedSettings = JSON.parse(saved);
        setSettings((prev) => ({
          ...prev,
          freedom: savedSettings.freedom,
        }));
      }
      // Show error toast
      toast.error(
        <div>
          <strong>Error</strong>
          <div>Failed to update freedom level</div>
        </div>
      );
    }
  };

  const isBuiltIn = (extensionId: string) => {
    return DEFAULT_BUILT_IN_EXTENSIONS.some((builtIn) => builtIn.id === extensionId);
  };

  return (
    <div className="h-screen w-full">
      <div className="relative flex items-center h-[36px] w-full bg-bgSubtle"></div>

      <ScrollArea className="h-full w-full">
        <div className="flex flex-col pb-24">
          <div className="px-8 pt-6 pb-4">
            <BackButton
              onClick={() => {
                navigate('/chat/1', { replace: true });
              }}
            />
            <h1 className="text-3xl font-medium text-textStandard mt-1">Settings</h1>
          </div>

          {/* Content Area */}
          <div className="flex-1 py-8 pt-[20px]">
            <div className="space-y-8">
              <section id="freedom">
                <div className="flex justify-between items-center mb-6 border-b border-borderSubtle px-8">
                  <h2 className="text-xl font-medium text-textStandard">Freedom Level</h2>
                </div>
                <div className="px-8">
                  <p className="text-sm text-textStandard mb-4">
                    Control how much freedom Goose has to use tools and interact with your system.
                  </p>
                  <FreedomLevel value={settings.freedom} onChange={handleFreedomChange} />
                </div>
              </section>

              <section id="models">
                <div className="flex justify-between items-center mb-6 border-b border-borderSubtle px-8">
                  <h2 className="text-xl font-medium text-textStandard">Models</h2>
                  <button
                    onClick={() => navigate('/settings/more-models')}
                    className="text-indigo-500 hover:text-indigo-600 text-sm"
                  >
                    Browse
                  </button>
                </div>
                <div className="px-8">
                  <RecentModelsRadio />
                </div>
              </section>

              <section id="extensions">
                <div className="flex justify-between items-center mb-6 border-b border-borderSubtle px-8">
                  <h2 className="text-xl font-semibold text-textStandard">Extensions</h2>
                  <div className="flex gap-4">
                    <button
                      onClick={() => setIsManualModalOpen(true)}
                      className={`text-sm ${
                        settings.freedom !== 'wild'
                          ? 'text-gray-400 cursor-not-allowed'
                          : 'text-indigo-500 hover:text-indigo-600'
                      }`}
                      title={
                        settings.freedom !== 'wild'
                          ? 'Manual extension addition only allowed in Wild mode'
                          : 'Add Manually'
                      }
                      disabled={settings.freedom !== 'wild'}
                    >
                      Add
                    </button>

                    <button
                      onClick={() => window.electron.openInChrome(EXTENSIONS_SITE_LINK)}
                      className={`text-sm ${
                        settings.freedom === 'caged' || settings.freedom === 'cage_free'
                          ? 'text-gray-400 cursor-not-allowed'
                          : 'text-indigo-500 hover:text-indigo-600'
                      }`}
                      title={
                        settings.freedom === 'caged' || settings.freedom === 'cage_free'
                          ? 'Browsing extensions requires Free Range or Wild mode'
                          : 'Browse extensions'
                      }
                      disabled={settings.freedom === 'caged' || settings.freedom === 'cage_free'}
                    >
                      Browse
                    </button>
                  </div>
                </div>

                <div className="px-8">
                  <p className="text-sm text-textStandard mb-4">{EXTENSIONS_DESCRIPTION}</p>

                  {settings.extensions.length === 0 ? (
                    <p className="text-textSubtle text-center py-4">No Extensions Added</p>
                  ) : (
                    settings.extensions.map((ext) => (
                      <ExtensionItem
                        key={ext.id}
                        {...ext}
                        canConfigure={true} // Ensure gear icon always appears
                        onToggle={handleExtensionToggle}
                        onConfigure={(extension) => setExtensionBeingConfigured(extension)}
                      />
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </ScrollArea>

      {extensionBeingConfigured && isBuiltIn(extensionBeingConfigured.id) ? (
        <ConfigureBuiltInExtensionModal
          isOpen={!!extensionBeingConfigured && isBuiltIn(extensionBeingConfigured.id)}
          onClose={() => {
            setExtensionBeingConfigured(null);
            navigate('/settings', { replace: true });
          }}
          extension={extensionBeingConfigured}
          onSubmit={handleExtensionConfigSubmit}
        />
      ) : (
        <ConfigureExtensionModal
          isOpen={!!extensionBeingConfigured}
          onClose={() => {
            setExtensionBeingConfigured(null);
            // Clear URL parameters when closing manually
            navigate('/settings', { replace: true });
          }}
          extension={extensionBeingConfigured}
          onSubmit={handleExtensionConfigSubmit}
          onRemove={handleExtensionRemove}
        />
      )}

      <ManualExtensionModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        onSubmit={async (extension) => {
          // Check freedom level restrictions
          if (settings.freedom !== 'wild') {
            toast.error(
              <div>
                <strong>Cannot Add Extension</strong>
                <div>Manual extension addition is only allowed in Wild mode</div>
              </div>
            );
            return;
          }

          const response = await addExtension(extension);

          if (response.ok) {
            setSettings((prev) => ({
              ...prev,
              extensions: [...prev.extensions, extension],
            }));
            setIsManualModalOpen(false);
          }
        }}
      />
    </div>
  );
}
