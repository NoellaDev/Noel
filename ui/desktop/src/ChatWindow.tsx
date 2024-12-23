import React, { useEffect, useRef, useState } from 'react';
import { Message, useChat } from './ai-sdk-fork/useChat';
import { Route, Routes, Navigate } from 'react-router-dom';
import { getApiUrl } from './config';
import { Card } from './components/ui/card';
import { ScrollArea } from './components/ui/scroll-area';
import Splash from './components/Splash';
import GooseMessage from './components/GooseMessage';
import UserMessage from './components/UserMessage';
import Input from './components/Input';
import MoreMenu from './components/MoreMenu';
import BottomMenu from './components/BottomMenu';
import LoadingGoose from './components/LoadingGoose';
import { ApiKeyWarning } from './components/ApiKeyWarning';
import { askAi } from './utils/askAI';
import WingToWing, { Working } from './components/WingToWing';
import { WelcomeScreen } from './components/WelcomeScreen';
import FlappyGoose from './components/FlappyGoose';
import { Attachment } from './components/AttachmentPreview';

interface CustomSubmitEvent extends CustomEvent {
  detail: {
    value: string;
    attachments?: Attachment[];
    experimental_attachments?: Array<{
      name: string;
      contentType: string;
      url: string;
    }>;
  };
}

interface ExtendedMessage extends Omit<Message, 'id'> {
  attachments?: Attachment[];
  experimental_attachments?: Array<{
    name: string;
    contentType: string;
    url: string;
  }>;
}

export interface Chat {
  id: number;
  title: string;
  messages: Message[];
}

// update this when you want to show the welcome screen again - doesn't have to be an actual version, just anything woudln't have been seen before
const CURRENT_VERSION = '0.0.0';

// Get the last version from localStorage
const getLastSeenVersion = () => localStorage.getItem('lastSeenVersion');
const setLastSeenVersion = (version: string) => localStorage.setItem('lastSeenVersion', version);

function ChatContent({
  chats,
  setChats,
  selectedChatId,
  setSelectedChatId,
  initialQuery,
  setProgressMessage,
  setWorking,
}: {
  chats: Chat[];
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
  selectedChatId: number;
  setSelectedChatId: React.Dispatch<React.SetStateAction<number>>;
  initialQuery: string | null;
  setProgressMessage: React.Dispatch<React.SetStateAction<string>>;
  setWorking: React.Dispatch<React.SetStateAction<Working>>;
}) {
  const chat = chats.find((c: Chat) => c.id === selectedChatId);
  const [messageMetadata, setMessageMetadata] = useState<Record<string, string[]>>({});
  const [hasMessages, setHasMessages] = useState(false);
  const [lastInteractionTime, setLastInteractionTime] = useState<number>(Date.now());
  const [showGame, setShowGame] = useState(false);

  const {
    messages,
    append,
    stop,
    isLoading,
    error,
    setMessages,
  } = useChat({
    api: getApiUrl('/reply'),
    initialMessages: chat?.messages || [],
    onToolCall: ({ toolCall }) => {
      setWorking(Working.Working);
      setProgressMessage(`Executing tool: ${toolCall.toolName}`);
    },
    onResponse: (response) => {
      if (!response.ok) {
        setProgressMessage('An error occurred while receiving the response.');
        setWorking(Working.Idle);
      } else {
        setProgressMessage('thinking...');
        setWorking(Working.Working);
      }
    },
    onFinish: async (message, options) => {
      setProgressMessage('Task finished. Click here to expand.');
      setWorking(Working.Idle);
      
      const fetchResponses = await askAi(message.content);
      setMessageMetadata((prev) => ({ ...prev, [message.id]: fetchResponses }));
      
      // Only show notification if it's been more than a minute since last interaction
      const timeSinceLastInteraction = Date.now() - lastInteractionTime;
      window.electron.logInfo("last interaction:" + lastInteractionTime);
      if (timeSinceLastInteraction > 60000) { // 60000ms = 1 minute
        
        window.electron.showNotification({title: 'Goose finished the task.', body: 'Click here to expand.'});
      }
    },
  });

  // Update chat messages when they change
  useEffect(() => {
    const updatedChats = chats.map((c) =>
      c.id === selectedChatId ? { ...c, messages } : c
    );
    setChats(updatedChats);
  }, [messages, selectedChatId]);

  const initialQueryAppended = useRef(false);
  useEffect(() => {
    if (initialQuery && !initialQueryAppended.current) {
      append({ role: 'user', content: initialQuery });
      initialQueryAppended.current = true;
    }
  }, [initialQuery]);

  useEffect(() => {
    if (messages.length > 0) {
      setHasMessages(true);
    }
  }, [messages]);

  const handleSubmit = (e: CustomSubmitEvent) => {
    const content = e.detail.value || '';
    console.log('ChatWindow: Handling submit:', {
      content,
      attachments: e.detail.attachments,
      experimental: e.detail.experimental_attachments
    });
    
    if (content.trim() || e.detail.attachments?.length) {
      setLastInteractionTime(Date.now());
      const message: ExtendedMessage = {
        role: 'user',
        content: content,
        attachments: e.detail.attachments,
        experimental_attachments: e.detail.experimental_attachments
      };
      console.log('ChatWindow: Appending message:', message);
      append(message as unknown as Message);
    }
  };

  if (error) {
    console.log('Error:', error);
  }

  const onStopGoose = () => {
    stop();
    setLastInteractionTime(Date.now()); // Update last interaction time

    const lastMessage: Message = messages[messages.length - 1];
    if (lastMessage.role === 'user' && lastMessage.toolInvocations === undefined) {
      // TODO: Using setInput seems to change the ongoing request message and prevents stop from stopping.
      // It would be nice to find a way to populate the input field with the last message when interrupted.
      // setInput("stop");

      // Remove the last user message.
      if (messages.length > 1) {
        setMessages(messages.slice(0, -1));
      } else {
        setMessages([]);
      }
    } else if (lastMessage.role === 'assistant' && lastMessage.toolInvocations !== undefined) {
      // Add messaging about interrupted ongoing tool invocations.
      const newLastMessage: Message = {
          ...lastMessage,
          toolInvocations: lastMessage.toolInvocations.map((invocation) => {
            if (invocation.state !== 'result') {
              return {
                ...invocation,
                result: [
                  {
                    "audience": [
                      "user"
                    ],
                    "text": "Interrupted.\n",
                    "type": "text"
                  },
                  {
                    "audience": [
                      "assistant"
                    ],
                    "text": "Interrupted by the user to make a correction.\n",
                    "type": "text"
                  }
                ],
                state: 'result',
              };
          } else {
            return invocation;
          }
        }),
      };

      const updatedMessages = [...messages.slice(0, -1), newLastMessage];
      setMessages(updatedMessages);
    }
  };

  return (
    <div className="chat-content flex flex-col w-full h-screen items-center justify-center p-[10px]">
      <div className="relative block h-[20px] w-full">
        <MoreMenu />
      </div>
      <Card className="flex flex-col flex-1 h-[calc(100vh-95px)] w-full bg-card-gradient dark:bg-dark-card-gradient mt-0 border-none rounded-2xl relative">
        {messages.length === 0 ? (
          <Splash append={append} />
        ) : (
          <ScrollArea className="flex-1" id="chat-scroll-area">
            <div className="px-[10px]">
              <div className="block h-10" />
              <div ref={(el) => {
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
              }}>
                {messages.map((message) => (
                  <div key={message.id}>
                    {message.role === 'user' ? (
                      <UserMessage message={message} />
                    ) : (
                      <GooseMessage
                        message={message}
                        messages={messages}
                        metadata={messageMetadata[message.id]}
                        append={append}
                      />
                    )}
                  </div>
                ))}
              </div>
              {isLoading && (
                <div className="flex items-center justify-center p-4">
                  <div onClick={() => setShowGame(true)} style={{ cursor: 'pointer' }}>
                    <LoadingGoose />
                  </div>
                </div>
              )}
              {error && (
                <div className="flex flex-col items-center justify-center p-4">
                  <div className="text-red-700 dark:text-red-300 bg-red-400/50 p-3 rounded-lg mb-2">
                    {error.message || 'Honk! Goose experienced an error while responding'}
                    {error.status && (
                      <span className="ml-2">(Status: {error.status})</span>
                    )}
                  </div>
                  <div
                    className="p-4 text-center text-splash-pills-text whitespace-nowrap cursor-pointer bg-prev-goose-gradient dark:bg-dark-prev-goose-gradient text-prev-goose-text dark:text-prev-goose-text-dark rounded-[14px] inline-block hover:scale-[1.02] transition-all duration-150"
                    onClick={async () => {
                      const lastUserMessage = messages.reduceRight((found, m) => found || (m.role === 'user' ? m : null), null);
                      if (lastUserMessage) {
                        append({
                          role: 'user',
                          content: lastUserMessage.content
                        });
                      }
                    }}>
                    Retry Last Message
                  </div>
                </div>
              )}
              <div className="block h-10" />
            </div>
          </ScrollArea>
        )}

        <Input
          handleSubmit={handleSubmit}
          disabled={isLoading}
          isLoading={isLoading}
          onStop={onStopGoose}
        />
        <div className="self-stretch h-px bg-black/5 dark:bg-white/5 rounded-sm" />
        <BottomMenu hasMessages={hasMessages} />
      </Card>

      {showGame && (
        <FlappyGoose onClose={() => setShowGame(false)} />
      )}
    </div>
  );
}

export default function ChatWindow() {
  // Shared function to create a chat window
  const openNewChatWindow = () => {
    window.electron.createChatWindow();
  };

  // Add keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Command+N (Mac) or Control+N (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === 'n') {
        event.preventDefault(); // Prevent default browser behavior
        openNewChatWindow();
      }
    };

    // Add event listener
    window.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Check if API key is missing from the window arguments
  const apiCredsMissing = window.electron.getConfig().apiCredsMissing;

  // Get initial query and history from URL parameters
  const searchParams = new URLSearchParams(window.location.search);
  const initialQuery = searchParams.get('initialQuery');
  const historyParam = searchParams.get('history');
  const initialHistory = historyParam ? JSON.parse(decodeURIComponent(historyParam)) : [];

  const [chats, setChats] = useState<Chat[]>(() => {
    const firstChat = {
      id: 1,
      title: initialQuery || 'Chat 1',
      messages: initialHistory.length > 0 ? initialHistory : [],
    };
    return [firstChat];
  });

  const [selectedChatId, setSelectedChatId] = useState(1);
  const [mode, setMode] = useState<'expanded' | 'compact'>(
    initialQuery ? 'compact' : 'expanded'
  );
  const [working, setWorking] = useState<Working>(Working.Idle);
  const [progressMessage, setProgressMessage] = useState<string>('');

  // Welcome screen state
  const [showWelcome, setShowWelcome] = useState(() => {
    const lastVersion = getLastSeenVersion();
    return !lastVersion || lastVersion !== CURRENT_VERSION;
  });

  const handleWelcomeDismiss = () => {
    setShowWelcome(false);
    setLastSeenVersion(CURRENT_VERSION);
  };

  const toggleMode = () => {
    const newMode = mode === 'expanded' ? 'compact' : 'expanded';
    console.log(`Toggle to ${newMode}`);
    setMode(newMode);
  };

  window.electron.logInfo('ChatWindow loaded');

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-window-gradient dark:bg-dark-window-gradient">
      <div className="titlebar-drag-region" />
      {apiCredsMissing ? (
        <div className="w-full h-full">
          <ApiKeyWarning className="w-full h-full" />
        </div>
      ) : showWelcome && (!window.appConfig.get("REQUEST_DIR")) ? (
        <div className="w-full h-full">
          <WelcomeScreen className="w-full h-full" onDismiss={handleWelcomeDismiss} />
        </div>
      ) : (
        <>
          <div style={{ display: mode === 'expanded' ? 'block' : 'none' }}>
            <Routes>
              <Route
                path="/chat/:id"
                element={
                  <ChatContent
                    key={selectedChatId}
                    chats={chats}
                    setChats={setChats}
                    selectedChatId={selectedChatId}
                    setSelectedChatId={setSelectedChatId}
                    initialQuery={initialQuery}
                    setProgressMessage={setProgressMessage}
                    setWorking={setWorking}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/chat/1" replace />} />
            </Routes>
          </div>

          <WingToWing onExpand={toggleMode} progressMessage={progressMessage} working={working} />
        </>
      )}
    </div>
  );
}

declare global {
  interface Window {
    electron: {
      hideWindow: () => void;
      createChatWindow: (query: string) => void;
      notify: (data: { title: string; body: string }) => void;
      logInfo: (info: string) => void;
    };
  }
}