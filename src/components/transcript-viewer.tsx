'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChatMessage } from '@/components/chat-message';
import { 
  TranscriptMessage, 
  ParticipantRole 
} from '@/types/transcript';
import { formatDate, calculateTokenSummary } from '@/lib/parse-content';
import { useSystemPrompts, useProjectChat, useProjectEvaluation, ChatMessageData } from '@/hooks/use-supabase';

interface TranscriptViewerProps {
  messages: TranscriptMessage[];
  fileName: string;
  onReset: () => void;
  projectId?: string;
  projectName?: string;
  onBackToProjects?: () => void;
}

type ViewTab = 'debate' | 'chat' | 'evaluation';

// Mini avatar for filter
function TabAvatar({ role }: { role: ParticipantRole }) {
  const gradients: Record<ParticipantRole, string> = {
    user: 'from-teal-400 to-emerald-500',
    moderator: 'from-amber-400 to-orange-500',
    claude: 'from-violet-500 to-purple-600',
    gpt: 'from-sky-400 to-blue-500',
  };
  return <div className={`w-4 h-4 rounded-full bg-gradient-to-br ${gradients[role]} shadow-sm`} />;
}

const roleNames: Record<ParticipantRole, string> = {
  user: 'You',
  moderator: 'Maude',
  claude: 'Catherine',
  gpt: 'Gordon',
};

// Parse inline markdown links and citations for chat messages
// Handles: [text](url), ([text](url))
function parseMessageLinks(text: string): React.ReactNode {
  const elements: React.ReactNode[] = [];
  // Regex to match markdown links optionally wrapped in parens for citations
  const linkRegex = /(\(\[([^\]]+)\]\(([^)]+)\)\)|\[([^\]]+)\]\(([^)]+)\))/g;
  
  let lastIndex = 0;
  let match;
  let keyIdx = 0;
  
  while ((match = linkRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      elements.push(<span key={`text-${keyIdx}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    
    // Check if it's a citation (wrapped in parens) or regular link
    const isCitation = match[0].startsWith('(');
    const linkText = isCitation ? match[2] : match[4];
    const linkUrl = isCitation ? match[3] : match[5];
    
    if (isCitation) {
      // Citation badge style
      elements.push(
        <a
          key={`link-${keyIdx}`}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 text-[11px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors border border-blue-200 hover:border-blue-300 no-underline"
          title={linkUrl}
        >
          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="truncate max-w-[120px]">{linkText}</span>
        </a>
      );
    } else {
      // Regular link style
      elements.push(
        <a
          key={`link-${keyIdx}`}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-700 underline underline-offset-2 decoration-blue-300 hover:decoration-blue-500 transition-colors"
        >
          {linkText}
        </a>
      );
    }
    
    lastIndex = match.index + match[0].length;
    keyIdx++;
  }
  
  // Add remaining text after last match
  if (lastIndex < text.length) {
    elements.push(<span key={`text-end-${keyIdx}`}>{text.slice(lastIndex)}</span>);
  }
  
  // If no matches found, return the original text
  if (elements.length === 0) {
    return text;
  }
  
  return elements;
}

// Format chat message content with link parsing
function formatChatContent(content: string): React.ReactNode {
  // Split by newlines to preserve line breaks
  const lines = content.split('\n');
  
  return lines.map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {parseMessageLinks(line)}
    </span>
  ));
}

// Types for chat (use ChatMessageData from hooks for persistence)
type ChatMessage = ChatMessageData;

interface ChatSettings {
  model: 'gpt-5.1' | 'gpt-5' | 'gpt-5-mini' | 'gpt-5-nano';
  reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high';
  verbosity: 'low' | 'medium' | 'high';
  webSearch: boolean;
}

// Citation and SearchStatus types are used by ChatMessageData from use-supabase

// Model config
const MODEL_CONFIG = {
  'gpt-5.1': { 
    name: 'GPT-5.1', 
    desc: 'Most advanced', 
    color: 'from-violet-500 to-purple-600',
    badge: 'bg-violet-500',
  },
  'gpt-5': { 
    name: 'GPT-5', 
    desc: 'Highly capable', 
    color: 'from-indigo-500 to-blue-600',
    badge: 'bg-indigo-500',
  },
  'gpt-5-mini': { 
    name: 'Mini', 
    desc: 'Balanced', 
    color: 'from-cyan-500 to-teal-600',
    badge: 'bg-cyan-500',
  },
  'gpt-5-nano': { 
    name: 'Nano', 
    desc: 'Fast', 
    color: 'from-emerald-500 to-green-600',
    badge: 'bg-emerald-500',
  },
} as const;

// Default system prompts for each model
const DEFAULT_SYSTEM_PROMPTS: Record<string, string> = {
  'gpt-5.1': `You are a highly capable AI assistant powered by GPT-5.1, OpenAI's most advanced model. You excel at complex reasoning, nuanced analysis, and creative problem-solving.

Guidelines:
- Provide thorough, well-structured responses
- Consider multiple perspectives when analyzing topics
- Be direct and confident while acknowledging uncertainty when appropriate
- Use examples and analogies to clarify complex concepts`,

  'gpt-5': `You are a knowledgeable AI assistant powered by GPT-5. You provide helpful, accurate, and balanced responses.

Guidelines:
- Be clear and concise while being thorough
- Structure complex information logically
- Acknowledge limitations in your knowledge
- Provide actionable insights when relevant`,

  'gpt-5-mini': `You are a helpful AI assistant powered by GPT-5 Mini. You provide quick, practical responses.

Guidelines:
- Be concise and to-the-point
- Focus on the most important information
- Use bullet points for clarity when appropriate`,

  'gpt-5-nano': `You are a fast AI assistant powered by GPT-5 Nano. Provide brief, focused responses.

Guidelines:
- Keep responses short and direct
- Prioritize key information
- Be efficient with explanations`,
};

const REASONING_CONFIG = {
  'none': { name: 'None', desc: 'Fastest responses', icon: '⚡' },
  'minimal': { name: 'Minimal', desc: 'Light thinking', icon: '💭' },
  'low': { name: 'Low', desc: 'Some reasoning', icon: '🧠' },
  'medium': { name: 'Medium', desc: 'Balanced', icon: '🎯' },
  'high': { name: 'High', desc: 'Deep analysis', icon: '🔬' },
} as const;

// Chat Tab Component
function ChatTab({ 
  messages, 
  fileName,
  chatMessages,
  setChatMessages,
  projectId,
  onClearChat,
}: { 
  messages: TranscriptMessage[]; 
  fileName: string;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  projectId?: string;
  onClearChat?: () => void;
}) {
  const [attachedMessages, setAttachedMessages] = useState<number[]>([]);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Edit message state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const userScrolledRef = useRef(false); // Tracks manual user scroll, not reset by content updates
  const lastScrollTopRef = useRef(0); // Track scroll position to detect user scroll direction
  
  const [settings, setSettings] = useState<ChatSettings>({
    model: 'gpt-5.1',
    reasoningEffort: 'medium',
    verbosity: 'medium',
    webSearch: true,
  });

  // System prompts - persisted to Supabase (scoped to project)
  const { 
    prompts: systemPrompts, 
    isLoading: promptsLoading, 
    isSynced: promptsSynced,
    savePrompt, 
    resetPrompt 
  } = useSystemPrompts(DEFAULT_SYSTEM_PROMPTS, projectId);
  
  const [editingPrompt, setEditingPrompt] = useState<string>('');
  const [selectedPromptModel, setSelectedPromptModel] = useState<string>('gpt-5.1');

  // Get current system prompt for active model
  const currentSystemPrompt = systemPrompts[settings.model] || DEFAULT_SYSTEM_PROMPTS[settings.model] || '';

  // Reset reasoning effort if model doesn't support 'none'
  useEffect(() => {
    if (settings.reasoningEffort === 'none' && settings.model !== 'gpt-5.1') {
      setSettings(s => ({ ...s, reasoningEffort: 'minimal' }));
    }
  }, [settings.model, settings.reasoningEffort]);

  // Disable web search if 'minimal' reasoning is selected (API incompatibility)
  useEffect(() => {
    if (settings.reasoningEffort === 'minimal' && settings.webSearch) {
      setSettings(s => ({ ...s, webSearch: false }));
    }
  }, [settings.reasoningEffort, settings.webSearch]);

  // Check if web search is disabled due to reasoning effort
  const isWebSearchDisabled = settings.reasoningEffort === 'minimal';

  const userMessages = useMemo(() => {
    return messages
      .map((msg, index) => ({ msg, index }))
      .filter(({ msg }) => msg.role === 'user');
  }, [messages]);

  const toggleMessage = (index: number) => {
    setAttachedMessages(prev => 
      prev.includes(index) 
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  const removeMessage = (index: number) => {
    setAttachedMessages(prev => prev.filter(i => i !== index));
  };

  const selectAllMessages = () => {
    setAttachedMessages(userMessages.map(({ index }) => index));
  };

  const clearAllMessages = () => {
    setAttachedMessages([]);
  };

  // Track scroll position to detect if user has scrolled up
  const handleScroll = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isAtBottom = distanceFromBottom <= 100;
    
    // Detect if user manually scrolled UP (scrollTop decreased or they're not at bottom)
    if (scrollTop < lastScrollTopRef.current - 10) {
      // User scrolled up - mark as manually scrolled
      userScrolledRef.current = true;
    } else if (isAtBottom) {
      // User scrolled back to bottom - reset the manual scroll flag
      userScrolledRef.current = false;
    }
    
    lastScrollTopRef.current = scrollTop;
    setIsUserScrolledUp(!isAtBottom);
  }, []);

  // Auto-scroll to bottom when new messages arrive, only if user hasn't manually scrolled up
  const isStreaming = chatMessages.some(m => m.isStreaming);
  useEffect(() => {
    // Don't auto-scroll if user has manually scrolled up
    if (userScrolledRef.current) return;
    
    const container = chatContainerRef.current;
    if (!container) return;
    
    // During streaming, scroll immediately (no animation) to prevent fighting with user
    // After streaming, use smooth scroll for new messages
    if (isStreaming) {
      container.scrollTop = container.scrollHeight;
    } else if (!isUserScrolledUp) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isUserScrolledUp, isStreaming]);

  // Scroll to bottom when user sends a new message (reset scroll behavior)
  const scrollToBottom = useCallback(() => {
    userScrolledRef.current = false; // Reset manual scroll tracking
    setIsUserScrolledUp(false);
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleSend = async () => {
    const hasInput = inputValue.trim().length > 0;
    const hasContext = attachedMessages.length > 0;
    
    // Allow sending if there's input text OR attached context
    if ((!hasInput && !hasContext) || isLoading) return;

    // Build user message content
    let displayContent = inputValue.trim();
    if (!hasInput && hasContext) {
      // User is sending only context, show a summary
      displayContent = `[Analyze ${attachedMessages.length} attached message${attachedMessages.length > 1 ? 's' : ''}]`;
    }

    // Generate proper UUIDs for Supabase compatibility
    const userMessageId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: displayContent,
    };

    setChatMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setAttachedMessages([]); // Clear attached context after sending
    setIsLoading(true);
    scrollToBottom(); // Reset scroll position when sending a new message

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Create assistant message placeholder
    setChatMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    }]);

    try {
      // Get context from attached messages
      const context = attachedMessages.map(idx => messages[idx].content);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...chatMessages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
          })),
          settings,
          context,
          systemPrompt: currentSystemPrompt,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'Failed to send message');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No reader available');

      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'content') {
                fullContent += data.content;
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, content: fullContent }
                    : m
                ));
              } else if (data.type === 'thinking') {
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, thinking: (m.thinking || '') + data.content }
                    : m
                ));
              } else if (data.type === 'search_started' || data.type === 'search_searching') {
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, searchStatus: { searching: true, completed: false } }
                    : m
                ));
              } else if (data.type === 'search_completed') {
                // Sources are now sent directly at the top level from the API
                const sources = data.sources || data.action?.sources || [];
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, searchStatus: { searching: false, completed: true, sources } }
                    : m
                ));
              } else if (data.type === 'citation') {
                // Only add valid citations with url property
                if (data.citation && data.citation.url) {
                  setChatMessages(prev => prev.map(m => 
                    m.id === assistantId 
                      ? { ...m, citations: [...(m.citations || []), data.citation] }
                      : m
                  ));
                }
              } else if (data.type === 'done') {
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, isStreaming: false }
                    : m
                ));
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setChatMessages(prev => prev.map(m => 
        m.id === assistantId 
          ? { ...m, content: `⚠️ Error: ${errorMessage}\n\nMake sure you have set OPENAI_API_KEY in your .env.local file.`, isStreaming: false }
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setInputValue(prompt);
    textareaRef.current?.focus();
  };

  const clearChatHandler = () => {
    setChatMessages([]);
    onClearChat?.();
  };

  // Start editing a message
  const startEditMessage = (msg: ChatMessage) => {
    setEditingMessageId(msg.id);
    setEditingContent(msg.content);
  };

  // Cancel editing
  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingContent('');
  };

  // Save edit and re-run from that point
  const saveEditAndRerun = async () => {
    if (!editingMessageId || !editingContent.trim()) return;

    // Find the index of the message being edited
    const editIndex = chatMessages.findIndex(m => m.id === editingMessageId);
    if (editIndex === -1) return;

    // Keep only messages before this one, plus the edited message
    const messagesToKeep = chatMessages.slice(0, editIndex);
    const editedMessage: ChatMessage = {
      ...chatMessages[editIndex],
      content: editingContent.trim(),
    };

    // Update state
    setChatMessages([...messagesToKeep, editedMessage]);
    setEditingMessageId(null);
    setEditingContent('');
    setIsLoading(true);
    scrollToBottom();

    // Generate new assistant response
    const assistantId = crypto.randomUUID();
    setChatMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    }]);

    try {
      const context = attachedMessages.map(idx => messages[idx].content);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messagesToKeep, editedMessage].map(m => ({
            role: m.role,
            content: m.content,
          })),
          settings,
          context,
          systemPrompt: currentSystemPrompt,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'Failed to send message');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No reader available');

      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'content') {
                fullContent += data.content;
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, content: fullContent }
                    : m
                ));
              } else if (data.type === 'thinking') {
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, thinking: (m.thinking || '') + data.content }
                    : m
                ));
              } else if (data.type === 'search_started' || data.type === 'search_searching') {
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, searchStatus: { searching: true, completed: false } }
                    : m
                ));
              } else if (data.type === 'search_completed') {
                const sources = data.sources || data.action?.sources || [];
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, searchStatus: { searching: false, completed: true, sources } }
                    : m
                ));
              } else if (data.type === 'citation') {
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, citations: [...(m.citations || []), data.citation] }
                    : m
                ));
              } else if (data.type === 'done') {
                setChatMessages(prev => prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, isStreaming: false }
                    : m
                ));
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setChatMessages(prev => prev.map(m => 
        m.id === assistantId 
          ? { ...m, content: `⚠️ Error: ${errorMessage}`, isStreaming: false }
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a message and all subsequent messages
  const deleteMessageAndAfter = (messageId: string) => {
    const deleteIndex = chatMessages.findIndex(m => m.id === messageId);
    if (deleteIndex === -1) return;
    
    // Keep only messages before this one
    setChatMessages(chatMessages.slice(0, deleteIndex));
  };

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Header with settings */}
      <div className="flex-shrink-0 border-b border-stone-100 bg-white">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Model selector - subtle dropdown style */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-stone-400">Model:</span>
              <div className="flex items-center bg-stone-50 border border-stone-200 rounded-lg p-0.5">
                {(Object.keys(MODEL_CONFIG) as Array<keyof typeof MODEL_CONFIG>).map((model) => {
                  const config = MODEL_CONFIG[model];
                  const isActive = settings.model === model;
                  return (
                    <button
                      key={model}
                      onClick={() => setSettings(s => ({ ...s, model }))}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                        isActive 
                          ? 'bg-white text-stone-800 shadow-sm' 
                          : 'text-stone-400 hover:text-stone-600'
                      }`}
                    >
                      {config.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right side controls */}
            <div className="flex items-center gap-2">
              {chatMessages.length > 0 && (
                <button
                  onClick={clearChatHandler}
                  className="px-3 py-1.5 text-[12px] text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => {
                  setSelectedPromptModel(settings.model);
                  setEditingPrompt(systemPrompts[settings.model] || DEFAULT_SYSTEM_PROMPTS[settings.model] || '');
                  setShowPromptEditor(true);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  systemPrompts[settings.model] !== DEFAULT_SYSTEM_PROMPTS[settings.model]
                    ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' 
                    : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100'
                }`}
                title="Edit system prompt"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                </svg>
                Prompt
                {systemPrompts[settings.model] !== DEFAULT_SYSTEM_PROMPTS[settings.model] && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                )}
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  showSettings 
                    ? 'bg-indigo-100 text-indigo-600' 
                    : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                Settings
              </button>
            </div>
          </div>

          {/* Expandable settings panel */}
          {showSettings && (
            <div className="mt-3 py-4 px-5 bg-stone-50/80 rounded-xl border border-stone-200/80">
              <div className="flex flex-wrap items-start gap-8">
                {/* Reasoning Effort */}
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wider whitespace-nowrap">Reasoning</span>
                  <div className="flex items-center bg-white rounded-lg border border-stone-200 p-0.5 shadow-sm">
                    {(Object.keys(REASONING_CONFIG) as Array<keyof typeof REASONING_CONFIG>).map((effort) => {
                      const config = REASONING_CONFIG[effort];
                      const isActive = settings.reasoningEffort === effort;
                      const isDisabled = effort === 'none' && settings.model !== 'gpt-5.1';
                      
                      return (
                        <button
                          key={effort}
                          onClick={() => !isDisabled && setSettings(s => ({ ...s, reasoningEffort: effort }))}
                          disabled={isDisabled}
                          title={isDisabled ? 'Only available for GPT-5.1' : config.desc}
                          className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                            isDisabled 
                              ? 'opacity-25 cursor-not-allowed text-stone-400' 
                              : isActive 
                                ? 'bg-stone-800 text-white shadow-sm' 
                                : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                          }`}
                        >
                          <span className="text-[13px]">{config.icon}</span>
                          <span>{config.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Response Length */}
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wider whitespace-nowrap">Length</span>
                  <div className="flex items-center bg-white rounded-lg border border-stone-200 p-0.5 shadow-sm">
                    {[
                      { key: 'low' as const, label: 'Concise', icon: '📝' },
                      { key: 'medium' as const, label: 'Balanced', icon: '📄' },
                      { key: 'high' as const, label: 'Detailed', icon: '📚' },
                    ].map(({ key, label, icon }) => (
                      <button
                        key={key}
                        onClick={() => setSettings(s => ({ ...s, verbosity: key }))}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                          settings.verbosity === key 
                            ? 'bg-stone-800 text-white shadow-sm' 
                            : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                        }`}
                      >
                        <span className="text-[13px]">{icon}</span>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Web search incompatibility warning */}
              {settings.reasoningEffort === 'minimal' && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-amber-50/80 border border-amber-200/60 rounded-lg">
                  <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-[11px] text-amber-700">Web search unavailable with Minimal reasoning</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* System Prompt Editor Panel */}
      {showPromptEditor && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowPromptEditor(false)} />
          <div className="relative w-full max-w-2xl bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Panel header */}
            <div className="flex-shrink-0 p-5 border-b border-stone-200 bg-gradient-to-r from-stone-800 to-stone-900">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-[16px] font-semibold text-white">System Prompts</h3>
                    <p className="text-[12px] text-white/60 mt-0.5">Customize AI behavior for each model</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowPromptEditor(false)}
                  className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Model tabs */}
            <div className="flex-shrink-0 border-b border-stone-200 bg-stone-50">
              <div className="flex overflow-x-auto scrollbar-hide">
                {(Object.keys(MODEL_CONFIG) as Array<keyof typeof MODEL_CONFIG>).map((model) => {
                  const config = MODEL_CONFIG[model];
                  const isActive = selectedPromptModel === model;
                  const isModified = systemPrompts[model] !== DEFAULT_SYSTEM_PROMPTS[model];
                  
                  return (
                    <button
                      key={model}
                      onClick={() => {
                        setSelectedPromptModel(model);
                        setEditingPrompt(systemPrompts[model] || DEFAULT_SYSTEM_PROMPTS[model] || '');
                      }}
                      className={`relative flex items-center gap-2 px-5 py-3.5 text-[13px] font-medium whitespace-nowrap transition-all border-b-2 ${
                        isActive 
                          ? 'text-stone-800 border-stone-800 bg-white' 
                          : 'text-stone-500 border-transparent hover:text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${config.color}`} />
                      {config.name}
                      {isModified && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Modified" />
                      )}
                      {config.badge && (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold bg-violet-100 text-violet-600 rounded">
                          {config.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Editor area */}
            <div className="flex-1 flex flex-col min-h-0 p-5">
              {/* Current model info */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${MODEL_CONFIG[selectedPromptModel as keyof typeof MODEL_CONFIG]?.color || 'from-stone-400 to-stone-500'} flex items-center justify-center shadow-md`}>
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-[14px] font-semibold text-stone-800">
                      {MODEL_CONFIG[selectedPromptModel as keyof typeof MODEL_CONFIG]?.name || selectedPromptModel}
                    </h4>
                    <p className="text-[11px] text-stone-500">
                      {MODEL_CONFIG[selectedPromptModel as keyof typeof MODEL_CONFIG]?.desc || 'Custom model'}
                    </p>
                  </div>
                </div>
                
                {/* Reset button */}
                {systemPrompts[selectedPromptModel] !== DEFAULT_SYSTEM_PROMPTS[selectedPromptModel] && (
                  <button
                    onClick={async () => {
                      await resetPrompt(selectedPromptModel);
                      setEditingPrompt(DEFAULT_SYSTEM_PROMPTS[selectedPromptModel] || '');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Reset to default
                  </button>
                )}
              </div>

              {/* Textarea */}
              <div className="flex-1 min-h-0 flex flex-col">
                <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-2">
                  System Instructions
                </label>
                <div className="flex-1 relative">
                  <textarea
                    value={editingPrompt || systemPrompts[selectedPromptModel] || DEFAULT_SYSTEM_PROMPTS[selectedPromptModel] || ''}
                    onChange={(e) => setEditingPrompt(e.target.value)}
                    onBlur={async () => {
                      // Save on blur to Supabase
                      if (editingPrompt && editingPrompt !== systemPrompts[selectedPromptModel]) {
                        await savePrompt(selectedPromptModel, editingPrompt);
                      }
                    }}
                    placeholder="Enter system instructions for this model..."
                    className="absolute inset-0 w-full h-full p-4 text-[14px] leading-relaxed text-stone-700 bg-stone-50 border border-stone-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-stone-400/30 focus:border-stone-400 placeholder:text-stone-400 font-mono"
                  />
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[11px] text-stone-400">
                    {(editingPrompt || systemPrompts[selectedPromptModel] || '').length} characters
                  </span>
                  <span className="text-[11px] text-stone-400 flex items-center gap-1.5">
                    {promptsSynced ? (
                      <>
                        <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-emerald-600">Synced to cloud</span>
                      </>
                    ) : promptsLoading ? (
                      <>
                        <svg className="w-3 h-3 animate-spin text-stone-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        <span>Syncing...</span>
                      </>
                    ) : (
                      <span>Auto-saves on blur</span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick templates */}
            <div className="flex-shrink-0 border-t border-stone-200 bg-stone-50 p-4">
              <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-3">Quick Templates</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Concise', icon: '📝', prompt: 'Be concise and direct. Avoid unnecessary words. Get to the point quickly.' },
                  { label: 'Detailed', icon: '📚', prompt: 'Provide comprehensive, detailed responses. Include examples, explanations, and context. Be thorough.' },
                  { label: 'Technical', icon: '⚙️', prompt: 'Use precise technical language. Include code examples when relevant. Assume technical competency.' },
                  { label: 'Friendly', icon: '😊', prompt: 'Be warm, friendly, and conversational. Use casual language. Make the interaction enjoyable.' },
                  { label: 'Academic', icon: '🎓', prompt: 'Use formal academic tone. Cite reasoning. Structure responses logically with clear arguments.' },
                ].map((template) => (
                  <button
                    key={template.label}
                    onClick={async () => {
                      setEditingPrompt(template.prompt);
                      await savePrompt(selectedPromptModel, template.prompt);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-stone-600 bg-white border border-stone-200 rounded-lg hover:border-stone-300 hover:bg-stone-50 transition-all"
                  >
                    <span>{template.icon}</span>
                    {template.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Panel footer */}
            <div className="flex-shrink-0 p-4 border-t border-stone-200 bg-gradient-to-t from-stone-100 to-stone-50">
              <button
                onClick={async () => {
                  // Save current editing prompt before closing
                  if (editingPrompt && editingPrompt !== systemPrompts[selectedPromptModel]) {
                    await savePrompt(selectedPromptModel, editingPrompt);
                  }
                  setShowPromptEditor(false);
                }}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-stone-800 to-stone-900 hover:from-stone-900 hover:to-black text-white text-[14px] font-bold rounded-xl transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Panel - Slide out */}
      {showContextPanel && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowContextPanel(false)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Panel header */}
            <div className="flex-shrink-0 p-4 border-b border-stone-200 bg-gradient-to-r from-indigo-500 to-purple-600">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-[15px] font-semibold text-white">Select Context</h3>
                  <p className="text-[12px] text-white/70 mt-0.5">Choose messages to include</p>
                </div>
                <button
                  onClick={() => setShowContextPanel(false)}
                  className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Quick actions */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={selectAllMessages}
                  className="flex-1 py-2 px-3 text-[12px] font-medium text-white bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                >
                  Select All ({userMessages.length})
                </button>
                <button
                  onClick={clearAllMessages}
                  className="flex-1 py-2 px-3 text-[12px] font-medium text-white bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Selection summary */}
            <div className="flex-shrink-0 px-4 py-3 bg-stone-50 border-b border-stone-200">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-stone-600">
                  <span className="font-semibold text-indigo-600">{attachedMessages.length}</span> of {userMessages.length} messages selected
                </span>
                {attachedMessages.length > 0 && (
                  <span className="text-[11px] text-stone-400">
                    ~{attachedMessages.reduce((acc, idx) => acc + messages[idx].content.length, 0).toLocaleString()} chars
                  </span>
                )}
              </div>
            </div>

            {/* Message list */}
            <div className="flex-1 overflow-y-auto p-4">
              {userMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-stone-400">
                  <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p className="text-[13px]">No user messages found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {userMessages.map(({ msg, index }, i) => {
                    const isSelected = attachedMessages.includes(index);
                    const preview = msg.content.slice(0, 120) + (msg.content.length > 120 ? '...' : '');
                    
                    return (
                      <button
                        key={index}
                        onClick={() => toggleMessage(index)}
                        className={`group w-full text-left p-4 rounded-2xl transition-all ${
                          isSelected 
                            ? 'bg-gradient-to-br from-violet-50 to-purple-50 border-2 border-violet-300 shadow-md shadow-violet-500/10' 
                            : 'bg-white border-2 border-stone-100 hover:border-violet-200 hover:shadow-md hover:shadow-violet-500/5'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          {/* Selection indicator */}
                          <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all shadow-sm ${
                            isSelected 
                              ? 'bg-gradient-to-br from-violet-500 to-purple-600' 
                              : 'bg-stone-100 group-hover:bg-violet-100 border border-stone-200 group-hover:border-violet-200'
                          }`}>
                            {isSelected ? (
                              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <span className="text-[11px] font-bold text-stone-400 group-hover:text-violet-500">{i + 1}</span>
                            )}
                          </div>
                          
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`text-[11px] font-bold ${isSelected ? 'text-violet-600' : 'text-stone-500'}`}>
                                Message #{i + 1}
                              </span>
                              <span className="text-[10px] text-stone-400">•</span>
                              <span className="text-[10px] text-stone-400">{msg.content.length} chars</span>
                              {msg.metadata?.turn && (
                                <>
                                  <span className="text-[10px] text-stone-400">•</span>
                                  <span className="text-[10px] text-stone-400">Turn {msg.metadata.turn}</span>
                                </>
                              )}
                            </div>
                            <p className={`text-[13px] leading-relaxed ${isSelected ? 'text-violet-900' : 'text-stone-600'}`}>
                              {preview}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Panel footer */}
            <div className="flex-shrink-0 p-4 border-t border-stone-200 bg-gradient-to-t from-stone-100 to-stone-50">
              <button
                onClick={() => setShowContextPanel(false)}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white text-[14px] font-bold rounded-xl transition-all shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/40 hover:scale-[1.02] active:scale-[0.98]"
              >
                {attachedMessages.length > 0 ? `Done · ${attachedMessages.length} selected` : 'Done'}
              </button>
              <p className="text-[10px] text-stone-400 text-center mt-2.5 font-medium">
                Source: {fileName}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Chat area */}
      <div 
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {chatMessages.length === 0 ? (
          /* Empty state */
          <div className="max-w-3xl mx-auto px-6 py-16 h-full flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-6">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-stone-800 mb-2">Chat with OpenAI</h2>
            <p className="text-[15px] text-stone-500 text-center max-w-md mb-8">
              Ask questions about your transcript. Attach user messages as context for more relevant responses.
            </p>
            
            {/* Quick prompts */}
            <div className="flex flex-wrap gap-2 justify-center">
              {['Summarize the conversation', 'What were the key decisions?', 'Identify action items', 'Analyze sentiment'].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => handleQuickPrompt(suggestion)}
                  className="px-4 py-2 text-[13px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-full transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            {/* Scroll to bottom button - shows when user scrolls up during streaming */}
            {isUserScrolledUp && chatMessages.some(m => m.isStreaming) && (
              <div className="sticky top-2 z-10 flex justify-center mb-4">
                <button
                  onClick={scrollToBottom}
                  className="flex items-center gap-2 px-4 py-2 bg-white/95 backdrop-blur-sm border border-stone-200 rounded-full shadow-lg hover:shadow-xl hover:bg-white transition-all text-[13px] font-medium text-stone-600 hover:text-stone-800"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  Follow response
                </button>
              </div>
            )}
            {chatMessages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {/* Avatar */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  msg.role === 'user' 
                    ? 'bg-gradient-to-br from-indigo-500 to-purple-600' 
                    : 'bg-gradient-to-br from-emerald-400 to-teal-500'
                }`}>
                  {msg.role === 'user' ? (
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  )}
                </div>

                {/* Content */}
                <div className={`flex-1 max-w-[85%] ${msg.role === 'user' ? 'text-right' : ''}`}>
                  {/* Web Search indicator - Enhanced UI */}
                  {msg.searchStatus && (
                    <div className={`mb-3 rounded-2xl border overflow-hidden transition-all duration-500 ${
                      msg.searchStatus.searching 
                        ? 'bg-gradient-to-br from-sky-50 to-blue-50 border-sky-200' 
                        : 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200'
                    }`}>
                      {/* Header */}
                      <div className={`px-4 py-3 flex items-center gap-3 ${
                        msg.searchStatus.searching 
                          ? 'bg-gradient-to-r from-sky-500 to-blue-600' 
                          : 'bg-gradient-to-r from-emerald-500 to-teal-600'
                      }`}>
                        {/* Animated icon */}
                        <div className="relative w-8 h-8 flex items-center justify-center">
                          {msg.searchStatus.searching ? (
                            <>
                              <svg className="w-6 h-6 text-white animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                              <div className="absolute inset-0 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            </>
                          ) : (
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                        </div>
                        
                        <div className="flex-1">
                          <p className="text-[13px] font-semibold text-white">
                            {msg.searchStatus.searching ? 'Searching the web...' : 'Web search complete'}
                          </p>
                          <p className="text-[11px] text-white/80">
                            {msg.searchStatus.searching 
                              ? 'Finding and reading sources' 
                              : `Found ${msg.searchStatus.sources?.length || 0} relevant sources`
                            }
                          </p>
                        </div>

                        {/* Live indicator when searching */}
                        {msg.searchStatus.searching && (
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/20 rounded-full">
                            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                            <span className="text-[10px] font-medium text-white uppercase tracking-wide">Live</span>
                          </div>
                        )}
                      </div>

                        
                      {/* Sources grid */}
                      {msg.searchStatus.completed && msg.searchStatus.sources && msg.searchStatus.sources.length > 0 && (
                        <div className="p-3">
                          <div className="grid gap-2">
                            {msg.searchStatus.sources.slice(0, 6).map((source, idx) => {
                              let hostname = '';
                              try {
                                hostname = new URL(source.url).hostname.replace('www.', '');
                              } catch {
                                hostname = source.url;
                              }
                              
                              return (
                                <a 
                                  key={idx}
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="group flex items-center gap-3 p-2.5 bg-white rounded-xl border border-stone-100 hover:border-emerald-300 hover:shadow-md transition-all"
                                >
                                  {/* Favicon */}
                                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                                    <img 
                                      src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
                                      alt=""
                                      className="w-4 h-4"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                    <span className="text-[10px] font-bold text-emerald-600 absolute">{idx + 1}</span>
                                  </div>
                                  
                                  {/* Content */}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[12px] font-medium text-stone-800 truncate group-hover:text-emerald-700 transition-colors">
                                      {source.title || hostname}
                                    </p>
                                    <p className="text-[10px] text-stone-400 truncate">
                                      {hostname}
                                    </p>
                                  </div>
                                  
                                  {/* Arrow */}
                                  <svg className="w-4 h-4 text-stone-300 group-hover:text-emerald-500 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                              );
                            })}
                          </div>
                          
                          {/* Show more indicator */}
                          {msg.searchStatus.sources.length > 6 && (
                            <p className="text-[10px] text-stone-400 text-center mt-2">
                              +{msg.searchStatus.sources.length - 6} more sources
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Reasoning/Thinking indicator - GPT-5 chain-of-thought */}
                  {msg.thinking && (
                    <details className="mb-2 group">
                      <summary className="p-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl cursor-pointer hover:bg-amber-100/50 transition-colors">
                        <div className="inline-flex items-center gap-2">
                          <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Reasoning</span>
                          <span className="text-[10px] text-amber-500 font-normal normal-case">({msg.thinking.length} chars)</span>
                          <svg className="w-3 h-3 text-amber-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </summary>
                      <div className="mt-2 p-3 bg-amber-50/50 border border-amber-100 rounded-lg">
                        <p className="text-[12px] text-amber-800 leading-relaxed whitespace-pre-wrap font-mono">{msg.thinking}</p>
                      </div>
                    </details>
                  )}

                  {/* Message bubble - with edit mode */}
                  {editingMessageId === msg.id ? (
                    /* Edit mode */
                    <div className="w-full">
                      <div className="relative">
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className="w-full px-4 py-3 text-[14px] leading-relaxed bg-white border-2 border-indigo-300 rounded-2xl focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 resize-none min-h-[80px] text-stone-700"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              cancelEditMessage();
                            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              saveEditAndRerun();
                            }
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2 mt-2 justify-end">
                        <button
                          onClick={cancelEditMessage}
                          className="px-3 py-1.5 text-[12px] font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveEditAndRerun}
                          disabled={!editingContent.trim() || isLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Save & Re-run
                        </button>
                      </div>
                      <p className="text-[10px] text-stone-400 mt-1.5 text-right">
                        <kbd className="px-1.5 py-0.5 bg-stone-100 rounded text-[9px] font-mono">⌘</kbd>+<kbd className="px-1.5 py-0.5 bg-stone-100 rounded text-[9px] font-mono">Enter</kbd> to save • <kbd className="px-1.5 py-0.5 bg-stone-100 rounded text-[9px] font-mono">Esc</kbd> to cancel
                      </p>
                    </div>
                  ) : (
                    /* Normal display with hover actions */
                    <div className="group/message relative">
                      <div className={`inline-block text-left ${
                        msg.role === 'user' 
                          ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-md' 
                          : 'bg-stone-100 text-stone-700 rounded-2xl rounded-tl-md'
                      } px-4 py-3 shadow-sm`}>
                        {msg.content ? (
                          <div className="text-[14px] leading-relaxed">
                            {msg.role === 'assistant' ? formatChatContent(msg.content) : <span className="whitespace-pre-wrap">{msg.content}</span>}
                          </div>
                        ) : msg.isStreaming ? (
                          <div className="flex items-center gap-2">
                            {msg.searchStatus?.searching ? (
                              <div className="flex items-center gap-2 text-sky-600">
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                <span className="text-[13px]">Searching web...</span>
                              </div>
                            ) : (
                              <div className="flex gap-1.5 items-center">
                                <div className="flex gap-1">
                                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                      
                      {/* Hover actions - Edit & Delete */}
                      {!msg.isStreaming && msg.content && (
                        <div className={`absolute top-0 ${msg.role === 'user' ? 'left-0 -translate-x-full pr-2' : 'right-0 translate-x-full pl-2'} opacity-0 group-hover/message:opacity-100 transition-opacity flex items-center gap-1`}>
                          {msg.role === 'user' && (
                            <button
                              onClick={() => startEditMessage(msg)}
                              className="p-1.5 text-stone-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="Edit message"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={() => deleteMessageAndAfter(msg.id)}
                            className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title={msg.role === 'user' ? 'Delete from here' : 'Delete response'}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Citations */}
                  {(() => {
                    const validCitations = msg.citations?.filter(c => c && c.url) || [];
                    return validCitations.length > 0 && !msg.isStreaming && (
                      <details className="mt-2 group">
                        <summary className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors">
                          <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          <span className="text-[11px] font-medium text-blue-700">{validCitations.length} citation{validCitations.length > 1 ? 's' : ''}</span>
                          <svg className="w-3 h-3 text-blue-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </summary>
                        <div className="mt-2 space-y-1">
                          {validCitations.map((citation, idx) => (
                            <a
                              key={idx}
                              href={citation.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 p-2 bg-white border border-stone-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                            >
                              <div className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center text-[10px] font-semibold text-blue-600">
                                {idx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-medium text-stone-700 truncate">{citation.title || 'Source'}</p>
                                <p className="text-[10px] text-stone-400 truncate">{citation.url}</p>
                              </div>
                              <svg className="w-4 h-4 text-stone-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          ))}
                        </div>
                      </details>
                    );
                  })()}

                  {/* Streaming indicator */}
                  {msg.isStreaming && msg.content && (
                    <div className="mt-1 flex items-center gap-1">
                      <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></div>
                      <span className="text-[10px] text-stone-400">Generating...</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Input area with attachments */}
      <div className="flex-shrink-0 border-t border-stone-100 bg-gradient-to-t from-stone-50 to-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          {/* Attached messages preview */}
          {attachedMessages.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-gradient-to-r from-violet-500 to-purple-600 rounded-lg">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                    </svg>
                    <span className="text-[11px] font-bold text-white">{attachedMessages.length}</span>
                  </div>
                  <span className="text-[12px] font-medium text-stone-600">
                    Context attached
                  </span>
                </div>
                <button
                  onClick={() => setShowContextPanel(true)}
                  className="text-[11px] font-semibold text-violet-600 hover:text-violet-700 hover:underline"
                >
                  Edit
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {attachedMessages.slice(0, 4).map((msgIndex, i) => {
                  const msg = messages[msgIndex];
                  const preview = msg.content.slice(0, 35) + (msg.content.length > 35 ? '...' : '');
                  return (
                    <div
                      key={msgIndex}
                      className="group flex items-center gap-2 pl-3 pr-2 py-1.5 bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200/60 rounded-xl hover:border-violet-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center justify-center w-5 h-5 rounded-md bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
                        <span className="text-[10px] font-bold text-white">{i + 1}</span>
                      </div>
                      <span className="text-[12px] text-violet-800 max-w-[160px] truncate font-medium">{preview}</span>
                      <button
                        onClick={() => removeMessage(msgIndex)}
                        className="p-1 text-violet-400 hover:text-white hover:bg-violet-500 rounded-md transition-all"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
                {attachedMessages.length > 4 && (
                  <button
                    onClick={() => setShowContextPanel(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-violet-600 bg-violet-100 border border-violet-200 rounded-xl hover:bg-violet-200 transition-all"
                  >
                    <span>+{attachedMessages.length - 4} more</span>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Input box */}
          <div className="relative">
            <div className="flex items-end gap-2 bg-white border border-stone-200 rounded-2xl pl-3 pr-2 py-2 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all shadow-sm">
              {/* Context button */}
              <button
                onClick={() => setShowContextPanel(true)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all ${
                  attachedMessages.length > 0
                    ? 'bg-indigo-100 text-indigo-600'
                    : 'text-stone-400 hover:text-stone-600 hover:bg-stone-100'
                }`}
                title="Add context from transcript"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                </svg>
                {attachedMessages.length > 0 && (
                  <span className="text-[11px] font-semibold">{attachedMessages.length}</span>
                )}
              </button>

              {/* Web Search toggle */}
              <button
                onClick={() => !isWebSearchDisabled && setSettings(s => ({ ...s, webSearch: !s.webSearch }))}
                disabled={isWebSearchDisabled}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${
                  isWebSearchDisabled
                    ? 'opacity-50 cursor-not-allowed text-stone-300 border border-stone-200 bg-stone-50'
                    : settings.webSearch
                      ? 'bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-md shadow-sky-500/25'
                      : 'text-stone-400 hover:text-stone-600 hover:bg-stone-100 border border-stone-200'
                }`}
                title={isWebSearchDisabled 
                  ? 'Web search is not available with Minimal reasoning effort' 
                  : settings.webSearch 
                    ? 'Web search enabled' 
                    : 'Web search disabled'
                }
              >
                <div className={`relative w-4 h-4 ${settings.webSearch && !isWebSearchDisabled ? 'animate-pulse' : ''}`} style={{ animationDuration: '3s' }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={settings.webSearch && !isWebSearchDisabled ? 2.5 : 2}>
                    <circle cx="12" cy="12" r="9" />
                    <ellipse cx="12" cy="12" rx="9" ry="4" />
                    <ellipse cx="12" cy="12" rx="4" ry="9" />
                  </svg>
                </div>
                {settings.webSearch && !isWebSearchDisabled && (
                  <span className="text-[10px] font-bold uppercase tracking-wide">Web</span>
                )}
                {isWebSearchDisabled && (
                  <svg className="w-3 h-3 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                )}
              </button>

              {/* Text input */}
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={attachedMessages.length > 0 ? "Add a question, or just send to analyze..." : "Message GPT-5..."}
                rows={1}
                disabled={isLoading}
                className="flex-1 bg-transparent text-[15px] text-stone-700 placeholder:text-stone-400 resize-none focus:outline-none min-h-[28px] max-h-[200px] py-1 disabled:opacity-50"
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 200) + 'px';
                }}
              />

              {/* Send button */}
              <button
                onClick={handleSend}
                disabled={(!inputValue.trim() && attachedMessages.length === 0) || isLoading}
                className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                  (inputValue.trim() || attachedMessages.length > 0) && !isLoading
                    ? `bg-gradient-to-r ${MODEL_CONFIG[settings.model].color} text-white shadow-lg`
                    : 'bg-stone-100 text-stone-400 cursor-not-allowed'
                }`}
              >
                {isLoading ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                )}
              </button>
            </div>

            {/* Helper text */}
            <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
              <span className="text-[10px] text-stone-400">
                {MODEL_CONFIG[settings.model].name}
              </span>
              <span className="text-[10px] text-stone-300">•</span>
              <span className="text-[10px] text-stone-400">
                {REASONING_CONFIG[settings.reasoningEffort].icon} {REASONING_CONFIG[settings.reasoningEffort].name}
              </span>
              {settings.webSearch && (
                <>
                  <span className="text-[10px] text-stone-300">•</span>
                  <span className="text-[10px] text-sky-500 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    Web
                  </span>
                </>
              )}
              {systemPrompts[settings.model] !== DEFAULT_SYSTEM_PROMPTS[settings.model] && (
                <>
                  <span className="text-[10px] text-stone-300">•</span>
                  <button 
                    onClick={() => {
                      setSelectedPromptModel(settings.model);
                      setEditingPrompt(systemPrompts[settings.model] || '');
                      setShowPromptEditor(true);
                    }}
                    className="text-[10px] text-amber-500 hover:text-amber-600 flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                    </svg>
                    Custom prompt
                  </button>
                </>
              )}
              <span className="text-[10px] text-stone-300">•</span>
              <span className="text-[10px] text-stone-400">Enter to send</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// Import evaluation types
import { 
  EvaluationResult,
  CriterionPair,
  EvaluationApiResponse,
  CRITERIA_CONFIG, 
  getScoreColor,
  getScoreGradient,
} from '@/types/evaluation';

// Score bar component - refined with subtle animation
function ScoreBar({ score, maxScore = 10, size = 'md', variant = 'neutral' }: { 
  score: number; 
  maxScore?: number; 
  size?: 'sm' | 'md' | 'lg';
  variant?: 'neutral' | 'a' | 'b';
}) {
  const percentage = Math.min(100, (score / maxScore) * 100);
  const heights = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' };
  const height = heights[size];
  
  const gradients = {
    neutral: getScoreGradient(score),
    a: 'from-violet-400 to-purple-500',
    b: 'from-teal-400 to-emerald-500',
  };
  
  return (
    <div className={`w-full ${height} bg-stone-100 rounded-full overflow-hidden`}>
      <div 
        className={`${height} bg-gradient-to-r ${gradients[variant]} rounded-full transition-all duration-700 ease-out`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

// Score display with label - kept for potential future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _ScoreDisplay({ score, label, size = 'md' }: { score: number; label?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: { score: 'text-lg', label: 'text-[10px]' },
    md: { score: 'text-2xl', label: 'text-[11px]' },
    lg: { score: 'text-4xl', label: 'text-xs' },
  };
  
  return (
    <div className="flex flex-col items-center">
      <span className={`${sizes[size].score} font-semibold tabular-nums tracking-tight ${getScoreColor(score)}`}>
        {score.toFixed(1)}
      </span>
      {label && <span className={`${sizes[size].label} text-stone-400 font-medium uppercase tracking-wide`}>{label}</span>}
    </div>
  );
}

// Evidence quote component for influential text highlighting
function EvidenceQuote({ 
  answer, 
  impact, 
  quote, 
  rationale 
}: { 
  answer: 'A' | 'B'; 
  impact: 'favorable' | 'unfavorable'; 
  quote: string; 
  rationale: string; 
}) {
  const isA = answer === 'A';
  const isFavorable = impact === 'favorable';
  
  return (
    <div className={`relative pl-3 py-2 rounded-r-lg border-l-2 ${
      isFavorable 
        ? isA ? 'border-l-violet-400 bg-violet-50/50' : 'border-l-teal-400 bg-teal-50/50'
        : 'border-l-rose-300 bg-rose-50/30'
    }`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
          isA 
            ? 'bg-violet-100 text-violet-700' 
            : 'bg-teal-100 text-teal-700'
        }`}>
          {answer}
        </span>
        <span className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${
          isFavorable 
            ? 'bg-emerald-100 text-emerald-700' 
            : 'bg-rose-100 text-rose-700'
        }`}>
          {isFavorable ? '✓ favorable' : '✗ unfavorable'}
        </span>
      </div>
      <blockquote className={`text-[12px] italic leading-relaxed mb-1.5 ${
        isFavorable ? 'text-stone-700' : 'text-stone-600'
      }`}>
        &ldquo;{quote}&rdquo;
      </blockquote>
      <p className="text-[11px] text-stone-500 leading-relaxed">
        → {rationale}
      </p>
    </div>
  );
}

// Criterion card component - refined with cleaner design and evidence support
function CriterionCard({ 
  criterionKey, 
  data,
  isExpanded,
  onToggle,
}: { 
  criterionKey: keyof EvaluationResult['criteria_scores'];
  data: CriterionPair;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const config = CRITERIA_CONFIG[criterionKey];
  const diff = data.A.score - data.B.score;
  const winner = diff > 0 ? 'A' : diff < 0 ? 'B' : 'tie';
  
  // Collect all evidence from both responses
  const allEvidence = [
    ...(data.A.evidence || []),
    ...(data.B.evidence || []),
  ];
  
  // Group evidence by favorable/unfavorable for better display
  const favorableEvidence = allEvidence.filter(e => e.impact === 'favorable');
  const unfavorableEvidence = allEvidence.filter(e => e.impact === 'unfavorable');
  
  return (
    <div className={`group bg-white rounded-xl border transition-all duration-200 ${
      isExpanded ? 'border-stone-300 shadow-sm' : 'border-stone-150 hover:border-stone-250'
    }`}>
      <button 
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center gap-4 text-left"
      >
        {/* Icon with subtle background */}
        <div className="w-10 h-10 rounded-lg bg-stone-50 flex items-center justify-center text-lg flex-shrink-0">
          {config.icon}
        </div>
        
        {/* Title and description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <h4 className="text-[14px] font-semibold text-stone-800 tracking-tight">{config.name}</h4>
            <span className="text-[10px] text-stone-400 font-medium">w{config.weight}</span>
            {allEvidence.length > 0 && (
              <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                {allEvidence.length} quotes
              </span>
            )}
          </div>
          <p className="text-[12px] text-stone-400 leading-relaxed">{config.description}</p>
        </div>
        
        {/* Score comparison - visual bars */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex flex-col items-end gap-1 w-16">
            <div className="flex items-center gap-1.5 w-full">
              <span className={`text-[10px] font-bold uppercase tracking-wide ${winner === 'A' ? 'text-violet-600' : 'text-stone-400'}`}>A</span>
              <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all ${winner === 'A' ? 'bg-violet-500' : 'bg-stone-300'}`}
                  style={{ width: `${data.A.score * 10}%` }}
                />
              </div>
              <span className={`text-[12px] font-semibold tabular-nums ${winner === 'A' ? 'text-violet-600' : 'text-stone-500'}`}>{data.A.score}</span>
            </div>
            <div className="flex items-center gap-1.5 w-full">
              <span className={`text-[10px] font-bold uppercase tracking-wide ${winner === 'B' ? 'text-teal-600' : 'text-stone-400'}`}>B</span>
              <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all ${winner === 'B' ? 'bg-teal-500' : 'bg-stone-300'}`}
                  style={{ width: `${data.B.score * 10}%` }}
                />
              </div>
              <span className={`text-[12px] font-semibold tabular-nums ${winner === 'B' ? 'text-teal-600' : 'text-stone-500'}`}>{data.B.score}</span>
            </div>
          </div>
          
          {/* Winner indicator */}
          <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
            winner === 'A' ? 'bg-violet-100' : winner === 'B' ? 'bg-teal-100' : 'bg-stone-100'
          }`}>
            {winner === 'tie' ? (
              <span className="text-[10px] text-stone-400">=</span>
            ) : (
              <span className={`text-[10px] font-bold ${winner === 'A' ? 'text-violet-600' : 'text-teal-600'}`}>{winner}</span>
            )}
          </div>
        </div>
        
        {/* Expand chevron */}
        <svg className={`w-4 h-4 text-stone-300 group-hover:text-stone-400 transition-all flex-shrink-0 ${isExpanded ? 'rotate-180 text-stone-500' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {/* Expanded content with justifications and evidence */}
      {isExpanded && (
        <div className="px-5 pb-5 pt-1 space-y-4 border-t border-stone-100">
          {/* Side by side justifications */}
          <div className="grid grid-cols-2 gap-4 pt-3">
            {/* Response A */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">A</span>
                  </div>
                  <span className="text-[12px] font-semibold text-stone-700">Debate Outcome</span>
                </div>
                <span className={`text-[13px] font-bold tabular-nums ${getScoreColor(data.A.score)}`}>{data.A.score}/10</span>
              </div>
              <ScoreBar score={data.A.score} size="sm" variant="a" />
              <p className="text-[13px] text-stone-600 leading-[1.6]">{data.A.justification}</p>
            </div>
            
            {/* Response B */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">B</span>
                  </div>
                  <span className="text-[12px] font-semibold text-stone-700">Chat Response</span>
                </div>
                <span className={`text-[13px] font-bold tabular-nums ${getScoreColor(data.B.score)}`}>{data.B.score}/10</span>
              </div>
              <ScoreBar score={data.B.score} size="sm" variant="b" />
              <p className="text-[13px] text-stone-600 leading-[1.6]">{data.B.justification}</p>
            </div>
          </div>
          
          {/* Evidence Section - Influential Text */}
          {allEvidence.length > 0 && (
            <div className="pt-4 border-t border-stone-100">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <h5 className="text-[12px] font-semibold text-stone-700 uppercase tracking-wide">Influential Text</h5>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {/* Favorable evidence */}
                {favorableEvidence.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Strengths
                    </span>
                    {favorableEvidence.map((evidence, idx) => (
                      <EvidenceQuote 
                        key={`fav-${idx}`}
                        answer={evidence.answer}
                        impact={evidence.impact}
                        quote={evidence.quote}
                        rationale={evidence.rationale}
                      />
                    ))}
                  </div>
                )}
                
                {/* Unfavorable evidence */}
                {unfavorableEvidence.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] font-semibold text-rose-600 uppercase tracking-wide flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Weaknesses
                    </span>
                    {unfavorableEvidence.map((evidence, idx) => (
                      <EvidenceQuote 
                        key={`unfav-${idx}`}
                        answer={evidence.answer}
                        impact={evidence.impact}
                        quote={evidence.quote}
                        rationale={evidence.rationale}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Winner showcase component - refined with elegant design
function WinnerShowcase({ 
  evaluation,
  responseALabel,
  responseBLabel,
}: { 
  evaluation: EvaluationResult;
  responseALabel: string;
  responseBLabel: string;
}) {
  const winner = evaluation.winner;
  const winnerLabel = winner === 'A' ? responseALabel : winner === 'B' ? responseBLabel : 'Tie';
  const scoreA = evaluation.overall.A.weighted_total_score;
  const scoreB = evaluation.overall.B.weighted_total_score;
  const maxPossible = 80; // Sum of all weights * 10
  
  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
      {/* Verdict Header */}
      <div className={`px-8 py-6 ${
        winner === 'A' ? 'bg-gradient-to-r from-violet-500 to-purple-600' 
        : winner === 'B' ? 'bg-gradient-to-r from-teal-500 to-emerald-600'
        : 'bg-gradient-to-r from-amber-500 to-orange-500'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white/70 text-[11px] font-medium uppercase tracking-widest">Verdict</span>
              {evaluation.web_search_used && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full text-[10px] font-medium text-white">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Web Search
                </span>
              )}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full text-[10px] font-medium text-white">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                GPT-5.1 High Reasoning
              </span>
            </div>
            <h2 className="text-[28px] font-bold text-white tracking-tight">
              {winner === 'tie' ? "It's a Tie" : winnerLabel}
            </h2>
            <p className="text-white/80 text-[14px] mt-1">
              {winner === 'tie' 
                ? 'Both responses performed equally well overall'
                : `Winner by ${Math.abs(scoreA - scoreB).toFixed(1)} points`
              }
            </p>
          </div>
          <div className="text-6xl">
            {winner === 'tie' ? '⚖️' : '🏆'}
          </div>
        </div>
      </div>
      
      {/* Score Comparison */}
      <div className="p-8">
        <div className="grid grid-cols-2 gap-8 mb-8">
          {/* Response A Score */}
          <div className={`relative p-6 rounded-xl transition-all ${
            winner === 'A' 
              ? 'bg-violet-50 ring-2 ring-violet-200' 
              : 'bg-stone-50'
          }`}>
            {winner === 'A' && (
              <div className="absolute -top-2 -right-2 w-8 h-8 bg-violet-500 rounded-full flex items-center justify-center shadow-lg">
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            )}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
                <span className="text-white font-bold text-[14px]">A</span>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-stone-800">{responseALabel}</p>
                <p className="text-[11px] text-stone-400">Multi-agent debate</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[42px] font-bold text-stone-800 tracking-tight tabular-nums">{scoreA.toFixed(1)}</span>
                <span className="text-[14px] text-stone-400">/ {maxPossible}</span>
              </div>
              <ScoreBar score={scoreA} maxScore={maxPossible} size="lg" variant="a" />
              <p className="text-[12px] text-stone-500">{((scoreA / maxPossible) * 100).toFixed(0)}% of maximum score</p>
            </div>
          </div>
          
          {/* Response B Score */}
          <div className={`relative p-6 rounded-xl transition-all ${
            winner === 'B' 
              ? 'bg-teal-50 ring-2 ring-teal-200' 
              : 'bg-stone-50'
          }`}>
            {winner === 'B' && (
              <div className="absolute -top-2 -right-2 w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center shadow-lg">
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            )}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-md">
                <span className="text-white font-bold text-[14px]">B</span>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-stone-800">{responseBLabel}</p>
                <p className="text-[11px] text-stone-400">Single-shot chat</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[42px] font-bold text-stone-800 tracking-tight tabular-nums">{scoreB.toFixed(1)}</span>
                <span className="text-[14px] text-stone-400">/ {maxPossible}</span>
              </div>
              <ScoreBar score={scoreB} maxScore={maxPossible} size="lg" variant="b" />
              <p className="text-[12px] text-stone-500">{((scoreB / maxPossible) * 100).toFixed(0)}% of maximum score</p>
            </div>
          </div>
        </div>
        
        {/* Rationale Section */}
        <div className="border-t border-stone-100 pt-6 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
            </svg>
            <h3 className="text-[14px] font-semibold text-stone-700">Key Differentiator</h3>
          </div>
          <p className="text-[15px] text-stone-600 leading-[1.7]">{evaluation.winner_rationale}</p>
        </div>
        
        {/* Summaries Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-violet-50/50 rounded-xl border border-violet-100">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-4 h-4 rounded bg-violet-200 flex items-center justify-center">
                <span className="text-[9px] font-bold text-violet-700">A</span>
              </div>
              <span className="text-[11px] font-semibold text-violet-700 uppercase tracking-wide">Summary</span>
            </div>
            <p className="text-[13px] text-stone-600 leading-[1.6]">{evaluation.overall.A.summary}</p>
          </div>
          <div className="p-4 bg-teal-50/50 rounded-xl border border-teal-100">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-4 h-4 rounded bg-teal-200 flex items-center justify-center">
                <span className="text-[9px] font-bold text-teal-700">B</span>
              </div>
              <span className="text-[11px] font-semibold text-teal-700 uppercase tracking-wide">Summary</span>
            </div>
            <p className="text-[13px] text-stone-600 leading-[1.6]">{evaluation.overall.B.summary}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Evaluation Tab Component
// Usage stats component
function UsageStats({ usage }: { 
  usage: { 
    input_tokens: number; 
    output_tokens: number; 
    total_tokens: number; 
    reasoning_tokens?: number; 
  } 
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-stone-50 rounded-xl border border-stone-100">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Token Usage</span>
      </div>
      <div className="flex items-center gap-4 text-[12px]">
        <div className="flex items-center gap-1.5">
          <span className="text-stone-400">Input:</span>
          <span className="font-semibold text-stone-600 tabular-nums">{usage.input_tokens.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-stone-400">Output:</span>
          <span className="font-semibold text-stone-600 tabular-nums">{usage.output_tokens.toLocaleString()}</span>
        </div>
        {usage.reasoning_tokens !== undefined && usage.reasoning_tokens > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-amber-500">🧠 Reasoning:</span>
            <span className="font-semibold text-amber-600 tabular-nums">{usage.reasoning_tokens.toLocaleString()}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 pl-2 border-l border-stone-200">
          <span className="text-stone-400">Total:</span>
          <span className="font-bold text-stone-700 tabular-nums">{usage.total_tokens.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// Score radar/comparison component
function ScoreComparison({ evaluation }: { evaluation: EvaluationResult }) {
  const criteria = Object.keys(evaluation.criteria_scores) as Array<keyof typeof evaluation.criteria_scores>;
  
  // Calculate win/loss/tie counts
  const aWins = criteria.filter(k => evaluation.criteria_scores[k].A.score > evaluation.criteria_scores[k].B.score).length;
  const bWins = criteria.filter(k => evaluation.criteria_scores[k].B.score > evaluation.criteria_scores[k].A.score).length;
  const ties = criteria.length - aWins - bWins;
  
  // Average scores
  const avgA = criteria.reduce((sum, k) => sum + evaluation.criteria_scores[k].A.score, 0) / criteria.length;
  const avgB = criteria.reduce((sum, k) => sum + evaluation.criteria_scores[k].B.score, 0) / criteria.length;
  
  return (
    <div className="grid grid-cols-3 gap-4 p-5 bg-white rounded-xl border border-stone-200">
      {/* A Stats */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <span className="text-[10px] font-bold text-white">A</span>
          </div>
          <span className="text-[12px] font-semibold text-stone-700">Debate</span>
        </div>
        <div className="space-y-1">
          <div className="text-[24px] font-bold text-violet-600 tabular-nums">{avgA.toFixed(1)}</div>
          <div className="text-[11px] text-stone-400">avg score</div>
          <div className="flex justify-center gap-2 mt-2">
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded">
              {aWins} wins
            </span>
          </div>
        </div>
      </div>
      
      {/* VS / Ties */}
      <div className="flex flex-col items-center justify-center border-x border-stone-100">
        <div className="text-[10px] font-bold text-stone-300 uppercase tracking-widest mb-1">VS</div>
        <div className="text-[18px] font-bold text-stone-400">{ties}</div>
        <div className="text-[10px] text-stone-400">ties</div>
      </div>
      
      {/* B Stats */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
            <span className="text-[10px] font-bold text-white">B</span>
          </div>
          <span className="text-[12px] font-semibold text-stone-700">Chat</span>
        </div>
        <div className="space-y-1">
          <div className="text-[24px] font-bold text-teal-600 tabular-nums">{avgB.toFixed(1)}</div>
          <div className="text-[11px] text-stone-400">avg score</div>
          <div className="flex justify-center gap-2 mt-2">
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded">
              {bWins} wins
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EvaluationTab({ 
  messages, 
  chatMessages,
  scrollRef,
  savedEvaluation,
  onSaveEvaluation,
}: { 
  messages: TranscriptMessage[]; 
  chatMessages: ChatMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  savedEvaluation?: { maude_response: string; chat_response: string; evaluation: string } | null;
  onSaveEvaluation?: (maude: string, chat: string, eval_: string) => void;
}) {
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
  const [usageStats, setUsageStats] = useState<{ input_tokens: number; output_tokens: number; total_tokens: number; reasoning_tokens?: number } | null>(null);
  const [expandedCriteria, setExpandedCriteria] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Sync local state with saved evaluation when it loads
  useEffect(() => {
    if (savedEvaluation?.evaluation && !evaluationResult) {
      try {
        const parsed = JSON.parse(savedEvaluation.evaluation);
        setEvaluationResult(parsed.evaluation || parsed);
        if (parsed.usage) {
          setUsageStats(parsed.usage);
        }
      } catch {
        // Legacy format - ignore
      }
    }
  }, [savedEvaluation, evaluationResult]);

  // Get final debate response - aggregate all agent content
  const debateFinalResponse = useMemo(() => {
    // Get the most substantive response from the debate
    // Priority: moderator's final summary, then claude, then gpt
    const moderatorMessages = messages.filter(m => m.role === 'moderator');
    const claudeMessages = messages.filter(m => m.role === 'claude');
    const gptMessages = messages.filter(m => m.role === 'gpt');
    
    // Get the last moderator message as it usually contains the final summary
    const moderatorFinal = moderatorMessages[moderatorMessages.length - 1]?.content;
    
    // If no moderator, get the last substantive AI response
    if (!moderatorFinal) {
      const lastClaude = claudeMessages[claudeMessages.length - 1]?.content;
      const lastGpt = gptMessages[gptMessages.length - 1]?.content;
      return lastClaude || lastGpt || null;
    }
    
    return moderatorFinal;
  }, [messages]);

  // Get the final assistant response from chat - Response B
  const chatFinalResponse = useMemo(() => {
    const assistantMessages = chatMessages.filter(m => m.role === 'assistant' && m.content && !m.isStreaming);
    return assistantMessages[assistantMessages.length - 1]?.content || null;
  }, [chatMessages]);

  // Get user task from the debate
  const userTask = useMemo(() => {
    const userMessages = messages.filter(m => m.role === 'user');
    return userMessages[0]?.content || 'Provide a helpful response';
  }, [messages]);

  const toggleCriterion = (key: string) => {
    setExpandedCriteria(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const expandAll = () => {
    setExpandedCriteria(Object.keys(CRITERIA_CONFIG));
  };

  const collapseAll = () => {
    setExpandedCriteria([]);
  };

  const handleEvaluate = async () => {
    if (!debateFinalResponse || !chatFinalResponse) return;
    
    setIsEvaluating(true);
    setEvaluationResult(null);
    setError(null);
    
    try {
      const response = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userTask,
          // Response A = Debate response (blind - don't reveal source)
          responseA: debateFinalResponse,
          // Response B = Chat response (blind - don't reveal source)
          responseB: chatFinalResponse,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Evaluation failed');
      }

      const data: EvaluationApiResponse = await response.json();
      setEvaluationResult(data.evaluation);
      
      // Store usage stats
      if (data.usage) {
        setUsageStats(data.usage);
      }
      
      // Save the evaluation result with usage
      if (onSaveEvaluation) {
        onSaveEvaluation(
          debateFinalResponse || '', 
          chatFinalResponse || '', 
          JSON.stringify({ evaluation: data.evaluation, usage: data.usage })
        );
      }
    } catch (err) {
      console.error('Evaluation error:', err);
      setError(err instanceof Error ? err.message : 'Evaluation failed. Please try again.');
    } finally {
      setIsEvaluating(false);
    }
  };

  const clearEvaluation = () => {
    setEvaluationResult(null);
    setUsageStats(null);
    setExpandedCriteria([]);
  };

  return (
    <main ref={scrollRef} className="flex-1 overflow-y-auto bg-stone-50/50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Hero Header */}
        <header className="mb-10">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-[22px] font-bold text-stone-800 tracking-tight">
                    Comparative Evaluation
                  </h1>
                  <p className="text-[13px] text-stone-500">
                    Blind assessment across 7 criteria with weighted scoring
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {evaluationResult && (
                <button
                  onClick={clearEvaluation}
                  className="px-4 py-2 text-[13px] font-medium text-stone-500 hover:text-stone-700 bg-white border border-stone-200 hover:border-stone-300 rounded-lg transition-colors"
                >
                  Reset
                </button>
              )}
              <button
                onClick={handleEvaluate}
                disabled={!debateFinalResponse || !chatFinalResponse || isEvaluating}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
                  debateFinalResponse && chatFinalResponse && !isEvaluating
                    ? 'bg-stone-900 text-white hover:bg-stone-800 shadow-sm'
                    : 'bg-stone-100 text-stone-400 cursor-not-allowed'
                }`}
              >
                {isEvaluating ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Evaluating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Run Evaluation
                  </>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Error message */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-[13px] font-semibold text-red-800">Evaluation failed</p>
              <p className="text-[13px] text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Responses Under Comparison */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest">Responses Under Comparison</h2>
            <div className="flex-1 h-px bg-stone-200" />
          </div>

          <div className="grid grid-cols-2 gap-5">
            {/* Response A (Debate) */}
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
                    <span className="text-white font-bold text-[12px]">A</span>
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-stone-800">Debate Outcome</h3>
                    <p className="text-[11px] text-stone-400">Multi-agent synthesis</p>
                  </div>
                </div>
                {debateFinalResponse && (
                  <span className="text-[10px] text-stone-400 bg-stone-100 px-2 py-1 rounded font-medium">
                    {debateFinalResponse.length.toLocaleString()} chars
                  </span>
                )}
              </div>
              <div className="p-5 max-h-[280px] overflow-y-auto">
                {debateFinalResponse ? (
                  <div className="text-[13px] text-stone-600 leading-[1.7] whitespace-pre-wrap font-[system-ui]">
                    {debateFinalResponse.slice(0, 1200)}
                    {debateFinalResponse.length > 1200 && (
                      <span className="text-stone-400">... [{(debateFinalResponse.length - 1200).toLocaleString()} more chars]</span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mb-3">
                      <svg className="w-6 h-6 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <p className="text-[13px] font-medium text-stone-500">No debate response</p>
                    <p className="text-[12px] text-stone-400 mt-0.5">Complete a debate first</p>
                  </div>
                )}
              </div>
            </div>

            {/* Response B (Chat) */}
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-sm">
                    <span className="text-white font-bold text-[12px]">B</span>
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-stone-800">Chat Response</h3>
                    <p className="text-[11px] text-stone-400">Single-shot generation</p>
                  </div>
                </div>
                {chatFinalResponse && (
                  <span className="text-[10px] text-stone-400 bg-stone-100 px-2 py-1 rounded font-medium">
                    {chatFinalResponse.length.toLocaleString()} chars
                  </span>
                )}
              </div>
              <div className="p-5 max-h-[280px] overflow-y-auto">
                {chatFinalResponse ? (
                  <div className="text-[13px] text-stone-600 leading-[1.7] whitespace-pre-wrap font-[system-ui]">
                    {chatFinalResponse.slice(0, 1200)}
                    {chatFinalResponse.length > 1200 && (
                      <span className="text-stone-400">... [{(chatFinalResponse.length - 1200).toLocaleString()} more chars]</span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mb-3">
                      <svg className="w-6 h-6 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                      </svg>
                    </div>
                    <p className="text-[13px] font-medium text-stone-500">No chat response</p>
                    <p className="text-[12px] text-stone-400 mt-0.5">Start a conversation in the Chat tab</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Evaluation Results */}
        {evaluationResult && (
          <>
            {/* Usage Stats */}
            {usageStats && (
              <section className="mb-6">
                <UsageStats usage={usageStats} />
              </section>
            )}

            {/* Score Quick Comparison */}
            <section className="mb-8">
              <ScoreComparison evaluation={evaluationResult} />
            </section>

            {/* Verdict Card */}
            <section className="mb-10">
              <WinnerShowcase 
                evaluation={evaluationResult}
                responseALabel="Debate Outcome"
                responseBLabel="Chat Response"
              />
            </section>

            {/* Criteria Breakdown */}
            <section className="mb-10">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <h2 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest">Criteria Analysis</h2>
                  <div className="flex-1 h-px bg-stone-200 w-24" />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={collapseAll}
                    className="px-3 py-1.5 text-[11px] font-medium text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-md transition-colors"
                  >
                    Collapse
                  </button>
                  <span className="text-stone-200">|</span>
                  <button
                    onClick={expandAll}
                    className="px-3 py-1.5 text-[11px] font-medium text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-md transition-colors"
                  >
                    Expand All
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                {(Object.keys(evaluationResult.criteria_scores) as Array<keyof EvaluationResult['criteria_scores']>).map((key) => (
                  <CriterionCard
                    key={key}
                    criterionKey={key}
                    data={evaluationResult.criteria_scores[key]}
                    isExpanded={expandedCriteria.includes(key)}
                    onToggle={() => toggleCriterion(key)}
                  />
                ))}
              </div>
            </section>
          </>
        )}

        {/* Loading State */}
        {isEvaluating && (
          <div className="bg-white rounded-2xl border border-stone-200 p-12">
            <div className="flex flex-col items-center justify-center">
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                  <svg className="w-8 h-8 text-white animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-sm border border-stone-200">
                  <svg className="w-4 h-4 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              </div>
              <h3 className="text-[16px] font-semibold text-stone-800 mb-1">Analyzing Responses</h3>
              <p className="text-[13px] text-stone-500 text-center max-w-sm">
                Evaluating both responses across 7 weighted criteria. This typically takes 10-15 seconds.
              </p>
              
              {/* Progress indicators */}
              <div className="mt-6 flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <div 
                    key={i}
                    className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty state when no evaluation yet */}
        {!evaluationResult && !isEvaluating && debateFinalResponse && chatFinalResponse && (
          <div className="bg-white rounded-2xl border border-dashed border-stone-300 p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-xl bg-stone-100 flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                </svg>
              </div>
              <h3 className="text-[15px] font-semibold text-stone-700 mb-1">Ready to Compare</h3>
              <p className="text-[13px] text-stone-500 max-w-sm mb-4">
                Both responses are loaded. Click &quot;Run Evaluation&quot; to analyze and compare them across multiple criteria.
              </p>
              <button
                onClick={handleEvaluate}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-stone-900 text-white hover:bg-stone-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Run Evaluation
              </button>
            </div>
          </div>
        )}
        
        <div className="h-16" />
      </div>
    </main>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function TranscriptViewer({ messages, fileName, onReset, projectId, projectName, onBackToProjects }: TranscriptViewerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Read tab from URL, default to 'debate'
  const tabFromUrl = searchParams.get('tab') as ViewTab | null;
  const filterFromUrl = searchParams.get('filter') as ParticipantRole | 'all' | null;
  const searchFromUrl = searchParams.get('q');
  
  const [activeTab, setActiveTabState] = useState<ViewTab>(tabFromUrl || 'debate');
  const [filter, setFilterState] = useState<ParticipantRole | 'all'>(filterFromUrl || 'all');
  const [searchQuery, setSearchQueryState] = useState(searchFromUrl || '');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  
  // Chat messages - persisted to Supabase (scoped to project)
  const { 
    messages: chatMessages, 
    setMessages: setChatMessages, 
    clearChat 
  } = useProjectChat(projectId);
  
  // Evaluation results - persisted
  const {
    evaluation: savedEvaluation,
    saveEvaluation,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    clearEvaluation,
  } = useProjectEvaluation(projectId);

  // Update URL when state changes
  const updateUrl = useCallback((params: { tab?: ViewTab; filter?: ParticipantRole | 'all'; q?: string }) => {
    const newParams = new URLSearchParams(searchParams.toString());
    
    if (params.tab !== undefined) {
      if (params.tab === 'debate') {
        newParams.delete('tab'); // default, no need in URL
      } else {
        newParams.set('tab', params.tab);
      }
    }
    
    if (params.filter !== undefined) {
      if (params.filter === 'all') {
        newParams.delete('filter');
      } else {
        newParams.set('filter', params.filter);
      }
    }
    
    if (params.q !== undefined) {
      if (params.q === '') {
        newParams.delete('q');
      } else {
        newParams.set('q', params.q);
      }
    }
    
    const queryString = newParams.toString();
    router.push(queryString ? `?${queryString}` : '/', { scroll: false });
  }, [router, searchParams]);

  // Wrapped setters that also update URL
  const setActiveTab = useCallback((tab: ViewTab) => {
    setActiveTabState(tab);
    updateUrl({ tab });
  }, [updateUrl]);

  const setFilter = useCallback((f: ParticipantRole | 'all') => {
    setFilterState(f);
    updateUrl({ filter: f });
  }, [updateUrl]);

  const setSearchQuery = useCallback((q: string) => {
    setSearchQueryState(q);
    // Debounce URL update for search
  }, []);

  // Debounced URL update for search query
  useEffect(() => {
    const timer = setTimeout(() => {
      updateUrl({ q: searchQuery });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, updateUrl]);

  // Sync state from URL on initial mount only
  // Using ref to track if initial sync has happened to avoid re-renders
  const initialSyncDone = useRef(false);
  useEffect(() => {
    if (initialSyncDone.current) return;
    initialSyncDone.current = true;
    
    const tab = searchParams.get('tab') as ViewTab | null;
    const f = searchParams.get('filter') as ParticipantRole | 'all' | null;
    const q = searchParams.get('q');
    
    if (tab && ['debate', 'chat', 'evaluation'].includes(tab) && tab !== activeTab) {
      setActiveTabState(tab);
    }
    if (f && ['all', 'user', 'moderator', 'claude', 'gpt'].includes(f) && f !== filter) {
      setFilterState(f);
    }
    if (q !== null && q !== searchQuery) {
      setSearchQueryState(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 400);
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);


  const stats = useMemo(() => {
    const byRole = messages.reduce((acc, msg) => {
      acc[msg.role] = (acc[msg.role] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const totalTokens = calculateTokenSummary(messages);
    
    const start = messages[0]?.timestamp ? new Date(messages[0].timestamp) : null;
    const end = messages[messages.length - 1]?.timestamp ? new Date(messages[messages.length - 1].timestamp) : null;
    
    let duration = '';
    if (start && end) {
      const diff = end.getTime() - start.getTime();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }

    const totalRounds = messages.filter(m => m.metadata?.jsonResponse?.isRoundStart).length;
    
    const lastScore = [...messages].reverse().find(m => 
      m.metadata?.jsonResponse?.catherineScore !== undefined ||
      m.metadata?.jsonResponse?.gordonScore !== undefined
    );
    const scores = lastScore?.metadata?.jsonResponse;

    return { byRole, totalTokens, duration, totalRounds, scores };
  }, [messages]);

  const filteredMessages = useMemo(() => {
    let filtered = messages;
    if (filter !== 'all') filtered = filtered.filter(m => m.role === filter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(m => m.content.toLowerCase().includes(q));
    }
    return filtered;
  }, [messages, filter, searchQuery]);

  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: TranscriptMessage[] }[] = [];
    let currentDate = '';
    filteredMessages.forEach((msg) => {
      const d = formatDate(msg.timestamp);
      if (d !== currentDate) {
        currentDate = d;
        groups.push({ date: d, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });
    return groups;
  }, [filteredMessages]);

  const roles: (ParticipantRole | 'all')[] = ['all', 'user', 'moderator', 'claude', 'gpt'];

  const tabs: { id: ViewTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'debate',
      label: 'Debate',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
    },
    {
      id: 'chat',
      label: 'Chat',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      ),
    },
    {
      id: 'evaluation',
      label: 'Evaluation',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="h-full flex flex-col bg-stone-50">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-stone-200">
        {/* Top bar */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Logo + File name */}
            <div className="flex items-center gap-3">
              <button
                onClick={onBackToProjects}
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/20 hover:scale-105 hover:shadow-lg transition-all"
                title="Back to projects"
              >
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-[15px] font-semibold text-stone-800 leading-tight">{projectName || fileName}</h1>
                  {projectName && (
                    <span className="px-2 py-0.5 text-[10px] font-medium bg-stone-100 text-stone-500 rounded-full truncate max-w-[150px]" title={fileName}>
                      {fileName}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-stone-400 font-mono tabular-nums">
                  {messages.length} messages · {stats.duration || '—'} · {stats.totalTokens > 0 ? `${(stats.totalTokens / 1000).toFixed(1)}k tokens` : '—'}
                </p>
              </div>
            </div>

            {/* Tab navigation */}
            <nav className="flex items-center h-full">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`
                      relative flex items-center gap-2 px-4 h-full text-[13px] font-medium transition-colors
                      ${isActive ? 'text-indigo-600' : 'text-stone-400 hover:text-stone-600'}
                    `}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                    {isActive && (
                      <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-600 rounded-full" />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={onBackToProjects}
                className="px-3 py-1.5 text-[13px] font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Project
              </button>
            </div>
          </div>
        </div>

        {/* Sub-header with filters - only for debate tab */}
        {activeTab === 'debate' && (
          <div className="border-t border-stone-100">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3">
              <div className="flex items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 max-w-sm">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search messages..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-[14px] bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 placeholder:text-stone-400 transition-shadow"
                  />
                </div>

                {/* Role filter */}
                <div className="flex items-center bg-stone-100 rounded-lg p-1 gap-0.5">
                  {roles.map((role) => {
                    const count = role === 'all' ? messages.length : (stats.byRole[role] || 0);
                    const isActive = filter === role;
                    return (
                      <button
                        key={role}
                        onClick={() => setFilter(role)}
                        className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-all flex items-center gap-2 ${
                          isActive 
                            ? 'bg-white text-stone-800 shadow-sm' 
                            : 'text-stone-500 hover:text-stone-700'
                        }`}
                      >
                        {role !== 'all' && <TabAvatar role={role} />}
                        <span className="hidden sm:inline">{role === 'all' ? 'All' : roleNames[role]}</span>
                        <span className="text-stone-400 tabular-nums text-[12px]">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Content */}
      {activeTab === 'debate' && (
        <main ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
            {groupedMessages.map((group, gi) => (
              <section key={gi}>
                <div className="flex items-center gap-4 my-8 first:mt-0">
                  <div className="h-px flex-1 bg-stone-200" />
                  <time className="text-[12px] font-medium text-stone-400 tracking-wide uppercase">{group.date}</time>
                  <div className="h-px flex-1 bg-stone-200" />
                </div>
                <div className="space-y-4">
                  {group.messages.map((msg, mi) => (
                    <ChatMessage key={`${msg.timestamp}-${mi}`} message={msg} />
                  ))}
                </div>
              </section>
            ))}
            
            {filteredMessages.length === 0 && (
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-stone-100 flex items-center justify-center">
                  <svg className="w-7 h-7 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </div>
                <p className="text-[15px] text-stone-500 mb-2">No messages found</p>
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="text-[14px] text-indigo-600 hover:text-indigo-700 font-medium">
                    Clear search
                  </button>
                )}
              </div>
            )}
            <div className="h-12" />
          </div>
        </main>
      )}

      {/* CHAT TAB - Context selection + Chat with OpenAI */}
      {activeTab === 'chat' && (
        <ChatTab 
          messages={messages} 
          fileName={fileName} 
          chatMessages={chatMessages}
          setChatMessages={setChatMessages}
          projectId={projectId}
          onClearChat={clearChat}
        />
      )}

      {/* EVALUATION TAB */}
      {activeTab === 'evaluation' && (
        <EvaluationTab 
          messages={messages} 
          chatMessages={chatMessages} 
          scrollRef={scrollRef}
          savedEvaluation={savedEvaluation}
          onSaveEvaluation={saveEvaluation}
        />
      )}

      {/* Scroll to top - only on debate/evaluation tabs */}
      {showScrollTop && activeTab !== 'chat' && (
        <button
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 w-11 h-11 rounded-full bg-white border border-stone-200 shadow-lg flex items-center justify-center text-stone-500 hover:text-stone-800 hover:shadow-xl hover:scale-105 transition-all"
          aria-label="Scroll to top"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
