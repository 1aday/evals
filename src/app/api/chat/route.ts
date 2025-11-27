import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import type { Responses } from 'openai/resources/responses/responses';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { messages, settings, context, systemPrompt } = await req.json();

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
    
    // Build input array for Responses API using EasyInputMessage format (simpler)
    const input: Responses.EasyInputMessage[] = inputMessages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    // Reasoning effort - 'none' only works for gpt-5.1
    let reasoningEffort = settings.reasoningEffort;
    if (reasoningEffort === 'none' && settings.model !== 'gpt-5.1') {
      reasoningEffort = 'minimal';
    }

    // Build tools array
    const tools: Responses.Tool[] = [];
    if (settings.webSearch) {
      tools.push({ type: 'web_search' });
    }

    // Create streaming response using Responses API
    const stream = await openai.responses.create({
      model: settings.model || 'gpt-5.1',
      instructions: systemPrompt || undefined,
      input,
      stream: true,
      text: {
        format: { type: 'text' },
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
              // Try multiple paths to find sources based on OpenAI's API structure
              const eventRecord = event as unknown as Record<string, unknown>;
              const item = eventRecord.item as Record<string, unknown> | undefined;
              const output = eventRecord.output as Record<string, unknown> | undefined;
              const action = eventRecord.action as Record<string, unknown> | undefined;
              const data = eventRecord.data as Record<string, unknown> | undefined;
              const sources = 
                (item?.action as Record<string, unknown>)?.sources || 
                (output?.action as Record<string, unknown>)?.sources ||
                action?.sources ||
                eventRecord.sources ||
                data?.sources ||
                (data?.action as Record<string, unknown>)?.sources ||
                [];
              
              console.log('Web search completed event:', JSON.stringify(event, null, 2));
              
              // Always send search_completed to update UI state, even if sources are empty
              // Sources might come later in response.completed event
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: 'search_completed',
                  id: eventRecord.item_id,
                  sources: sources
                })}\n\n`)
              );
            }
            // URL citation annotation
            else if (event.type === 'response.output_text.annotation.added') {
              const annotationEvent = event as unknown as { annotation?: { type: string; url_citation?: unknown } };
              if (annotationEvent.annotation?.type === 'url_citation') {
                safeEnqueue(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: 'citation',
                    citation: annotationEvent.annotation.url_citation
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
            else if (event.type === 'response.completed') {
              // Try to extract sources from the response output items
              const responseEvent = event as unknown as { response?: { output?: Array<{ type: string; action?: { sources?: { url: string; title: string }[] } }>; usage?: unknown } };
              const outputItems = responseEvent.response?.output || [];
              let sources: { url: string; title: string }[] = [];
              for (const item of outputItems) {
                if (item.type === 'web_search_call' && item.action?.sources) {
                  sources = item.action.sources;
                  break;
                }
              }
              
              // Send sources if found (in case they weren't sent with web_search_call.completed)
              if (sources.length > 0) {
                safeEnqueue(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: 'search_completed',
                    sources: sources
                  })}\n\n`)
                );
              }
              
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: 'done',
                  usage: responseEvent.response?.usage 
                })}\n\n`)
              );
              safeClose();
              break;
            }
            // Error
            else if (event.type === 'error') {
              const errorEvent = event as unknown as { error?: { message?: string } };
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: 'error', 
                  error: errorEvent.error?.message || 'Unknown error' 
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
