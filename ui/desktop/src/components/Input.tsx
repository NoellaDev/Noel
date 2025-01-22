import React, { useRef, useState, useEffect } from "react";
import { Button } from "./ui/button";
import Stop from "./ui/Stop";
import { Attach, Send } from "./icons";
import { InputPreview } from "./InputPreview";
import { FloatingToolbar } from "./FloatingToolbar";
import { useSelectionCoords } from '../hooks/useSelectionCoords';

interface InputProps {
  handleSubmit: (e: React.FormEvent) => void;
  disabled?: boolean;
  isLoading?: boolean;
  onStop?: () => void;
}

declare global {
  interface Window {
    electron: {
      selectFileOrDirectory: () => Promise<string | null>;
    };
  }
}

export default function Input({
  handleSubmit,
  disabled = false,
  isLoading = false,
  onStop,
}: InputProps) {
  const [value, setValue] = useState("");
  const [isPreview, setIsPreview] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const { selectionCoords, updateSelection, handleScroll, updateSelectionAfterFormat } = useSelectionCoords({
    textAreaRef,
    editorRef
  });

  useEffect(() => {
    if (textAreaRef.current && !disabled) {
      textAreaRef.current.focus();
    }
  }, [disabled, value]);

  const [textAreaHeight, setTextAreaHeight] = useState<number>(0);
  const [scrollPosition, setScrollPosition] = useState(0);

  const useAutosizeTextArea = (
    textAreaRef: HTMLTextAreaElement | null,
    value: string
  ) => {
    useEffect(() => {
      if (textAreaRef) {
        // Store current scroll position
        const scrollTop = textAreaRef.scrollTop;
        
        // Temporarily reset height to recalculate
        textAreaRef.style.height = "0px";
        const scrollHeight = textAreaRef.scrollHeight;
        
        // Set new height
        const newHeight = Math.min(scrollHeight, maxHeight);
        textAreaRef.style.height = newHeight + "px";
        setTextAreaHeight(newHeight);
        
        // Restore scroll position
        textAreaRef.scrollTop = scrollTop;
      }
    }, [textAreaRef, value]);
  };

  // Preserve height and scroll position when toggling preview mode
  useEffect(() => {
    if (textAreaRef.current && !isPreview) {
      textAreaRef.current.style.height = `${textAreaHeight}px`;
      // Restore scroll position after a brief delay to ensure the DOM has updated
      requestAnimationFrame(() => {
        if (textAreaRef.current) {
          textAreaRef.current.scrollTop = scrollPosition;
        }
      });
    }
  }, [isPreview, textAreaHeight, scrollPosition]);

  const minHeight = "1rem";
  const maxHeight = 10 * 24;

  useAutosizeTextArea(textAreaRef.current, value);

  const handleChange = (evt: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = evt.target?.value;
    setValue(val);
  };

  const handleKeyDown = (evt: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (evt.key === "Enter" && !evt.shiftKey) {
      evt.preventDefault();
      if (value.trim()) {
        handleSubmit(new CustomEvent("submit", { detail: { value } }));
        setValue("");
      }
    }
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      handleSubmit(new CustomEvent("submit", { detail: { value } }));
      setValue("");
    }
  };

  const handleFileSelect = async () => {
    const path = await window.electron.selectFileOrDirectory();
    if (path) {
      setValue(path);
      textAreaRef.current?.focus();
    }
  };

  const handleTextChange = (newText: string, newSelectionStart: number, newSelectionEnd: number) => {
    setValue(newText);
    
    // Use requestAnimationFrame to ensure DOM updates are complete
    requestAnimationFrame(() => {
      if (textAreaRef.current) {
        textAreaRef.current.focus();
        textAreaRef.current.setSelectionRange(newSelectionStart, newSelectionEnd);
        updateSelectionAfterFormat(newSelectionStart, newSelectionEnd);
      }
    });
  };

  // Store scroll position before toggling preview
  const handlePreviewToggle = () => {
    if (textAreaRef.current) {
      setScrollPosition(textAreaRef.current.scrollTop);
    }
    setIsPreview(!isPreview);
  };

  return (
    <form
      onSubmit={onFormSubmit}
      className="flex relative h-auto px-[16px] pr-[68px] py-[1rem] border-t dark:border-gray-700"
    >
      <div className="relative flex-1">
        <div className="relative" style={{
          minHeight: `${minHeight}px`,
          maxHeight: `${maxHeight}px`,
          height: 'auto'
        }}>
          {isPreview ? (
            <InputPreview 
              text={value} 
              previewRef={previewRef}
            />
          ) : (
            <>
              <textarea
                autoFocus
                id="dynamic-textarea"
                placeholder="What should goose do?"
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onSelect={updateSelection}
                onScroll={handleScroll}
                disabled={disabled}
                ref={textAreaRef}
                rows={1}
                style={{
                  minHeight: `${minHeight}px`,
                  maxHeight: `${maxHeight}px`,
                  overflowY: "auto",
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word'
                }}
                className={`w-full outline-none border-none focus:ring-0 bg-transparent p-0 text-14 resize-none ${
                  disabled ? "cursor-not-allowed opacity-50" : ""
                }`}
              />
              
              {/* Hidden editor for measuring selection */}
              <div
                ref={editorRef}
                className="absolute top-0 left-0 w-full invisible pointer-events-none whitespace-pre-wrap break-words"
                style={{
                  font: 'inherit',
                  display: 'none'
                }}
              />
            </>
          )}
          
          {/* Floating toolbar rendered for both modes */}
          {(selectionCoords && !isPreview) && (
            <FloatingToolbar 
              style={{
                left: `${selectionCoords.x}px`,
                top: `${selectionCoords.y}px`,
                transform: 'translateY(-115%)',
              }}
              value={value}
              selectionStart={selectionCoords.selectionStart || 0}
              selectionEnd={selectionCoords.selectionEnd || 0}
              onTextChange={handleTextChange}
              selectedText={value.substring(
                selectionCoords.selectionStart || 0,
                selectionCoords.selectionEnd || 0
              )}
              isPreview={isPreview}
              onPreviewToggle={handlePreviewToggle}
              onSelectionUpdate={updateSelectionAfterFormat}
            />
          )}
          {/* Show toolbar at top-left corner in preview mode */}
          {isPreview && (
            <FloatingToolbar 
              style={{
                left: 0,
                top: '-4px',
                transform: 'translateY(-115%)',
              }}
              value={value}
              selectionStart={0}
              selectionEnd={0}
              onTextChange={handleTextChange}
              selectedText=""
              isPreview={isPreview}
              onPreviewToggle={handlePreviewToggle}
            />
          )}
        </div>
      </div>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={handleFileSelect}
        disabled={disabled}
        className={`absolute right-[40px] top-1/2 -translate-y-1/2 text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-800 ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        <Attach />
      </Button>
      {isLoading ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onStop}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-indigo-100 dark:bg-indigo-800 dark:text-indigo-200 text-indigo-600 hover:opacity-50 [&_svg]:size-5"
        >
          <Stop size={24} />
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          disabled={disabled || !value.trim()}
          className={`absolute right-2 top-1/2 -translate-y-1/2 text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-800 ${
            disabled || !value.trim() ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          <Send />
        </Button>
      )}
    </form>
  );
}