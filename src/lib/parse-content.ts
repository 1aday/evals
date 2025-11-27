import { ParsedContent } from '@/types/transcript';

/**
 * Strips markdown code fences from content if present
 */
function stripCodeFences(content: string): string {
  const trimmed = content.trim();
  
  // Match ```json or ``` at the start, and ``` at the end
  const codeFenceRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const match = trimmed.match(codeFenceRegex);
  
  if (match) {
    return match[1].trim();
  }
  
  return trimmed;
}

/**
 * Parses message content, extracting readable text from JSON structures
 */
export function parseMessageContent(content: string): ParsedContent {
  const trimmed = content.trim();
  
  // First, strip any code fences that might wrap JSON
  const unwrapped = stripCodeFences(trimmed);
  
  // Check if content looks like JSON
  if (unwrapped.startsWith('{') || unwrapped.startsWith('[')) {
    try {
      const parsed = JSON.parse(unwrapped);
      
      // Handle common JSON structures
      if (typeof parsed === 'object' && parsed !== null) {
        // Extract content field if present
        if ('content' in parsed && typeof parsed.content === 'string') {
          return {
            displayContent: parsed.content,
            isJson: true,
            originalContent: content,
            clarificationQuestions: parsed.clarificationQuestions,
            feedback: parsed.feedback,
            taskMode: parsed.taskMode,
            nextAgent: parsed.nextAgent,
          };
        }
        
        // Extract feedback field if present
        if ('feedback' in parsed && typeof parsed.feedback === 'string') {
          return {
            displayContent: parsed.feedback,
            isJson: true,
            originalContent: content,
            taskMode: parsed.taskMode,
            nextAgent: parsed.nextAgent,
          };
        }
        
        // Fallback: stringify nicely
        return {
          displayContent: JSON.stringify(parsed, null, 2),
          isJson: true,
          originalContent: content,
        };
      }
    } catch {
      // Not valid JSON, return as-is
    }
  }
  
  return {
    displayContent: content,
    isJson: false,
    originalContent: content,
  };
}

/**
 * Format timestamp to readable format
 */
export function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

/**
 * Format date for grouping messages
 */
export function formatDate(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return 'Unknown Date';
  }
}

/**
 * Calculate token usage summary
 */
export function calculateTokenSummary(messages: { metadata: { usage?: { totalTokens?: number } } }[]): number {
  return messages.reduce((total, msg) => {
    return total + (msg.metadata?.usage?.totalTokens || 0);
  }, 0);
}

