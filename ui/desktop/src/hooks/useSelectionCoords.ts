import { useState, RefObject } from 'react';

export interface SelectionCoords {
  x: number;
  y: number;
  absoluteY: number;
  scrollTop: number;
  isPinned?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
}

interface UseSelectionCoordsProps {
  textAreaRef: RefObject<HTMLTextAreaElement>;
  editorRef: RefObject<HTMLDivElement>;
}

export function useSelectionCoords({ textAreaRef, editorRef }: UseSelectionCoordsProps) {
  const [selectionCoords, setSelectionCoords] = useState<SelectionCoords | null>(null);

  const updateSelection = () => {
    const textarea = textAreaRef.current;
    const editor = editorRef.current;
    if (!textarea || !editor) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    if (start === end || start === null || end === null) {
      setSelectionCoords(null);
      return;
    }

    // Copy text and selection to contenteditable div
    editor.textContent = textarea.value;
    
    // Ensure editor has same dimensions and styles as textarea
    const textareaStyles = window.getComputedStyle(textarea);
    editor.style.width = textareaStyles.width;
    editor.style.height = textareaStyles.height;
    editor.style.lineHeight = textareaStyles.lineHeight;
    editor.style.fontSize = textareaStyles.fontSize;
    editor.style.fontFamily = textareaStyles.fontFamily;
    editor.style.padding = textareaStyles.padding;
    editor.style.boxSizing = textareaStyles.boxSizing;
    editor.style.borderWidth = textareaStyles.borderWidth;
    editor.style.whiteSpace = 'pre-wrap';
    editor.style.wordBreak = 'break-word';
    editor.style.display = 'block';
    editor.style.position = 'absolute';
    editor.style.top = '0';
    editor.style.left = '0';

    // Create range for the selection
    const range = document.createRange();
    const textNode = editor.firstChild;
    
    if (textNode) {
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      
      const rects = range.getClientRects();
      if (rects.length > 0) {
        const editorRect = editor.getBoundingClientRect();
        const firstRect = rects[0];
        const toolbarWidth = 200;
        const toolbarHeight = 40; 
        
        // Calculate position relative to editor
        let x = firstRect.left - editorRect.left;
        let y = firstRect.top - editorRect.top - textarea.scrollTop;
        let isPinned = false;
        
        // Check boundaries
        if (y < 0) {
          y = -4;
          x = 0;
          isPinned = true;
        }
        
        // Check right boundary
        if (x + toolbarWidth > editorRect.width) {
          x = editorRect.width - toolbarWidth - 4;
        }
        
        // Check bottom boundary
        if (y + toolbarHeight > editorRect.height) {
          y = editorRect.height - toolbarHeight - 4;
        }

        setSelectionCoords({
          x,
          y,
          absoluteY: firstRect.top - editorRect.top,
          scrollTop: textarea.scrollTop,
          isPinned,
          selectionStart: start,
          selectionEnd: end
        });
      }
    }

    editor.style.display = 'none';
  };

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (selectionCoords) {
      let y = selectionCoords.absoluteY - e.currentTarget.scrollTop;
      let x = selectionCoords.x;
      let isPinned = false;

      // If y would be negative, pin to top-left
      if (y < 0) {
        y = -4;
        x = 0;
        isPinned = true;
      }

      const newCoords = {
        ...selectionCoords,
        x,
        y,
        scrollTop: e.currentTarget.scrollTop,
        isPinned
      };
      
      setSelectionCoords(newCoords);
    }
  };

  const updateSelectionAfterFormat = (start: number, end: number) => {
    if (textAreaRef.current) {
      textAreaRef.current.focus();
      textAreaRef.current.setSelectionRange(start, end);
      updateSelection();
    }
  };

  return {
    selectionCoords,
    updateSelection,
    handleScroll,
    updateSelectionAfterFormat
  };
} 