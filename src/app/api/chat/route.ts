import { NextRequest } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { messages, settings, context, systemPrompt } = await req.json();

    // Build input array for Responses API
    type ContentItem = { type: 'input_text' | 'output_text'; text: string };
    type InputItem = {
      role: 'user' | 'assistant';
      content: ContentItem[];
    };

    // If context is provided, prepend it to the first user message
    const inputMessages = [...messages];
    if (context && context.length > 0 && inputMessages.length > 0) {
      const contextText = context.map((msg: string, i: number) => `[Context ${i + 1}]: ${msg}`).join('\n\n');
      // Find the last user message and prepend context
      const lastUserIdx = inputMessages.findIndex((m: { role: string }) => m.role === 'user');
      if (lastUserIdx !== -1) {
        inputMessages[lastUserIdx] = {
          ...inputMessages[lastUserIdx],
          content: `${contextText}\n\n---\n\n${inputMessages[lastUserIdx].content}`
        };
      }
    }
    
    const input: InputItem[] = inputMessages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ 
        type: (m.role === 'assistant' ? 'output_text' : 'input_text') as 'input_text' | 'output_text', 
        text: m.content 
      }],
    }));

    // Reasoning effort - 'none' only works for gpt-5.1, others use 'minimal'
    let reasoningEffort = settings.reasoningEffort;
    if (reasoningEffort === 'none' && settings.model !== 'gpt-5.1') {
      reasoningEffort = 'minimal';
    }

    // Build tools array
    const tools: any[] = [];
    if (settings.webSearch) {
      tools.push({
        type: 'web_search',
        // web_search tool config
      });
    }

    // Create streaming response using Responses API
    const stream = await (openai as any).responses.create({
      model: settings.model || 'gpt-5',
      instructions: systemPrompt || undefined,
      input,
      stream: true,
      text: {
        format: { type: 'text' },
        verbosity: settings.verbosity || 'medium',
      },
      reasoning: {
        effort: reasoningEffort || 'medium',
        summary: 'detailed',
      },
      tools: tools.length > 0 ? tools : undefined,
      store: true,
      include: [
        'reasoning.encrypted_content',
        'web_search_call.action.sources',
      ],
    });

    // Create a readable stream for the response
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        let isClosed = false;
        
        const safeEnqueue = (data: Uint8Array) => {
          if (!isClosed) {
            controller.enqueue(data);
          }
        };
        
        const safeClose = () => {
          if (!isClosed) {
            isClosed = true;
            controller.close();
          }
        };
        
        try {
          for await (const event of stream) {
            // Skip processing if already closed
            if (isClosed) break;
            
            // Handle different event types from Responses API
            
            // Text content streaming
            if (event.type === 'response.output_text.delta') {
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: 'content', 
                  content: event.delta || '' 
                })}\n\n`)
              );
            } 
            // Reasoning summary streaming
            else if (event.type === 'response.reasoning_summary_text.delta') {
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: 'thinking', 
                  content: event.delta || '' 
                })}\n\n`)
              );
            }
            // Reasoning summary done
            else if (event.type === 'response.reasoning_summary_text.done') {
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'thinking_done' })}\n\n`)
              );
            }
            // Web search started
            else if (event.type === 'response.web_search_call.in_progress') {
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: 'search_started',
                  id: event.item_id
                })}\n\n`)
              );
            }
            // Web search searching
            else if (event.type === 'response.web_search_call.searching') {
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: 'search_searching',
                  id: event.item_id
                })}\n\n`)
              );
            }
            // Web search completed with results
            else if (event.type === 'response.web_search_call.completed') {
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: 'search_completed',
                  id: event.item_id,
                  action: event.item?.action
                })}\n\n`)
              );
            }
            // URL citation annotation
            else if (event.type === 'response.output_text.annotation.added') {
              if (event.annotation?.type === 'url_citation') {
                safeEnqueue(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: 'citation',
                    citation: event.annotation.url_citation
                  })}\n\n`)
                );
              }
            }
            // Content done
            else if (event.type === 'response.output_text.done') {
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'content_done' })}\n\n`)
              );
            }
            // Response completed
            else if (event.type === 'response.completed' || event.type === 'response.done') {
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: 'done',
                  usage: event.response?.usage 
                })}\n\n`)
              );
              safeClose();
              break;
            }
            // Error
            else if (event.type === 'error') {
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: 'error', 
                  error: event.error?.message || 'Unknown error' 
                })}\n\n`)
              );
              safeClose();
              break;
            }
          }
          safeClose();
        } catch (error) {
          console.error('Stream error:', error);
          safeEnqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`)
          );
          safeClose();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process chat request', 
        details: error instanceof Error ? error.message : String(error) 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
