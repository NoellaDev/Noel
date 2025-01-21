import React, { useEffect, useRef, useState } from "react";
import { Message, useChat } from "./ai-sdk-fork/useChat";
import { Route, Routes, Navigate } from "react-router-dom";
import { getApiUrl, getSecretKey, addMCP, addMCPSystem } from "./config";
import BottomMenu from "./components/BottomMenu";
import FlappyGoose from "./components/FlappyGoose";
import GooseMessage from "./components/GooseMessage";
import Input from "./components/Input";
import LoadingGoose from "./components/LoadingGoose";
import MoreMenu from "./components/MoreMenu";
import Splash from "./components/Splash";
import { Card } from "./components/ui/card";
import { ScrollArea } from "./components/ui/scroll-area";
import UserMessage from "./components/UserMessage";
import WingToWing, { Working } from "./components/WingToWing";
import { askAi } from "./utils/askAI";
import {
  Provider,
} from "./utils/providerUtils";
import { ChatLayout } from "./components/chat_window/ChatLayout"
import { ChatRoutes } from "./components/chat_window/ChatRoutes"
import { WelcomeModal } from "./components/welcome_screen/WelcomeModal"
import { getStoredProvider, initializeSystem } from './utils/providerUtils'

declare global {
  interface Window {
    electron: {
      stopPowerSaveBlocker: () => void;
      startPowerSaveBlocker: () => void;
      hideWindow: () => void;
      createChatWindow: () => void;
      getConfig: () => { GOOSE_PROVIDER: string };
      logInfo: (message: string) => void;
      showNotification: (opts: { title: string; body: string }) => void;
      getBinaryPath: (binary: string) => Promise<string>;
      app: any;
    };
    appConfig: {
      get: (key: string) => any;
    };
  }
}

export interface Chat {
  id: number;
  title: string;
  messages: Array<{
    id: string;
    role: "function" | "system" | "user" | "assistant" | "data" | "tool";
    content: string;
  }>;
}

type ScrollBehavior = "auto" | "smooth" | "instant";

export function ChatContent({
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
  const [messageMetadata, setMessageMetadata] = useState<
    Record<string, string[]>
  >({});
  const [hasMessages, setHasMessages] = useState(false);
  const [lastInteractionTime, setLastInteractionTime] = useState<number>(
    Date.now()
  );
  const [showGame, setShowGame] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [working, setWorkingLocal] = useState<Working>(Working.Idle);

  useEffect(() => {
    setWorking(working);
  }, [working, setWorking]);

  const updateWorking = (newWorking: Working) => {
    setWorkingLocal(newWorking);
  };

  const { messages, append, stop, isLoading, error, setMessages } = useChat({
    api: getApiUrl("/reply"),
    initialMessages: chat?.messages || [],
    onToolCall: ({ toolCall }) => {
      updateWorking(Working.Working);
      setProgressMessage(`Executing tool: ${toolCall.toolName}`);
      requestAnimationFrame(() => scrollToBottom("instant"));
    },
    onResponse: (response) => {
      if (!response.ok) {
        setProgressMessage("An error occurred while receiving the response.");
        updateWorking(Working.Idle);
      } else {
        setProgressMessage("thinking...");
        updateWorking(Working.Working);
      }
    },
    onFinish: async (message, _) => {
      window.electron.stopPowerSaveBlocker();
      setTimeout(() => {
        setProgressMessage("Task finished. Click here to expand.");
        updateWorking(Working.Idle);
      }, 500);

      const fetchResponses = await askAi(message.content);
      setMessageMetadata((prev) => ({ ...prev, [message.id]: fetchResponses }));

      requestAnimationFrame(() => scrollToBottom("smooth"));

      const timeSinceLastInteraction = Date.now() - lastInteractionTime;
      window.electron.logInfo("last interaction:" + lastInteractionTime);
      if (timeSinceLastInteraction > 60000) {
        // 60000ms = 1 minute

        window.electron.showNotification({
          title: "Goose finished the task.",
          body: "Click here to expand.",
        });
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
      append({ role: "user", content: initialQuery });
      initialQueryAppended.current = true;
    }
  }, [initialQuery]);

  useEffect(() => {
    if (messages.length > 0) {
      setHasMessages(true);
    }
  }, [messages]);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior,
        block: "end",
        inline: "nearest",
      });
    }
  };

  // Single effect to handle all scrolling
  useEffect(() => {
    if (isLoading || messages.length > 0 || working === Working.Working) {
      scrollToBottom(
        isLoading || working === Working.Working ? "instant" : "smooth"
      );
    }
  }, [messages, isLoading, working]);

  // Handle submit
  const handleSubmit = (e: React.FormEvent) => {
    window.electron.startPowerSaveBlocker();
    const customEvent = e as CustomEvent;
    const content = customEvent.detail?.value || "";
    if (content.trim()) {
      setLastInteractionTime(Date.now());
      append({
        role: "user",
        content: content,
      });
      scrollToBottom("instant");
    }
  };

  if (error) {
    console.log("Error:", error);
  }

  const onStopGoose = () => {
    stop();
    setLastInteractionTime(Date.now());
    window.electron.stopPowerSaveBlocker();

    const lastMessage: Message = messages[messages.length - 1];
    if (
      lastMessage.role === "user" &&
      lastMessage.toolInvocations === undefined
    ) {
      // Remove the last user message.
      if (messages.length > 1) {
        setMessages(messages.slice(0, -1));
      } else {
        setMessages([]);
      }
    } else if (
      lastMessage.role === "assistant" &&
      lastMessage.toolInvocations !== undefined
    ) {
      // Add messaging about interrupted ongoing tool invocations
      const newLastMessage: Message = {
        ...lastMessage,
        toolInvocations: lastMessage.toolInvocations.map((invocation) => {
          if (invocation.state !== "result") {
            return {
              ...invocation,
              result: [
                {
                  audience: ["user"],
                  text: "Interrupted.\n",
                  type: "text",
                },
                {
                  audience: ["assistant"],
                  text: "Interrupted by the user to make a correction.\n",
                  type: "text",
                },
              ],
              state: "result",
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
    <div className="chat-content flex flex-col w-full h-screen items-center justify-center">
      <div className="relative flex items-center h-[36px] w-full">
        <MoreMenu />
      </div>
      <Card className="flex flex-col flex-1 rounded-none h-[calc(100vh-95px)] w-full bg-card-gradient dark:bg-dark-card-gradient mt-0 border-none relative">
        {messages.length === 0 ? (
          <Splash append={append} />
        ) : (
          <ScrollArea className="flex-1 px-[10px]" id="chat-scroll-area">
            <div className="pt-4">
              {messages.map((message) => (
                <div key={message.id}>
                  {message.role === "user" ? (
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
              {isLoading && (
                <div className="flex items-center justify-center p-4">
                  <div
                    onClick={() => setShowGame(true)}
                    style={{ cursor: "pointer" }}
                  >
                    <LoadingGoose />
                  </div>
                </div>
              )}
              {error && (
                <div className="flex flex-col items-center justify-center p-4">
                  <div className="text-red-700 dark:text-red-300 bg-red-400/50 p-3 rounded-lg mb-2">
                    {error.message ||
                      "Honk! Goose experienced an error while responding"}
                    {error.status && (
                      <span className="ml-2">(Status: {error.status})</span>
                    )}
                  </div>
                  <div
                    className="p-4 text-center text-splash-pills-text whitespace-nowrap cursor-pointer bg-prev-goose-gradient dark:bg-dark-prev-goose-gradient text-prev-goose-text dark:text-prev-goose-text-dark rounded-[14px] inline-block hover:scale-[1.02] transition-all duration-150"
                    onClick={async () => {
                      const lastUserMessage = messages.reduceRight(
                        (found, m) => found || (m.role === "user" ? m : null),
                        null
                      );
                      if (lastUserMessage) {
                        append({
                          role: "user",
                          content: lastUserMessage.content,
                        });
                      }
                    }}
                  >
                    Retry Last Message
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} style={{ height: "1px" }} />
            </div>
            <div className="block h-10" />
          </ScrollArea>
        )}

        <Input
          handleSubmit={handleSubmit}
          disabled={isLoading}
          isLoading={isLoading}
          onStop={onStopGoose}
        />
        <BottomMenu hasMessages={hasMessages} />
      </Card>

      {showGame && <FlappyGoose onClose={() => setShowGame(false)} />}
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
      if ((event.metaKey || event.ctrlKey) && event.key === "n") {
        event.preventDefault(); // Prevent default browser behavior
        openNewChatWindow();
      }
    };

    // Add event listener
    window.addEventListener("keydown", handleKeyDown);

    // Cleanup
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    // Listen for add-system from main process for a goose:// deep link
    window.electron.on("add-system", (_, link) => {
      console.log("Received message for add-system:", link);
      addMCPSystem(link);
    });
  }, []);

  // Get initial query and history from URL parameters
  const searchParams = new URLSearchParams(window.location.search);
  const initialQuery = searchParams.get("initialQuery");
  const historyParam = searchParams.get("history");
  const initialHistory = historyParam
    ? JSON.parse(decodeURIComponent(historyParam))
    : [];

  const [chats, setChats] = useState<Chat[]>(() => {
    const firstChat = {
      id: 1,
      title: initialQuery || "Chat 1",
      messages: initialHistory.length > 0 ? initialHistory : [],
    };
    return [firstChat];
  });

  const [selectedChatId, setSelectedChatId] = useState(1);
  const [mode, setMode] = useState<"expanded" | "compact">(
    initialQuery ? "compact" : "expanded"
  );
  const [working, setWorking] = useState<Working>(Working.Idle);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [selectedProvider, setSelectedProvider] =
      useState<string | Provider | null>(null)
  const [showWelcomeModal, setShowWelcomeModal] = useState(true);

  // Add this useEffect to track changes and update welcome state
  const toggleMode = () => {
    const newMode = mode === "expanded" ? "compact" : "expanded";
    console.log(`Toggle to ${newMode}`);
    setMode(newMode);
  };

  window.electron.logInfo("ChatWindow loaded");

  useEffect(() => {
    // Check if we already have a provider set
    const config = window.electron.getConfig();
    const storedProvider = getStoredProvider(config)

    if (storedProvider) {
      setShowWelcomeModal(false);
    } else {
      setShowWelcomeModal(true);
    }
  }, []);

  const storeSecret = async (key: string, value: string) => {
    const response = await fetch(getApiUrl("/secrets/store"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Secret-Key": getSecretKey(),
      },
      body: JSON.stringify({ key, value }),
    });

    if (!response.ok) {
      throw new Error(`Failed to store secret: ${response.statusText}`);
    }

    return response;
  };

  const handleModalSubmit = async (apiKey: string) => {
    try {
      const trimmedKey = apiKey.trim();

      if (!selectedProvider) {
        throw new Error("No provider selected");
      }

      // Store the API key
      const secretKey = `${selectedProvider.id.toUpperCase()}_API_KEY`;
      await storeSecret(secretKey, trimmedKey);

      // Initialize the system with the selected provider
      await initializeSystem(selectedProvider.id);

      // Save provider selection and close modal
      localStorage.setItem("GOOSE_PROVIDER", selectedProvider.id);
      setShowWelcomeModal(false);
    } catch (error) {
      console.error("Failed to setup provider:", error);
      throw error;
    }
  };

  // Initialize system on load if we have a stored provider
  useEffect(() => {
    const setupStoredProvider = async () => {
      const config = window.electron.getConfig();
      const storedProvider = getStoredProvider(config);
      if (storedProvider) {
        try {
          await initializeSystem(storedProvider);
        } catch (error) {
          console.error("Failed to initialize with stored provider:", error);
        }
      }
    };

    setupStoredProvider();
  }, []);

  return (
      <ChatLayout mode={mode}>
        <ChatRoutes
            chats={chats}
            setChats={setChats}
            selectedChatId={selectedChatId}
            setSelectedChatId={setSelectedChatId}
            setProgressMessage={setProgressMessage}
            setWorking={setWorking}
        />
        <WingToWing
            onExpand={toggleMode}
            progressMessage={progressMessage}
            working={working}
        />
        {showWelcomeModal && (
            <WelcomeModal
                selectedProvider={selectedProvider}
                setSelectedProvider={setSelectedProvider}
                onSubmit={handleModalSubmit}
            />
        )}
      </ChatLayout>
  );
}