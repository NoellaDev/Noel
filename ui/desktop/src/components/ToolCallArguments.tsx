import { ChevronUp } from 'lucide-react';
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface ToolCallArgumentsProps {
  args: Record<string, any>;
}

export function ToolCallArguments({ args }: ToolCallArgumentsProps) {
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const toggleKey = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderValue = (key: string, value: any) => {
    if (typeof value === 'string') {
      const needsExpansion = value.length > 60;
      const isExpanded = expandedKeys[key];

      if (!needsExpansion) {
        return (
          <div className="mb-4">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-textSubtle">{key}</span>
              <span className="text-sm text-textStandard">{value}</span>
            </div>
          </div>
        );
      }

      return (
        <div className="mb-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-textSubtle">{key}</span>
            <div className="flex items-center">
              {!isExpanded && (
                <span className="text-sm text-textStandard mr-2">{value.slice(0, 60)}...</span>
              )}
              <button
                onClick={() => toggleKey(key)}
                className="text-sm hover:opacity-75 text-textStandard"
              >
                {/* {isExpanded ? '▼ ' : '▶ '} */}
                <ChevronUp
                  className={`h-5 w-5 transition-all origin-center ${!isExpanded ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          </div>
          {isExpanded && (
            <div className="mt-2">
              <ReactMarkdown className="whitespace-pre-wrap break-words prose-pre:whitespace-pre-wrap prose-pre:break-words !p-0 !text-sm text-textStandard">
                {value}
              </ReactMarkdown>
            </div>
          )}
        </div>
      );
    }

    // Handle non-string values (arrays, objects, etc.)
    const content = Array.isArray(value)
      ? value.map((item, index) => `${index + 1}. ${JSON.stringify(item)}`).join('\n')
      : typeof value === 'object' && value !== null
        ? JSON.stringify(value, null, 2)
        : String(value);

    return (
      <div className="mb-4">
        <div className="flex">
          <span className="font-medium mr-2">{key}:</span>
          <pre className="whitespace-pre-wrap">{content}</pre>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-2">
      {Object.entries(args).map(([key, value]) => (
        <div key={key}>{renderValue(key, value)}</div>
      ))}
    </div>
  );
}
