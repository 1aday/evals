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

interface Citation {
  url: string;
  title: string;
  start_index: number;
  end_index: number;
}

interface SearchStatus {
  searching: boolean;
  completed: boolean;
  sources?: { url: string; title: string }[];
}

// Model config
const MODEL_CONFIG = {
  'gpt-5.1': { name: 'GPT-5.1', desc: 'Latest flagship', color: 'from-violet-500 to-purple-600', badge: 'NEW' },
  'gpt-5': { name: 'GPT-5', desc: 'Flagship model', color: 'from-indigo-500 to-blue-600', badge: null },
  'gpt-5-mini': { name: 'GPT-5 Mini', desc: 'Balanced', color: 'from-cyan-500 to-teal-600', badge: null },
  'gpt-5-nano': { name: 'GPT-5 Nano', desc: 'Fast', color: 'from-emerald-500 to-green-600', badge: null },
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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  
  const [settings, setSettings] = useState<ChatSettings>({
    model: 'gpt-5',
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
  const [selectedPromptModel, setSelectedPromptModel] = useState<string>('gpt-5');

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
    
    // User is "at bottom" if within 100px of the bottom
    setIsUserScrolledUp(distanceFromBottom > 100);
  }, []);

  // Auto-scroll to bottom when new messages arrive, only if user hasn't scrolled up
  useEffect(() => {
    if (!isUserScrolledUp) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isUserScrolledUp]);

  // Scroll to bottom when user sends a new message (reset scroll behavior)
  const scrollToBottom = useCallback(() => {
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

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
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
    const assistantId = (Date.now() + 1).toString();
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
                const sources = data.action?.sources || [];
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
            } catch (e) {
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

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Header with settings */}
      <div className="flex-shrink-0 border-b border-stone-100 bg-white">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Model selector - pill style */}
            <div className="flex items-center gap-2">
              <div className="flex bg-stone-100 rounded-full p-1">
                {(Object.keys(MODEL_CONFIG) as Array<keyof typeof MODEL_CONFIG>).map((model) => {
                  const config = MODEL_CONFIG[model];
                  const isActive = settings.model === model;
                  return (
                    <button
                      key={model}
                      onClick={() => setSettings(s => ({ ...s, model }))}
                      className={`relative px-3 py-1.5 rounded-full text-[12px] font-medium transition-all ${
                        isActive 
                          ? `bg-gradient-to-r ${config.color} text-white shadow-sm` 
                          : 'text-stone-500 hover:text-stone-700'
                      }`}
                    >
                      {config.name}
                      {config.badge && (
                        <span className={`absolute -top-1 -right-1 px-1 py-0.5 text-[8px] font-bold rounded ${
                          isActive ? 'bg-white/20 text-white' : 'bg-violet-100 text-violet-600'
                        }`}>
                          {config.badge}
                        </span>
                      )}
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
            <div className="mt-4 p-4 bg-gradient-to-br from-stone-50 to-stone-100/50 rounded-2xl border border-stone-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Reasoning Effort - Visual selector */}
                <div>
                  <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-3">Reasoning Effort</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {(Object.keys(REASONING_CONFIG) as Array<keyof typeof REASONING_CONFIG>).map((effort) => {
                      const config = REASONING_CONFIG[effort];
                      const isActive = settings.reasoningEffort === effort;
                      const isDisabled = effort === 'none' && settings.model !== 'gpt-5.1';
                      
                      return (
                        <button
                          key={effort}
                          onClick={() => !isDisabled && setSettings(s => ({ ...s, reasoningEffort: effort }))}
                          disabled={isDisabled}
                          className={`relative flex flex-col items-center p-2.5 rounded-xl transition-all ${
                            isDisabled 
                              ? 'opacity-30 cursor-not-allowed' 
                              : isActive 
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105' 
                                : 'bg-white hover:bg-indigo-50 text-stone-600 hover:text-indigo-600 border border-stone-200 hover:border-indigo-200'
                          }`}
                        >
                          <span className="text-lg mb-0.5">{config.icon}</span>
                          <span className="text-[10px] font-semibold">{config.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-stone-400 mt-2 text-center">
                    {REASONING_CONFIG[settings.reasoningEffort].desc}
                  </p>
                  {/* Web search incompatibility warning */}
                  {settings.reasoningEffort === 'minimal' && (
                    <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                      <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="text-[11px] text-amber-700 font-medium">Web search is not available with Minimal reasoning</span>
                    </div>
                  )}
                </div>

                {/* Verbosity - Slider style */}
                <div>
                  <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-3">Response Length</label>
                  <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-stone-200">
                    <button
                      onClick={() => setSettings(s => ({ ...s, verbosity: 'low' }))}
                      className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-all ${
                        settings.verbosity === 'low' ? 'bg-emerald-500 text-white' : 'text-stone-500 hover:bg-stone-50'
                      }`}
                    >
                      <span className="block text-sm mb-0.5">📝</span>
                      Concise
                    </button>
                    <button
                      onClick={() => setSettings(s => ({ ...s, verbosity: 'medium' }))}
                      className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-all ${
                        settings.verbosity === 'medium' ? 'bg-blue-500 text-white' : 'text-stone-500 hover:bg-stone-50'
                      }`}
                    >
                      <span className="block text-sm mb-0.5">📄</span>
                      Balanced
                    </button>
                    <button
                      onClick={() => setSettings(s => ({ ...s, verbosity: 'high' }))}
                      className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-all ${
                        settings.verbosity === 'high' ? 'bg-purple-500 text-white' : 'text-stone-500 hover:bg-stone-50'
                      }`}
                    >
                      <span className="block text-sm mb-0.5">📚</span>
                      Detailed
                    </button>
                  </div>
                </div>
              </div>

              {/* Current config summary */}
              <div className="mt-4 flex items-center justify-between p-3 bg-white/60 rounded-xl">
                <div className="flex items-center gap-3 text-[11px] text-stone-500">
                  <span className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full bg-gradient-to-r ${MODEL_CONFIG[settings.model].color}`}></span>
                    {MODEL_CONFIG[settings.model].name}
                  </span>
                  <span>•</span>
                  <span>{REASONING_CONFIG[settings.reasoningEffort].icon} {REASONING_CONFIG[settings.reasoningEffort].name} reasoning</span>
                  <span>•</span>
                  <span>{settings.verbosity === 'low' ? '📝' : settings.verbosity === 'medium' ? '📄' : '📚'} {settings.verbosity} verbosity</span>
                </div>
              </div>
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
                  {/* Web Search indicator */}
                  {msg.searchStatus && (
                    <div className={`mb-3 overflow-hidden rounded-2xl ${
                      msg.searchStatus.searching 
                        ? 'bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-600' 
                        : 'bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600'
                    } p-[1px]`}>
                      <div className="bg-white/95 backdrop-blur-sm rounded-[15px] p-4">
                        <div className="flex items-center gap-3">
                          {/* Animated Globe */}
                          <div className={`relative flex-shrink-0 w-11 h-11 rounded-full ${
                            msg.searchStatus.searching 
                              ? 'bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600' 
                              : 'bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-600'
                          } shadow-lg shadow-sky-500/30 flex items-center justify-center`}>
                            {msg.searchStatus.searching ? (
                              <>
                                {/* Globe base */}
                                <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none">
                                  {/* Outer circle */}
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4"/>
                                  {/* Equator */}
                                  <ellipse cx="12" cy="12" rx="10" ry="4" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5"/>
                                  {/* Meridian - animated */}
                                  <g className="origin-center" style={{ animation: 'spin 4s linear infinite' }}>
                                    <ellipse cx="12" cy="12" rx="4" ry="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.6"/>
                                  </g>
                                </svg>
                                {/* Soft glow pulse */}
                                <div className="absolute inset-0 rounded-full bg-white/20 animate-pulse" style={{ animationDuration: '2s' }} />
                                {/* Rotating highlight arc */}
                                <div className="absolute inset-1 rounded-full overflow-hidden">
                                  <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s' }}>
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1/2 bg-gradient-to-b from-white/30 to-transparent rounded-t-full" />
                                  </div>
                                </div>
                              </>
                            ) : (
                              /* Completed checkmark */
                              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          
                          {/* Text content */}
                          <div className="flex-1 min-w-0">
                            <span className={`text-[13px] font-semibold ${
                              msg.searchStatus.searching ? 'text-sky-700' : 'text-emerald-700'
                            }`}>
                              {msg.searchStatus.searching ? 'Searching the web' : 'Search complete'}
                            </span>
                            <p className={`text-[11px] mt-0.5 ${
                              msg.searchStatus.searching ? 'text-sky-500/80' : 'text-emerald-600'
                            }`}>
                              {msg.searchStatus.searching 
                                ? 'Finding relevant sources...' 
                                : `${msg.searchStatus.sources?.length || 0} sources found`
                              }
                            </p>
                          </div>
                        </div>
                        
                        {/* Sources */}
                        {msg.searchStatus.completed && msg.searchStatus.sources && msg.searchStatus.sources.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-stone-100">
                            <div className="flex flex-wrap gap-2">
                              {msg.searchStatus.sources.slice(0, 5).map((source, idx) => (
                                <a 
                                  key={idx}
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-r from-emerald-50 to-teal-50 hover:from-emerald-100 hover:to-teal-100 border border-emerald-200 text-[11px] text-emerald-700 rounded-lg transition-all hover:shadow-sm"
                                >
                                  <div className="w-4 h-4 rounded bg-emerald-500 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[9px] font-bold text-white">{idx + 1}</span>
                                  </div>
                                  <span className="truncate max-w-[140px] font-medium">{source.title || new URL(source.url).hostname}</span>
                                  <svg className="w-3 h-3 text-emerald-400 group-hover:text-emerald-600 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
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

                  {/* Message bubble */}
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
                          <div className="flex items-center gap-2">
                            <div className="relative w-5 h-5 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500">
                              <svg className="w-full h-full text-white/70 p-0.5" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
                                <ellipse cx="12" cy="12" rx="9" ry="3.5" stroke="currentColor" strokeWidth="1.5"/>
                                <g style={{ animation: 'spin 3s linear infinite', transformOrigin: 'center' }}>
                                  <ellipse cx="12" cy="12" rx="3.5" ry="9" stroke="currentColor" strokeWidth="1.5"/>
                                </g>
                              </svg>
                              <div className="absolute inset-0 rounded-full bg-white/20 animate-pulse" />
                            </div>
                            <span className="text-[13px] text-stone-500">Searching the web</span>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

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


// Evaluation Tab Component
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
  const [evaluationResult, setEvaluationResult] = useState<string | null>(savedEvaluation?.evaluation || null);

  // Get the final response from Maude (moderator) - last moderator message
  const maudeFinalResponse = useMemo(() => {
    const moderatorMessages = messages.filter(m => m.role === 'moderator');
    return moderatorMessages[moderatorMessages.length - 1]?.content || null;
  }, [messages]);

  // Get the final assistant response from chat
  const chatFinalResponse = useMemo(() => {
    const assistantMessages = chatMessages.filter(m => m.role === 'assistant' && m.content && !m.isStreaming);
    return assistantMessages[assistantMessages.length - 1]?.content || null;
  }, [chatMessages]);

  const handleEvaluate = async () => {
    if (!maudeFinalResponse || !chatFinalResponse) return;
    
    setIsEvaluating(true);
    setEvaluationResult(null);
    
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Compare and evaluate these two responses to determine which is better. Be concise but thorough.

**Response A (Maude - from transcript):**
${maudeFinalResponse}

**Response B (Chat - from GPT):**
${chatFinalResponse}

Please evaluate:
1. Which response is more accurate/helpful?
2. Key differences between them
3. Overall recommendation`,
          }],
          settings: {
            model: 'gpt-5',
            reasoningEffort: 'medium',
            verbosity: 'medium',
            webSearch: false,
          },
          context: [],
        }),
      });

      if (!response.ok) throw new Error('Evaluation failed');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      if (reader) {
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
                  setEvaluationResult(fullContent);
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }
      }
      
      // Save the evaluation result
      if (fullContent && onSaveEvaluation) {
        onSaveEvaluation(maudeFinalResponse || '', chatFinalResponse || '', fullContent);
      }
    } catch (error) {
      console.error('Evaluation error:', error);
      setEvaluationResult('⚠️ Evaluation failed. Please try again.');
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <main ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Response Comparison Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-stone-800">Response Comparison</h2>
            <button
              onClick={handleEvaluate}
              disabled={!maudeFinalResponse || !chatFinalResponse || isEvaluating}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold transition-all ${
                maudeFinalResponse && chatFinalResponse && !isEvaluating
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:scale-105'
                  : 'bg-stone-200 text-stone-400 cursor-not-allowed'
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
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Evaluate
                </>
              )}
            </button>
          </div>

          {/* Side by side comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Maude's Response */}
            <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-amber-400 to-orange-500 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">M</span>
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-white">Maude&apos;s Response</h3>
                  <p className="text-[11px] text-white/70">From transcript (Moderator)</p>
                </div>
              </div>
              <div className="p-4 max-h-[400px] overflow-y-auto">
                {maudeFinalResponse ? (
                  <div className="text-[14px] text-stone-700 leading-relaxed">{formatChatContent(maudeFinalResponse)}</div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-stone-400">
                    <svg className="w-12 h-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-[13px]">No moderator response found</p>
                  </div>
                )}
              </div>
            </div>

            {/* Chat Response */}
            <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-emerald-400 to-teal-500 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-white">Chat Response</h3>
                  <p className="text-[11px] text-white/70">From GPT (Latest)</p>
                </div>
              </div>
              <div className="p-4 max-h-[400px] overflow-y-auto">
                {chatFinalResponse ? (
                  <div className="text-[14px] text-stone-700 leading-relaxed">{formatChatContent(chatFinalResponse)}</div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-stone-400">
                    <svg className="w-12 h-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                    </svg>
                    <p className="text-[13px]">No chat response yet</p>
                    <p className="text-[11px] text-stone-300 mt-1">Go to Chat tab to start a conversation</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Evaluation Result */}
        {evaluationResult && (
          <div className="mb-8 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-200 overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-white">Evaluation Result</h3>
                <p className="text-[11px] text-white/70">AI-powered comparison</p>
              </div>
            </div>
            <div className="p-5">
              <div className="text-[14px] text-stone-700 leading-relaxed">{formatChatContent(evaluationResult)}</div>
              {isEvaluating && (
                <div className="mt-2 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></div>
                  <span className="text-[10px] text-indigo-500">Generating...</span>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="h-12" />
      </div>
    </main>
  );
}

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

  // Sync state from URL on mount and when URL changes
  useEffect(() => {
    const tab = searchParams.get('tab') as ViewTab | null;
    const f = searchParams.get('filter') as ParticipantRole | 'all' | null;
    const q = searchParams.get('q');
    
    if (tab && ['debate', 'chat', 'evaluation'].includes(tab)) {
      setActiveTabState(tab);
    }
    if (f && ['all', 'user', 'moderator', 'claude', 'gpt'].includes(f)) {
      setFilterState(f);
    }
    if (q !== null) {
      setSearchQueryState(q);
    }
  }, [searchParams]);

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
                  <h1 className="text-[15px] font-semibold text-stone-800 leading-tight">{fileName}</h1>
                  {projectName && (
                    <span className="px-2 py-0.5 text-[10px] font-medium bg-indigo-100 text-indigo-600 rounded-full">
                      {projectName}
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
