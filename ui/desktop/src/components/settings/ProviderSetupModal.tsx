import React from 'react';
import { Card } from '../ui/card';
import { Lock } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
// import UnionIcon from "../images/Union@2x.svg";

interface ProviderSetupModalProps {
  provider: string;
  model: string;
  endpoint: string;
  onSubmit: (apiKey: string) => void;
  onCancel: () => void;
}

export function ProviderSetupModal({
  provider,
  model,
  endpoint,
  onSubmit,
  onCancel,
}: ProviderSetupModalProps) {
  const [apiKey, setApiKey] = React.useState('');
  const headerText = `Setup ${provider}`;
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(apiKey);
  };

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm">
      <Card className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] bg-white dark:bg-gray-800 rounded-xl shadow-xl overflow-hidden p-[16px] pt-[24px] pb-0">
        <div className="px-8 pb-0 space-y-8">
          {/* Header */}
          <div className="flex">
            {/* Purple icon */}
            {/* <div className="w-[24px] h-[24px] flex items-center justify-center">
              <img src={UnionIcon} alt="Union icon" />
            </div> */}
            <h2 className="text-2xl font-regular dark:text-white text-gray-900">{headerText}</h2>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="mt-[24px]">
              <div>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`Enter API key`}
                  className="w-full h-14 px-4 font-regular rounded-lg border shadow-none border-gray-300 bg-white text-lg placeholder:text-gray-400 font-regular text-gray-900"
                  required
                />
                <div className="flex mt-4 text-gray-600 dark:text-gray-300">
                  <Lock className="w-6 h-6" />
                  <span className="text-sm font-light ml-4 mt-[2px]">{`Your API key will be stored securely in the keychain and used only for making requests to ${provider}`}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-[8px] ml-[-24px] mr-[-24px] pt-[16px]">
              <Button
                type="submit"
                variant="ghost"
                className="w-full h-[60px] rounded-none border-t dark:border-gray-600 text-lg hover:bg-gray-50 hover:dark:text-black dark:text-white dark:border-gray-600 font-regular"
              >
                Submit
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
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