import React from 'react';

export type GooseFreedom = 'caged' | 'cage_free' | 'free_range' | 'wild';

interface FreedomOption {
  value: GooseFreedom;
  label: string;
  description: string;
}

const freedomOptions: FreedomOption[] = [
  {
    value: 'caged',
    label: 'Caged',
    description: 'No tools or extensions allowed',
  },
  {
    value: 'cage_free',
    label: 'Cage Free',
    description: 'Only built-in tools allowed, no adding or browsing extensions',
  },
  {
    value: 'free_range',
    label: 'Free Range',
    description: 'Built-in tools and browsing extension site allowed, no manual additions',
  },
  {
    value: 'wild',
    label: 'Wild',
    description: 'Full access - can use, browse, and manually add extensions',
  },
];

interface FreedomLevelProps {
  value: GooseFreedom;
  onChange: (value: GooseFreedom) => void;
}

export function FreedomLevel({ value = 'caged', onChange }: FreedomLevelProps) {
  // Convert freedom level to numeric value for slider
  const getSliderValue = (freedom: GooseFreedom): number => {
    return freedomOptions.findIndex((option) => option.value === freedom);
  };

  // Convert numeric value back to freedom level
  const getFreedomValue = (sliderValue: number): GooseFreedom => {
    return freedomOptions[sliderValue].value;
  };

  const currentValue = getSliderValue(value);

  return (
    <div className="space-y-4">
      <div className="w-full">
        <div className="relative">
          <input
            type="range"
            min="0"
            max="3"
            value={currentValue}
            onChange={(e) => onChange(getFreedomValue(parseInt(e.target.value)))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
          <div className="flex justify-between absolute w-full" style={{ top: '20px' }}>
            {freedomOptions.map((option, index) => (
              <div
                key={option.value}
                className={`text-center transform -translate-x-1/2 ${
                  currentValue === index ? 'text-indigo-600 font-medium' : 'text-gray-500'
                }`}
                style={{
                  left: `${(index * 100) / 3}%`,
                  width: 'auto',
                }}
              >
                <div className="text-sm whitespace-nowrap">{option.label}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Add spacing to prevent label overlap with the description */}
        <div className="h-8" />
      </div>
      <div className="text-sm text-gray-600 mt-2">{freedomOptions[currentValue].description}</div>
    </div>
  );
}
