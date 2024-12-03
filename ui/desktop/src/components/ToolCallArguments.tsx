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
          <div className="p-1">
            <div className="flex">
              <span className="text-tool-dim mr-2">{key}:</span>
              <span className="text-tool">{value}</span>
            </div>
          </div>
        );
      }

      return (
        <div className="p-1">
          <div className="flex items-baseline">
            <span className="text-tool-dim mr-2">{key}:</span>
            <div className="flex-1">
              <button
                onClick={() => toggleKey(key)}
                className="hover:opacity-75"
              >
                {isExpanded ? '▼ ' : '▶ '}
              </button>
              {!isExpanded && (
                <span className="ml-2 text-gray-600">
                  {value.slice(0, 60)}...
                </span>
              )}
            </div>
          </div>
          {isExpanded && (
            <div className="mt-2 ml-4">
              <ReactMarkdown className="whitespace-pre-wrap break-words prose-pre:whitespace-pre-wrap prose-pre:break-words">
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
      <div className="p-1">
        <div className="flex">
          <span className="font-medium mr-2">{key}:</span>
          <pre className="whitespace-pre-wrap">
            {content}
          </pre>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-2">
      {Object.entries(args).map(([key, value]) => (
        <div key={key}>
          {renderValue(key, value)}
        </div>
      ))}
    </div>
  );
}
