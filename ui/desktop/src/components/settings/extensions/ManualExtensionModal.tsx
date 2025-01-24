import React, { useState } from 'react';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { FullExtensionConfig } from '../../../extensions';
import { toast } from 'react-toastify';
import Select from 'react-select';
import { createDarkSelectStyles, darkSelectTheme } from '../../ui/select-styles';
import { getApiUrl, getSecretKey } from '../../../config';

interface ManualExtensionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (extension: FullExtensionConfig) => void;
}

export function ManualExtensionModal({ isOpen, onClose, onSubmit }: ManualExtensionModalProps) {
  const [formData, setFormData] = useState<
    Partial<FullExtensionConfig> & { commandInput?: string }
  >({
    type: 'stdio',
    enabled: true,
    args: [],
    commandInput: '',
  });
  const [envKey, setEnvKey] = useState('');
  const [envValue, setEnvValue] = useState('');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);

  const typeOptions = [
    { value: 'stdio', label: 'Standard IO' },
    { value: 'sse', label: 'Server-Sent Events' },
    { value: 'builtin', label: 'Built-in' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.id || !formData.name || !formData.description) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (formData.type === 'stdio' && !formData.commandInput) {
      toast.error('Command is required for stdio type');
      return;
    }

    if (formData.type === 'sse' && !formData.uri) {
      toast.error('URI is required for SSE type');
      return;
    }

    if (formData.type === 'builtin' && !formData.name) {
      toast.error('Name is required for builtin type');
      return;
    }

    try {
      // Store environment variables as secrets
      for (const envVar of envVars) {
        const storeResponse = await fetch(getApiUrl('/secrets/store'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Secret-Key': getSecretKey(),
          },
          body: JSON.stringify({
            key: envVar.key,
            value: envVar.value.trim(),
          }),
        });

        if (!storeResponse.ok) {
          throw new Error(`Failed to store environment variable: ${envVar.key}`);
        }
      }

      // Parse command input into cmd and args
      let cmd = '';
      let args: string[] = [];
      if (formData.type === 'stdio' && formData.commandInput) {
        const parts = formData.commandInput.trim().split(/\s+/);
        [cmd, ...args] = parts;
      }

      const extension: FullExtensionConfig = {
        ...formData,
        type: formData.type!,
        enabled: true,
        env_keys: envVars.map((v) => v.key),
        ...(formData.type === 'stdio' && { cmd, args }),
      } as FullExtensionConfig;

      onSubmit(extension);
      resetForm();
    } catch (error) {
      console.error('Error configuring extension:', error);
      toast.error('Failed to configure extension');
    }
  };

  const resetForm = () => {
    setFormData({
      type: 'stdio',
      enabled: true,
      args: [],
      commandInput: '',
    });
    setEnvVars([]);
    setEnvKey('');
    setEnvValue('');
  };

  const handleAddEnvVar = () => {
    if (envKey && !envVars.some((v) => v.key === envKey)) {
      setEnvVars([...envVars, { key: envKey, value: envValue }]);
      setEnvKey('');
      setEnvValue('');
    }
  };

  const handleRemoveEnvVar = (key: string) => {
    setEnvVars(envVars.filter((v) => v.key !== key));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm">
      <Card className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] bg-white dark:bg-gray-800 rounded-xl shadow-xl overflow-hidden p-[16px] pt-[24px] pb-0">
        <div className="px-8 pb-0 space-y-8">
          <div className="flex">
            <h2 className="text-2xl font-regular dark:text-white text-gray-900">
              Add Extension Manually
            </h2>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Type
                </label>
                <Select
                  options={typeOptions}
                  value={typeOptions.find((option) => option.value === formData.type)}
                  onChange={(option) =>
                    setFormData({ ...formData, type: option?.value as FullExtensionConfig['type'] })
                  }
                  styles={createDarkSelectStyles()}
                  theme={darkSelectTheme}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  ID *
                </label>
                <Input
                  type="text"
                  value={formData.id || ''}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  className="w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Name *
                </label>
                <Input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Description *
                </label>
                <Input
                  type="text"
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full"
                  required
                />
              </div>

              {formData.type === 'stdio' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Command * (command and arguments separated by spaces)
                  </label>
                  <Input
                    type="text"
                    value={formData.commandInput || ''}
                    onChange={(e) => setFormData({ ...formData, commandInput: e.target.value })}
                    placeholder="e.g. goosed mcp example"
                    className="w-full"
                    required
                  />
                </div>
              )}

              {formData.type === 'sse' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    URI *
                  </label>
                  <Input
                    type="text"
                    value={formData.uri || ''}
                    onChange={(e) => setFormData({ ...formData, uri: e.target.value })}
                    className="w-full"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Environment Variables
                </label>
                <div className="flex gap-2 mb-2">
                  <Input
                    type="text"
                    value={envKey}
                    onChange={(e) => setEnvKey(e.target.value)}
                    placeholder="Environment variable name"
                    className="flex-1"
                  />
                  <Input
                    type="text"
                    value={envValue}
                    onChange={(e) => setEnvValue(e.target.value)}
                    placeholder="Value"
                    className="flex-1"
                  />
                  <Button type="button" onClick={handleAddEnvVar}>
                    Add
                  </Button>
                </div>
                {envVars.length > 0 && (
                  <div className="space-y-2">
                    {envVars.map((envVar) => (
                      <div
                        key={envVar.key}
                        className="flex items-center justify-between bg-gray-100 dark:bg-gray-700 p-2 rounded"
                      >
                        <div className="flex-1">
                          <span className="text-sm font-medium">{envVar.key}</span>
                          <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                            = {envVar.value}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveEnvVar(envVar.key)}
                          className="text-red-500 hover:text-red-700 ml-2"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-[8px] ml-[-24px] mr-[-24px] pt-[16px]">
              <Button
                type="submit"
                variant="ghost"
                className="w-full h-[60px] rounded-none border-t dark:border-gray-600 text-lg hover:bg-gray-50 hover:dark:text-black dark:text-white dark:border-gray-600 font-regular"
              >
                Add Extension
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  resetForm();
                  onClose();
                }}
                className="w-full h-[60px] rounded-none border-t dark:border-gray-600 text-gray-400 hover:bg-gray-50 dark:border-gray-600 text-lg font-regular"
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
