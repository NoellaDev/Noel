import React from "react";
import { Button } from "./ui/button";
import { Bold, Italic, Code, Link, Eye } from "lucide-react";

export interface FloatingToolbarProps {
  style: React.CSSProperties;
  value: string;
  selectionStart: number;
  selectionEnd: number;
  onTextChange: (newText: string, newSelectionStart: number, newSelectionEnd: number) => void;
  selectedText: string;
  isPreview: boolean;
  onPreviewToggle: () => void;
  onSelectionUpdate?: (start: number, end: number) => void;
}

export const FloatingToolbar = ({ 
  style, 
  value,
  selectionStart,
  selectionEnd,
  onTextChange,
  selectedText, 
  isPreview, 
  onPreviewToggle,
  onSelectionUpdate
}: FloatingToolbarProps) => {

  const getFormattedTextRange = (format: string) => {
    let rangeStart = selectionStart;
    let rangeEnd = selectionEnd;
    const beforeText = value.substring(0, selectionStart);
    const afterText = value.substring(selectionEnd);
    const selectedContent = value.substring(selectionStart, selectionEnd);

    switch (format) {
      case 'bold': {
        const isBold = selectedContent.startsWith('**') && selectedContent.endsWith('**') ||
                      (beforeText.endsWith('**') && afterText.startsWith('**'));
        
        if (isBold) {
          if (selectedContent.startsWith('**') && selectedContent.endsWith('**')) {
            rangeStart = selectionStart;
            rangeEnd = selectionEnd;
          } else {
            rangeStart = beforeText.lastIndexOf('**');
            rangeEnd = selectionEnd + afterText.indexOf('**') + 2;
          }
        }
        break;
      }
        
      case 'italic': {
        const isItalic = (selectedContent.startsWith('*') && selectedContent.endsWith('*') && 
                         !selectedContent.startsWith('**') && !selectedContent.endsWith('**')) ||
                        (beforeText.endsWith('*') && !beforeText.endsWith('**') && 
                         afterText.startsWith('*') && !afterText.startsWith('**'));
        
        if (isItalic) {
          if (selectedContent.startsWith('*') && selectedContent.endsWith('*') &&
              !selectedContent.startsWith('**')) {
            rangeStart = selectionStart;
            rangeEnd = selectionEnd;
          } else {
            rangeStart = beforeText.lastIndexOf('*');
            rangeEnd = selectionEnd + afterText.indexOf('*') + 1;
          }
        }
        break;
      }
        
      case 'code': {
        const isCode = selectedContent.startsWith('```\n') && selectedContent.endsWith('\n```') ||
                      (beforeText.endsWith('```\n') && afterText.startsWith('\n```'));
        
        if (isCode) {
          if (selectedContent.startsWith('```\n') && selectedContent.endsWith('\n```')) {
            rangeStart = selectionStart;
            rangeEnd = selectionEnd;
          } else {
            rangeStart = beforeText.lastIndexOf('```\n');
            rangeEnd = selectionEnd + afterText.indexOf('\n```') + 4;
          }
        }
        break;
      }
        
      case 'link': {
        const isLink = selectedContent.match(/^\[.*\]\(.*\)$/) ||
                      (beforeText.endsWith('[') && afterText.match(/\]\(.*\)/));
        
        if (isLink) {
          if (selectedContent.match(/^\[.*\]\(.*\)$/)) {
            rangeStart = selectionStart;
            rangeEnd = selectionEnd;
          } else {
            const beforeLink = beforeText.lastIndexOf('[');
            const afterCloseParen = afterText.indexOf(')') + 1;
            if (beforeLink !== -1 && afterCloseParen !== -1) {
              rangeStart = beforeLink;
              rangeEnd = selectionEnd + afterCloseParen;
            }
          }
        }
        break;
      }
    }
    
    return { rangeStart, rangeEnd };
  };

  const handleFormat = (e: React.MouseEvent, type: string) => {
    e.preventDefault();
    e.stopPropagation();

    const { rangeStart, rangeEnd } = getFormattedTextRange(type);
    const selectedContent = value.substring(rangeStart, rangeEnd);
    
    let newText: string;
    let newSelectionStart: number;
    let newSelectionEnd: number;

    switch (type) {
      case 'bold': {
        const isBold = selectedContent.startsWith('**') && selectedContent.endsWith('**') ||
                      (value.substring(0, rangeStart).endsWith('**') && 
                       value.substring(rangeEnd).startsWith('**'));
        
        if (isBold) {
          const unformattedText = selectedContent.replace(/^\*\*|\*\*$/g, '');
          newText = value.substring(0, rangeStart) + unformattedText + value.substring(rangeEnd);
          newSelectionStart = rangeStart;
          newSelectionEnd = rangeStart + unformattedText.length;
        } else {
          newText = value.substring(0, selectionStart) + `**${selectedText}**` + value.substring(selectionEnd);
          newSelectionStart = selectionStart + 2;
          newSelectionEnd = selectionStart + selectedText.length + 2;
        }
        break;
      }
      
      case 'italic': {
        const isItalic = selectedContent.startsWith('*') && selectedContent.endsWith('*') && 
                        !selectedContent.startsWith('**') && !selectedContent.endsWith('**') ||
                        (value.substring(0, rangeStart).endsWith('*') && 
                         !value.substring(0, rangeStart).endsWith('**') && 
                         value.substring(rangeEnd).startsWith('*') && 
                         !value.substring(rangeEnd).startsWith('**'));
        
        if (isItalic) {
          const unformattedText = selectedContent.replace(/^\*|\*$/g, '');
          newText = value.substring(0, rangeStart) + unformattedText + value.substring(rangeEnd);
          newSelectionStart = rangeStart;
          newSelectionEnd = rangeStart + unformattedText.length;
        } else {
          newText = value.substring(0, selectionStart) + `*${selectedText}*` + value.substring(selectionEnd);
          newSelectionStart = selectionStart + 1;
          newSelectionEnd = selectionStart + selectedText.length + 1;
        }
        break;
      }
      
      case 'code': {
        const isCode = selectedContent.startsWith('```\n') && selectedContent.endsWith('\n```') ||
                      (value.substring(0, rangeStart).endsWith('```\n') && 
                       value.substring(rangeEnd).startsWith('\n```'));
        
        if (isCode) {
          const unformattedText = selectedContent.replace(/^```\n|\n```$/g, '');
          newText = value.substring(0, rangeStart) + unformattedText + value.substring(rangeEnd);
          newSelectionStart = rangeStart;
          newSelectionEnd = rangeStart + unformattedText.length;
        } else {
          newText = value.substring(0, selectionStart) + `\`\`\`\n${selectedText}\n\`\`\`` + value.substring(selectionEnd);
          newSelectionStart = selectionStart + 4;
          newSelectionEnd = selectionStart + selectedText.length + 4;
        }
        break;
      }
      
      case 'link': {
        const isLink = selectedContent.match(/^\[.*\]\(.*\)$/) ||
                      (value.substring(0, rangeStart).endsWith('[') && 
                       value.substring(rangeEnd).match(/^\]\(.*\)/));
        
        if (isLink) {
          const linkMatch = selectedContent.match(/^\[(.*)\]\((.*)\)$/);
          if (linkMatch) {
            newText = value.substring(0, rangeStart) + linkMatch[1] + value.substring(rangeEnd);
            newSelectionStart = rangeStart;
            newSelectionEnd = rangeStart + linkMatch[1].length;
          } else {
            // Handle case where link markers are outside selection
            const linkText = value.substring(rangeStart + 1, value.substring(rangeStart).indexOf(']') + rangeStart);
            newText = value.substring(0, rangeStart) + linkText + value.substring(rangeEnd);
            newSelectionStart = rangeStart;
            newSelectionEnd = rangeStart + linkText.length;
          }
        } else {
          newText = value.substring(0, selectionStart) + `[${selectedText}]()` + value.substring(selectionEnd);
          newSelectionStart = selectionStart + selectedText.length + 3;
          newSelectionEnd = newSelectionStart;
        }
        break;
      }
      
      default:
        return;
    }

    onTextChange(newText, newSelectionStart, newSelectionEnd);
    
    if (onSelectionUpdate) {
      onSelectionUpdate(newSelectionStart, newSelectionEnd);
    }
  };

  return (
    <div 
      className="absolute flex items-center gap-2 px-2.5 py-1.5 rounded-[1000px] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-all duration-150 backdrop-blur-sm"
      style={style}
    >
      <Button 
        size="icon" 
        variant="ghost" 
        className={`h-7 w-7 text-black/70 dark:text-white/70 bg-transparent hover:bg-black/10 dark:hover:bg-white/10 ${
          isPreview ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={(e) => handleFormat(e, 'bold')}
        disabled={isPreview}
      >
        <Bold className="h-4 w-4" />
      </Button>
      <Button 
        size="icon" 
        variant="ghost" 
        className={`h-7 w-7 text-black/70 dark:text-white/70 bg-transparent hover:bg-black/10 dark:hover:bg-white/10 ${
          isPreview ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={(e) => handleFormat(e, 'italic')}
        disabled={isPreview}
      >
        <Italic className="h-4 w-4" />
      </Button>
      <Button 
        size="icon" 
        variant="ghost" 
        className={`h-7 w-7 text-black/70 dark:text-white/70 bg-transparent hover:bg-black/10 dark:hover:bg-white/10 ${
          isPreview ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={(e) => handleFormat(e, 'code')}
        disabled={isPreview}
      >
        <Code className="h-4 w-4" />
      </Button>
      <Button 
        size="icon" 
        variant="ghost" 
        className={`h-7 w-7 text-black/70 dark:text-white/70 bg-transparent hover:bg-black/10 dark:hover:bg-white/10 ${
          isPreview ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={(e) => handleFormat(e, 'link')}
        disabled={isPreview}
      >
        <Link className="h-4 w-4" />
      </Button>
      <Button 
        size="icon" 
        variant="ghost" 
        className={`h-7 w-7 text-black/70 dark:text-white/70 bg-transparent hover:bg-black/10 dark:hover:bg-white/10 ${
          isPreview ? 'bg-black/10 dark:bg-white/10' : ''
        }`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onPreviewToggle();
        }}
      >
        <Eye className="h-4 w-4" />
      </Button>
    </div>
  );
};