'use client';

import { useState } from 'react';
import { 
  TranscriptMessage, 
  ParticipantRole,
  getTaskModeDisplay,
} from '@/types/transcript';
import { parseMessageContent, formatTimestamp } from '@/lib/parse-content';

interface ChatMessageProps {
  message: TranscriptMessage;
}

// Avatar with gradient
function Avatar({ role }: { role: ParticipantRole }) {
  const config: Record<ParticipantRole, { gradient: string; icon: React.ReactNode }> = {
    user: {
      gradient: 'from-teal-400 to-emerald-500',
      icon: <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>,
    },
    moderator: {
      gradient: 'from-amber-400 to-orange-500',
      icon: <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 2L3 7v11h14V7l-7-5zM9 12a1 1 0 112 0v3a1 1 0 11-2 0v-3z" clipRule="evenodd" /></svg>,
    },
    claude: {
      gradient: 'from-violet-500 to-purple-600',
      icon: <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A11.034 11.034 0 0112 21c-2.93 0-5.615-1.143-7.595-3.003" /></svg>,
    },
    gpt: {
      gradient: 'from-sky-400 to-blue-500',
      icon: <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" /></svg>,
    },
  };
  const c = config[role] || config.user;
  return (
    <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br ${c.gradient} flex items-center justify-center shadow-sm ring-2 ring-white flex-shrink-0`}>
      {c.icon}
    </div>
  );
}

const roleConfig: Record<ParticipantRole, { name: string; color: string; bg: string; border: string }> = {
  user: { name: 'You', color: 'text-teal-700', bg: 'bg-teal-50/60', border: 'border-teal-100' },
  moderator: { name: 'Maude', color: 'text-amber-700', bg: 'bg-amber-50/60', border: 'border-amber-100' },
  claude: { name: 'Catherine', color: 'text-violet-700', bg: 'bg-violet-50/60', border: 'border-violet-100' },
  gpt: { name: 'Gordon', color: 'text-sky-700', bg: 'bg-sky-50/60', border: 'border-sky-100' },
};

export function ChatMessage({ message }: ChatMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  
  const role = message.role as ParticipantRole;
  const config = roleConfig[role] || roleConfig.user;
  const parsed = parseMessageContent(message.content);
  
  const isLong = parsed.displayContent.length > 800;
  const text = isLong && !expanded ? parsed.displayContent.slice(0, 800) : parsed.displayContent;

  const json = message.metadata?.jsonResponse;
  const taskMode = getTaskModeDisplay(json?.taskMode || parsed.taskMode);
  const isRoundStart = json?.isRoundStart;
  const isStatus = json?.isStatusMessage;

  // Round separator
  if (isRoundStart) {
    return (
      <div className="flex items-center gap-3 sm:gap-4 my-8 sm:my-10">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-200 to-transparent" />
        <span className="px-4 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold tracking-wide uppercase text-amber-700 bg-amber-100 rounded-full whitespace-nowrap">
          Round {json?.roundNumber || json?.debateRound}
        </span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-amber-200 to-transparent" />
      </div>
    );
  }

  // Status message
  if (isStatus) {
    return (
      <p className="text-center py-3 sm:py-4 text-sm sm:text-base text-stone-400 italic">{parsed.displayContent}</p>
    );
  }

  // Parse inline markdown links and citations
  const parseInlineElements = (text: string): React.ReactNode[] => {
    const elements: React.ReactNode[] = [];
    const linkRegex = /(\(\[([^\]]+)\]\(([^)]+)\)\)|\[([^\]]+)\]\(([^)]+)\))/g;
    
    let lastIndex = 0;
    let match;
    let keyIdx = 0;
    
    while ((match = linkRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const beforeText = text.slice(lastIndex, match.index);
        elements.push(...parseBold(beforeText, `pre-${keyIdx}`));
      }
      
      const isCitation = match[0].startsWith('(');
      const linkText = isCitation ? match[2] : match[4];
      const linkUrl = isCitation ? match[3] : match[5];
      
      if (isCitation) {
        elements.push(
          <a
            key={`link-${keyIdx}`}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 mx-0.5 text-xs sm:text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 rounded-lg transition-colors border border-blue-100 hover:border-blue-200"
            title={linkUrl}
          >
            <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span className="truncate max-w-[120px] sm:max-w-[180px]">{linkText}</span>
          </a>
        );
      } else {
        elements.push(
          <a
            key={`link-${keyIdx}`}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-700 active:text-blue-800 underline underline-offset-2 decoration-blue-300 hover:decoration-blue-500 transition-colors"
          >
            {linkText}
          </a>
        );
      }
      
      lastIndex = match.index + match[0].length;
      keyIdx++;
    }
    
    if (lastIndex < text.length) {
      elements.push(...parseBold(text.slice(lastIndex), `post-${keyIdx}`));
    }
    
    if (elements.length === 0) {
      return parseBold(text, 'only');
    }
    
    return elements;
  };

  const parseBold = (text: string, keyPrefix: string): React.ReactNode[] => {
    const parts = text.split(/(\*\*[^*]+\*\*)/);
    return parts.map((part, j) => 
      part.startsWith('**') && part.endsWith('**') 
        ? <strong key={`${keyPrefix}-bold-${j}`} className="font-semibold text-stone-700">{part.slice(2, -2)}</strong>
        : <span key={`${keyPrefix}-text-${j}`}>{part}</span>
    );
  };

  const formatContent = (t: string) => {
    return t.split('\n').map((line, i) => {
      // ## Headers
      if (line.startsWith('## ')) {
        return (
          <h2 key={i} className="mt-5 sm:mt-6 mb-2 sm:mb-2.5 text-base sm:text-lg font-semibold text-stone-800 tracking-tight first:mt-0">
            {line.slice(3)}
          </h2>
        );
      }
      // ### Headers
      if (line.startsWith('### ')) {
        return (
          <h3 key={i} className="mt-4 sm:mt-5 mb-1.5 sm:mb-2 text-[15px] sm:text-base font-medium text-stone-700">
            {line.slice(4)}
          </h3>
        );
      }
      // Bold list items
      if (line.startsWith('- **')) {
        const content = line.slice(2).replace(/\*\*/g, '');
        const colonIndex = content.indexOf(':');
        if (colonIndex > -1) {
          return (
            <p key={i} className="ml-4 sm:ml-5 my-1 sm:my-1.5 text-[15px] sm:text-base leading-relaxed text-stone-600">
              <span className="text-stone-300 mr-2">•</span>
              <span className="font-semibold text-stone-700">{content.slice(0, colonIndex)}</span>
              <span className="text-stone-500">:{parseInlineElements(content.slice(colonIndex + 1))}</span>
            </p>
          );
        }
        return (
          <p key={i} className="ml-4 sm:ml-5 my-1 sm:my-1.5 text-[15px] sm:text-base leading-relaxed text-stone-600">
            <span className="text-stone-300 mr-2">•</span>
            <span className="font-medium text-stone-700">{content}</span>
          </p>
        );
      }
      // Regular list items
      if (line.startsWith('- ')) {
        return (
          <p key={i} className="ml-4 sm:ml-5 my-1 text-[15px] sm:text-base leading-relaxed text-stone-500">
            <span className="text-stone-300 mr-2">•</span>
            {parseInlineElements(line.slice(2))}
          </p>
        );
      }
      // Numbered list
      if (/^\d+\.\s/.test(line)) {
        const match = line.match(/^(\d+\.)\s(.*)$/);
        if (match) {
          return (
            <p key={i} className="ml-4 sm:ml-5 my-1 sm:my-1.5 text-[15px] sm:text-base leading-relaxed text-stone-600">
              <span className="text-stone-400 font-medium tabular-nums mr-2">{match[1]}</span>
              {parseInlineElements(match[2])}
            </p>
          );
        }
      }
      // Empty lines
      if (line.trim() === '') {
        return <div key={i} className="h-3 sm:h-4" />;
      }
      // Body paragraphs
      return (
        <p key={i} className="text-[15px] sm:text-base leading-[1.7] sm:leading-[1.75] text-stone-600 my-1 sm:my-1.5">
          {parseInlineElements(line)}
        </p>
      );
    });
  };

  return (
    <article className={`rounded-xl sm:rounded-2xl border ${config.border} ${config.bg} overflow-hidden`}>
      {/* Header */}
      <header className="flex items-start gap-3 sm:gap-4 px-4 sm:px-5 pt-4 sm:pt-5 pb-2 sm:pb-3">
        <Avatar role={role} />
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
            <span className={`text-base sm:text-lg font-semibold ${config.color}`}>
              {config.name}
            </span>
            {message.metadata?.turn && (
              <span className="text-xs sm:text-sm text-stone-400">
                Turn {message.metadata.turn}
              </span>
            )}
            {taskMode && (
              <span className={`text-xs sm:text-sm px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full font-medium tracking-wide ${
                taskMode.label === 'Solve' ? 'bg-emerald-100 text-emerald-700' :
                taskMode.label === 'Analyze' ? 'bg-blue-100 text-blue-700' :
                taskMode.label === 'Brainstorm' ? 'bg-purple-100 text-purple-700' :
                'bg-stone-100 text-stone-600'
              }`}>
                {taskMode.label}
              </span>
            )}
          </div>
          {/* Metadata line */}
          <div className="flex items-center gap-2 sm:gap-2 mt-1 text-xs sm:text-sm text-stone-400 font-mono">
            <time>{formatTimestamp(message.timestamp)}</time>
            {message.metadata?.model && (
              <>
                <span className="text-stone-300 hidden sm:inline">·</span>
                <span className="hidden sm:inline">{message.metadata.model}</span>
              </>
            )}
            {message.metadata?.usage?.totalTokens && (
              <>
                <span className="text-stone-300">·</span>
                <span className="tabular-nums">{message.metadata.usage.totalTokens.toLocaleString()} <span className="hidden sm:inline">tokens</span><span className="sm:hidden">tok</span></span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="px-4 sm:px-5 pb-4 sm:pb-5">
        <div className="sm:pl-[60px] pl-0">
          {formatContent(text)}
          
          {/* Expand toggle */}
          {isLong && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(!expanded); }}
              className="mt-4 sm:mt-5 text-sm sm:text-base font-medium text-indigo-600 hover:text-indigo-700 active:text-indigo-800 cursor-pointer inline-flex items-center gap-1.5 sm:gap-2 transition-colors py-1.5"
            >
              <svg className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              {expanded ? 'Show less' : 'Continue reading'}
            </button>
          )}
        </div>
      </div>

      {/* Metadata drawer */}
      {message.metadata && Object.keys(message.metadata).length > 0 && (
        <footer className="border-t border-stone-100">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMeta(!showMeta); }}
            className="w-full px-4 sm:px-5 py-2.5 sm:py-3 text-xs sm:text-sm text-stone-400 hover:text-stone-600 active:text-stone-700 hover:bg-stone-50/50 cursor-pointer flex items-center gap-2 transition-colors"
          >
            <svg className={`w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform ${showMeta ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="font-medium">Raw metadata</span>
          </button>
          {showMeta && (
            <div className="px-4 sm:px-5 pb-4 sm:pb-5">
              <pre className="text-xs sm:text-sm leading-relaxed text-stone-500 bg-stone-50 p-3 sm:p-4 rounded-xl overflow-x-auto max-h-48 sm:max-h-60 overflow-y-auto font-mono border border-stone-100">
                {JSON.stringify(message.metadata, null, 2)}
              </pre>
            </div>
          )}
        </footer>
      )}
    </article>
  );
}
